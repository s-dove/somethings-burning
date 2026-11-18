import type { Db } from "../db.js";
import { sendMail, type SmtpSettings } from "../mail.js";
import { selfReport } from "../self-report.js";
import type { Mattermost } from "./mattermost.js";
import { claim, type Delivery, MAX_ATTEMPTS, type Message, settle } from "./store.js";

/** The server cannot send this kind at all; retrying will not help. */
export class NotConfigured extends Error {}

/** Senders delivers one message to one address. It throws on failure. */
export class Senders {
  constructor(
    private smtp: SmtpSettings,
    readonly mattermost: Mattermost,
  ) {}

  get emailEnabled(): boolean {
    return !!(this.smtp.host && this.smtp.from);
  }

  async send(d: Delivery, m: Message): Promise<void> {
    switch (d.kind) {
      case "email":
        if (!this.emailEnabled) throw new NotConfigured("email is not configured (BURNING_SMTP_HOST, BURNING_SMTP_FROM)");
        return sendMail(this.smtp, { to: [d.target], subject: m.subject, text: m.text });
      case "mattermost_dm":
        if (!this.mattermost.enabled) throw new NotConfigured("Mattermost is not configured (BURNING_MATTERMOST_URL, BURNING_MATTERMOST_TOKEN)");
        return this.mattermost.dm(d.target, m.text);
      case "mattermost_channel":
        if (!this.mattermost.enabled) throw new NotConfigured("Mattermost is not configured (BURNING_MATTERMOST_URL, BURNING_MATTERMOST_TOKEN)");
        return this.mattermost.post(d.target, m.text);
      case "slack": {
        // A Slack incoming webhook takes {"text": ...}.
        const res = await fetch(d.target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: m.text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Slack answered ${res.status}`);
        return;
      }
      case "webhook": {
        const res = await fetch(d.target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: m.json,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`webhook answered ${res.status}`);
      }
    }
  }
}

/** Outbox sends what is due and retries failures. It runs on a timer and right after alerts are queued. */
export class Outbox {
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private db: Db,
    private senders: Senders,
  ) {}

  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.send()
      .catch((err) => {
        console.error("outbox:", err);
        selfReport(err);
      })
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  /**
   * Sends everything due, and resolves once nothing is being sent: a kick
   * already under way may hold claimed messages this round skips (for tests).
   */
  async drain(): Promise<void> {
    await this.running;
    await this.send();
    while (this.running) await this.running;
  }

  private async send(): Promise<void> {
    for (;;) {
      const rows = await claim(this.db);
      if (rows.length === 0) return;
      await Promise.all(
        rows.map(async (r) => {
          let error = "";
          let attempts = r.attempts + 1;
          try {
            await this.senders.send(r, r);
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
            if (err instanceof NotConfigured) attempts = MAX_ATTEMPTS;
            console.error(`notify kind=${r.kind} target=${r.target} attempt=${attempts}: ${error}`);
          }
          await settle(this.db, r.id, attempts, error);
        }),
      );
    }
  }
}

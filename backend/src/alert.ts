import { addActivity } from "./activity.js";
import type { Db } from "./db.js";
import type { SentryEvent } from "./event.js";
import type { Recorded } from "./issues.js";
import type { Outbox } from "./notify/deliver.js";
import { planFor, summary } from "./notify/plan.js";
import { factsOf } from "./notify/routing.js";
import { enqueue, type Message } from "./notify/store.js";
import type { Project } from "./projects.js";

/**
 * Alerter handles new issues, resolved issues that fire again, issues
 * firing after a mute, and spikes. The project's routing table decides who hears about
 * it; the messages go into the outbox, and the issue's history says who was
 * notified.
 */
export class Alerter {
  constructor(
    private db: Db,
    private outbox: Outbox | null,
  ) {}

  async notify(p: Project, res: Recorded, ev: SentryEvent, baseURL: string): Promise<void> {
    if (!res.alert) return;
    const link = `${baseURL}/issues/${res.issueId}`;
    const issue = await this.db.get<{ assignee: string }>("SELECT assignee FROM issues WHERE id = ?", res.issueId);
    const plan = await planFor(this.db, p.id, { ...factsOf(p.name, ev, res.alert), spike: res.spike }, issue?.assignee ?? "");
    const now = Date.now();
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    await this.db.tx(async (t) => {
      await enqueue(t, p.id, res.issueId, plan.deliveries, alertMessage(p.name, res, link), now);
      await addActivity(t, res.issueId, now, "notified", summary(plan), { release: str(ev.release), environment: str(ev.environment) });
    });
    console.log(`alert kind=${res.alert} project=${p.name} issue=${res.issueId}: ${summary(plan)}`);
    if (plan.deliveries.length) this.outbox?.kick();
  }
}

export function alertMessage(project: string, res: Pick<Recorded, "issueId" | "title" | "alert" | "reason">, link: string): Message {
  const head =
    res.alert === "new"
      ? `New issue in ${project}`
      : res.alert === "fired_again"
        ? `Fired again in ${project}`
        : res.alert === "spike"
          ? `Spiking in ${project}`
          : `Firing after a mute in ${project}`;
  const text = [`${head}: ${res.title}`, res.alert !== "new" && res.reason ? `${res.reason}.` : "", link].filter(Boolean).join("\n");
  const subject = res.alert === "new" ? `New issue: ${res.title}` : res.alert === "spike" ? `Issue spiking: ${res.title}` : `Issue fired again: ${res.title}`;
  const json = JSON.stringify({ text, kind: res.alert, project, issue_id: res.issueId, title: res.title, reason: res.reason, url: link });
  return { subject, text, json };
}

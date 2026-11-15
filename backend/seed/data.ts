import { setGrant } from "../src/access.js";
import { addComment } from "../src/comments.js";
import type { Db } from "../src/db.js";
import type { SentryEvent } from "../src/event.js";
import { mute, recordEvent, resolve } from "../src/issues.js";
import { createProject, NameTaken } from "../src/projects.js";
import { MUTE_OPTIONS } from "../src/triage.js";

// Demo data: three projects and a handful of issues, one resolved and one
// muted, with a comment. Everything here is made up; the people are
// example.com addresses.

const HOUR = 3_600_000;

const frame = (filename: string, fn: string, lineno: number, in_app = true, context?: [string[], string, string[]]) => ({
  filename,
  abs_path: `/srv/app/${filename}`,
  function: fn,
  lineno,
  in_app,
  ...(context ? { pre_context: context[0], context_line: context[1], post_context: context[2] } : {}),
});

const exc = (type: string, value: string, frames: object[]): SentryEvent =>
  ({ exception: { values: [{ type, value, stacktrace: { frames } }] } }) as SentryEvent;

export interface SeedOptions {
  now?: number;
  /** Emails to make admin of every demo project, so they see it without being site admins. */
  admins?: string[];
  log?: (line: string) => void;
}

export interface SeedResult {
  created: string[]; // projects made this run
  skipped: string[]; // projects that existed already, left alone
}

/**
 * Fills a database with the demo projects. A project whose name is taken is
 * skipped, so running it twice adds nothing. Events go straight to the
 * database: no alerts, notifications, or rate limit.
 */
export async function seed(db: Db, opts: SeedOptions = {}): Promise<SeedResult> {
  const now = opts.now ?? Date.now();
  const log = opts.log ?? (() => undefined);
  const result: SeedResult = { created: [], skipped: [] };

  const project = async (name: string) => {
    try {
      const p = await createProject(db, name);
      for (const email of opts.admins ?? []) await setGrant(db, p.id, "user", email, "admin");
      result.created.push(name);
      return p;
    } catch (err) {
      if (!(err instanceof NameTaken)) throw err;
      result.skipped.push(name);
      log(`${name} exists, skipped`);
      return null;
    }
  };

  /** Records `n` events spread over the last `hours` hours, oldest first. */
  const send = async (projectId: number, ev: SentryEvent, n: number, hours: number) => {
    let issueId = 0;
    for (let i = 0; i < n; i++) issueId = (await recordEvent(db, projectId, ev, now - Math.round(((n - i) / n) * hours * HOUR))).issueId;
    return issueId;
  };

  const billing = await project("billing-api");
  if (billing) {
    const base = { platform: "python", release: "billing-api@2.4.0", environment: "production", server_name: "billing-1", tags: { region: "us-east" } };
    const zero = await send(
      billing.id,
      {
        ...base,
        transaction: "POST /invoices/{id}/charge",
        ...exc("ZeroDivisionError", "division by zero", [
          frame("app/handlers.py", "charge_invoice", 41),
          frame("app/billing.py", "apply_discount", 17, true, [["def apply_discount(amount, invoice):", "    rate = invoice.discount"], "    return amount / rate", [""]]),
        ]),
        breadcrumbs: { values: [{ timestamp: now / 1000 - 2, category: "http", message: "POST /invoices/inv_1/charge" }] },
      },
      40,
      20,
    );
    await addComment(db, zero, "ana@example.com", "Invoices with a 0 discount rate hit this. Fix: treat 0 as no discount.", now - 2 * HOUR);
    const missing = await send(
      billing.id,
      { ...base, transaction: "GET /invoices/{id}", ...exc("KeyError", "'inv_9'", [frame("app/handlers.py", "get_invoice", 22), frame("app/store.py", "load", 9)]) },
      6,
      8,
    );
    await resolve(db, billing.id, missing, "ana@example.com");
    await send(billing.id, { ...base, level: "warning", message: "Payment webhook retried 3 times" }, 4, 12);
  }

  const web = await project("web-frontend");
  if (web) {
    const base = { platform: "javascript", release: "web@1.8.2", environment: "production", sdk: { name: "sentry.javascript.browser", version: "8.40.0" } };
    await send(
      web.id,
      {
        ...base,
        transaction: "/cart",
        tags: { browser: "Chrome 131" },
        ...exc("TypeError", "Cannot read properties of undefined (reading 'price')", [
          frame("node_modules/react-dom/cjs/react-dom.production.js", "commitRoot", 8812, false),
          frame("src/cart/CartTotal.tsx", "CartTotal", 21, true, [
            ["export function CartTotal({ items }: Props) {", "  const total = items.reduce("],
            "    (sum, item) => sum + item.product.price * item.qty,",
            ["    0,", "  );"],
          ]),
        ]),
      },
      25,
      6,
    );
    const slow = await send(web.id, { ...base, level: "info", message: "Checkout loaded slowly (4.2s)" }, 3, 3);
    await mute(db, web.id, slow, MUTE_OPTIONS.find((o) => o.value === "1w")!, "bo@example.com");
  }

  const worker = await project("payments-worker");
  if (worker) {
    await send(
      worker.id,
      {
        platform: "go",
        release: "payments-worker@0.9.1",
        environment: "staging",
        ...exc("*errors.errorString", "context deadline exceeded", [frame("internal/queue/consumer.go", "(*Consumer).handle", 118), frame("internal/ledger/client.go", "Post", 54)]),
      },
      8,
      4,
    );
  }

  return result;
}

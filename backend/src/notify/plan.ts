import type { Db } from "../db.js";
import { people } from "../users.js";
import { evaluate, type Facts, type Receiver, type Route } from "./routing.js";
import { defaultRecipients, type Delivery, getPersonalRoutes, getRouting } from "./store.js";

export interface Plan {
  routes: string[]; // names (or "route N") of the project routes that matched; empty means the default
  sunk: boolean; // a project sink route dropped the alert
  deliveries: Delivery[];
  people: string[]; // display names of the people reached
  others: string[]; // email addresses, channels, and webhooks reached
  skipped: string[]; // people whose own routing sent them nothing
}

const label = (routes: Route[], r: Route) => r.name || `route ${routes.indexOf(r) + 1}`;

/**
 * Works out who an alert goes to. The project's table picks the receivers
 * (or its default route when nothing matches). A person receiver is then
 * delivered through that person's own table; an email, channel, or webhook
 * receiver is sent as is. Every address gets one message however many
 * routes lead to it.
 */
export async function planFor(db: Db, projectId: number, f: Facts, assignee = ""): Promise<Plan> {
  const routes = await getRouting(db, projectId);
  const hit = evaluate(routes, f);
  const sending = (hit ?? []).filter((r) => !r.sink);
  const receivers: Receiver[] = hit
    ? sending.flatMap((r) => r.receivers)
    : (await defaultRecipients(db, projectId)).map((email) => ({ kind: "user" as const, target: email }));

  const plan: Plan = {
    routes: hit ? hit.map((r) => label(routes, r)) : [],
    sunk: !!hit?.some((r) => r.sink),
    deliveries: [],
    people: [],
    others: [],
    skipped: [],
  };
  const seen = new Set<string>();
  const add = (d: Delivery) => {
    const key = `${d.kind}:${d.target.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    plan.deliveries.push(d);
    return true;
  };

  // "The assignee" is a person receiver for whoever the issue is assigned to.
  const users = [
    ...new Set(
      receivers
        .flatMap((r) => (r.kind === "user" ? [r.target] : r.kind === "assignee" && assignee ? [assignee] : []))
        .map((e) => e.toLowerCase()),
    ),
  ];
  const names = await people(db, users);
  for (const email of users) {
    const name = names.get(email)?.displayName ?? email;
    const own = evaluate((await getPersonalRoutes(db, email)).routes, f)?.filter((r) => !r.sink) ?? [];
    let reached = false;
    for (const x of own.flatMap((r) => r.receivers)) {
      if (x.kind === "email" && add({ kind: "email", target: x.target })) reached = true;
      if (x.kind === "mattermost_dm" && add({ kind: "mattermost_dm", target: x.target })) reached = true;
    }
    if (reached) plan.people.push(name);
    else if (own.length === 0) plan.skipped.push(name);
  }
  for (const r of receivers) {
    if (r.kind === "email" && add({ kind: "email", target: r.target })) plan.others.push(r.target);
    if (r.kind === "mattermost" && add({ kind: "mattermost_channel", target: r.target })) plan.others.push(`~${r.target}`);
    if (r.kind === "webhook" && add({ kind: "webhook", target: r.target })) plan.others.push(new URL(r.target).host);
  }
  return plan;
}

/** One line saying who was notified, for the server log. */
export function summary(p: Plan): string {
  const list = (xs: string[]) => (xs.length > 4 ? `${xs.slice(0, 4).join(", ")} and ${xs.length - 4} more` : xs.join(", "));
  const quoted = p.routes.map((r) => `"${r}"`).join(", ");
  const via = p.routes.length ? `route ${quoted}` : "the default route";
  const who = [...p.people, ...p.others];
  let text = who.length ? `Notified ${list(who)} by ${via}` : p.sunk ? `Dropped by route ${quoted}` : `No one notified: ${via} sends to no one`;
  if (who.length && p.sunk) text += ", then dropped";
  if (p.skipped.length) text += `. Nothing sent to ${list(p.skipped)} by their own routing`;
  return text;
}

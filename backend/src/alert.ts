import type { Db } from "./db.js";
import type { SentryEvent } from "./event.js";
import type { Outbox } from "./notify/deliver.js";
import { planFor, summary } from "./notify/plan.js";
import { factsOf } from "./notify/routing.js";
import { enqueue, type Message } from "./notify/store.js";
import type { Project } from "./projects.js";

/**
 * Alerter tells people about new issues. The project's routing table decides
 * who hears about it; the messages go into the outbox.
 */
export class Alerter {
  constructor(
    private db: Db,
    private outbox: Outbox | null,
  ) {}

  newIssue(p: Project, issue: { id: number; title: string }, ev: SentryEvent, baseURL: string): void {
    const link = `${baseURL}/p/${p.id}/issues/${issue.id}`;
    const plan = planFor(this.db, p.id, factsOf(p.name, ev, "new"));
    enqueue(this.db, p.id, issue.id, plan.deliveries, alertMessage(p.name, issue, link));
    console.log(`alert project=${p.name} issue=${issue.id}: ${summary(plan)}`);
    if (plan.deliveries.length) this.outbox?.kick();
  }
}

export function alertMessage(project: string, issue: { id: number; title: string }, link: string): Message {
  const text = `New issue in ${project}: ${issue.title}\n${link}`;
  const json = JSON.stringify({ text, kind: "new", project, issue_id: issue.id, title: issue.title, url: link });
  return { subject: `New issue: ${issue.title}`, text, json };
}

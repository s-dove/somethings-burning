import type { Alerter } from "./alert.js";
import type { Db } from "./db.js";
import type { SentryEvent } from "./event.js";
import { recordEvent } from "./issues.js";
import type { LiveAlerts } from "./live.js";
import type { Project } from "./projects.js";

/**
 * TokenBucket is the ingest limit for the whole server. Over it, SDKs get a
 * 429 with Retry-After and stop sending for that long, which keeps a burst of
 * thousands of events from swamping the server.
 */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private rate: number, // events per second
    private burst: number,
  ) {
    this.tokens = burst;
  }

  allow(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

export interface Job {
  project: Project;
  event: SentryEvent;
  received: number;
  baseURL: string; // for links in alerts
}

/**
 * IngestQueue lets ingest requests answer at once. Jobs are written one at a
 * time, in arrival order, on later ticks, so a burst does not hold up the web
 * app. Past `limit` waiting jobs, push refuses.
 */
export class IngestQueue {
  private jobs: Job[] = [];
  private draining = false;

  constructor(
    private db: Db,
    private alerter: Alerter | null,
    private limit = 2000,
    private live: LiveAlerts | null = null,
  ) {}

  get length(): number {
    return this.jobs.length;
  }

  push(job: Job): boolean {
    if (this.jobs.length >= this.limit) return false;
    this.jobs.push(job);
    if (!this.draining) {
      this.draining = true;
      setImmediate(() => this.drain());
    }
    return true;
  }

  private drain(): void {
    // A slice per tick, so requests in between are answered.
    const until = Date.now() + 20;
    while (this.jobs.length && Date.now() < until) {
      const job = this.jobs.shift()!;
      try {
        const res = recordEvent(this.db, job.project.id, job.event, job.received);
        if (res.alert) {
          this.alerter?.notify(job.project, res, job.event, job.baseURL);
          this.live?.publish(job.project.id);
        }
      } catch (err) {
        console.error(`ingest event project=${job.project.name}:`, err);
      }
    }
    if (this.jobs.length) setImmediate(() => this.drain());
    else this.draining = false;
  }

  /** Resolves once everything queued so far is written (for tests and seeding). */
  async idle(): Promise<void> {
    while (this.draining) await new Promise((r) => setTimeout(r, 2));
  }
}

import { describe, expect, it } from "vitest";
import { listGrants } from "../src/access.js";
import { listActivity } from "../src/activity.js";
import { board } from "../src/board.js";
import { listComments } from "../src/comments.js";
import { createProject } from "../src/projects.js";
import { seed } from "../seed/data.js";
import { testDb } from "./helpers.js";

const NOW = Date.UTC(2026, 0, 15, 12);

describe("seed", () => {
  it("makes three projects with open, resolved, and muted issues", async () => {
    const db = await testDb();
    const res = await seed(db, { now: NOW });
    expect(res).toEqual({ created: ["billing-api", "web-frontend", "payments-worker"], skipped: [] });

    const all = await board(db, { status: "all", sort: "latest", q: "" }, NOW);
    expect(all.projects.map((p) => p.name)).toEqual(["billing-api", "payments-worker", "web-frontend"]);
    expect(all.counts).toEqual({ open: 4, resolved: 1, muted: 1, all: 6 });

    const byTitle = Object.fromEntries(all.issues.map((i) => [i.title, i]));
    const zero = byTitle["ZeroDivisionError: division by zero"]!;
    expect(zero).toMatchObject({ status: "open", eventCount: 40, culprit: "POST /invoices/{id}/charge", projectName: "billing-api" });
    expect(zero.hours.reduce((a, b) => a + b, 0)).toBe(40);
    expect(byTitle["KeyError: 'inv_9'"]).toMatchObject({ status: "resolved", eventCount: 6 });
    expect(byTitle["Checkout loaded slowly (4.2s)"]).toMatchObject({ status: "muted", mute: { kind: "for" } });
    expect(byTitle["TypeError: Cannot read properties of undefined (reading 'price')"]).toMatchObject({ culprit: "/cart", eventCount: 25 });
    expect(byTitle["*errors.errorString: context deadline exceeded"]).toMatchObject({ projectName: "payments-worker", eventCount: 8 });

    // A comment and who did what are on the issues.
    expect((await listComments(db, zero.id)).map((c) => c.author)).toEqual(["ana@example.com"]);
    expect((await listActivity(db, byTitle["KeyError: 'inv_9'"]!.id)).map((a) => [a.kind, a.actor])).toEqual([
      ["resolved", "ana@example.com"],
      ["created", ""],
    ]);
  });

  it("spreads events over the past hours, so the heat strips have history", async () => {
    const db = await testDb();
    await seed(db, { now: NOW });
    const b = await board(db, { status: "all", sort: "latest", q: "" }, NOW);
    const zero = b.issues.find((i) => i.title.startsWith("ZeroDivisionError"))!;
    expect(zero.hours.filter((n) => n > 0).length).toBeGreaterThan(10);
    expect(zero.firstSeen).toBeLessThan(NOW - 19 * 3_600_000);
  });

  it("adds nothing the second time, and leaves a project of the same name alone", async () => {
    const db = await testDb();
    await createProject(db, "Web-Frontend");
    const first = await seed(db, { now: NOW });
    expect(first).toEqual({ created: ["billing-api", "payments-worker"], skipped: ["web-frontend"] });
    expect(await seed(db, { now: NOW })).toEqual({ created: [], skipped: ["billing-api", "web-frontend", "payments-worker"] });
    expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM issues"))!.n).toBe(4);
  });

  it("makes the given people admin of each demo project", async () => {
    const db = await testDb();
    await seed(db, { now: NOW, admins: ["you@example.com"] });
    const projects = await db.all<{ id: number }>("SELECT id FROM projects");
    for (const p of projects) expect((await listGrants(db, p.id)).map((g) => [g.subject, g.role])).toEqual([["you@example.com", "admin"]]);
  });

  it("uses only made-up names", async () => {
    const db = await testDb();
    await seed(db, { now: NOW });
    const dump = JSON.stringify([
      await db.all("SELECT name FROM projects"),
      await db.all("SELECT payload FROM events"),
      await db.all("SELECT author, body FROM comments"),
      await db.all("SELECT actor FROM activity"),
    ]);
    // Emails, not releases like billing-api@2.4.0: the domain ends in letters.
    const emails = dump.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(email).toMatch(/@example\.com$/);
    expect(dump).not.toMatch(/tesla|tzla/i);
  });
});

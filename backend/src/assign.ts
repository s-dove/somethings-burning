import { Hono } from "hono";
import type { Access } from "./access.js";
import { addActivity } from "./activity.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import { NotFound } from "./issues.js";
import { actor, body, P, projectRoute } from "./project-routes.js";

/** Assigns an issue to a person (email), or to no one with "". */
export function assign(db: Db, projectId: number, issueId: number, assignee: string, by: string): Promise<void> {
  return db.tx(async (t) => {
    const row = await t.get<{ assignee: string }>(`SELECT assignee FROM issues WHERE project_id = ? AND id = ? ${t.forUpdate}`, projectId, issueId);
    if (!row) throw new NotFound();
    const next = assignee.trim().toLowerCase();
    if (row.assignee === next) return;
    await t.run("UPDATE issues SET assignee = ? WHERE id = ?", next, issueId);
    await addActivity(t, issueId, Date.now(), "assigned", next ? `Assigned to ${next}` : "Unassigned", { actor: by });
  });
}

/** POST .../issues/<n>/assign with { assignee }: members assign, or unassign with "". */
export function assignRoutes(db: Db, access: Access): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const withRole = projectRoute(db, access);
  app.post(
    `${P}/issues/:issue{[0-9]+}/assign`,
    withRole("member", async (c, f) => {
      const { assignee } = await body<{ assignee?: unknown }>(c);
      const email = typeof assignee === "string" ? assignee.trim() : "";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ detail: "assign to an email, or to no one" }, 400);
      await assign(db, f.project.id, Number(c.req.param("issue")), email, actor(c));
      return c.json({ ok: true });
    }),
  );
  return app;
}

import { Hono, type Context } from "hono";
import { atLeast, type Access, type Role } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import type { Senders } from "./notify/deliver.js";
import { checkRoutes, FIELDS, OPS, PROJECT_KINDS } from "./notify/routing.js";
import { defaultRecipients, getRouting, saveRouting } from "./notify/store.js";
import { getProject } from "./projects.js";
import { people } from "./users.js";

/** A project's notification routing table. Anyone with a role reads it; only admins change it. */
export function routingRoutes(db: Db, access: Access, senders: Senders): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const view = (c: Context<AppEnv>, projectId: number, role: Role) => {
    const project = getProject(db, projectId)!;
    const defaults = defaultRecipients(db, projectId);
    const routes = getRouting(db, projectId);
    const persons = routes.flatMap((r) => r.receivers.filter((x) => x.kind === "user").map((x) => x.target));
    const names = people(db, [...defaults, ...persons]);
    return c.json({
      project: { id: project.id, name: project.name, role },
      routes,
      // Display names of the people in the table, by email.
      names: Object.fromEntries(persons.map((e) => [e, names.get(e)?.displayName ?? e])),
      defaultRecipients: defaults.map((email) => ({ email, name: names.get(email)?.displayName ?? email })),
      fields: FIELDS,
      ops: OPS,
      receiverKinds: PROJECT_KINDS,
      email: senders.emailEnabled,
      mattermost: senders.mattermost.enabled,
    });
  };

  const load = (c: Context<AppEnv>) => {
    const id = Number(c.req.param("id"));
    const role = getProject(db, id) ? access.role(id, c.get("user")) : null;
    return role ? { id, role } : null;
  };

  app.get("/projects/:id{[0-9]+}/routing", (c) => {
    const found = load(c);
    if (!found) return c.json({ detail: "project not found" }, 404);
    return view(c, found.id, found.role);
  });

  // PUT replaces the whole table, in order. The default route is fixed.
  app.put("/projects/:id{[0-9]+}/routing", async (c) => {
    const found = load(c);
    if (!found) return c.json({ detail: "project not found" }, 404);
    if (!atLeast(found.role, "admin")) return c.json({ detail: "changing notifications needs the admin role" }, 403);
    const body = (await c.req.json().catch(() => null)) as { routes?: unknown } | null;
    const checked = checkRoutes(body?.routes, "project");
    if ("error" in checked) return c.json({ detail: checked.error }, 400);
    saveRouting(db, found.id, checked.routes);
    return view(c, found.id, found.role);
  });

  return app;
}

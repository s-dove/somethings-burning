import type { Context } from "hono";
import { atLeast, type Access, type Role } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import { NotFound } from "./issues.js";
import { getProject, type Project } from "./projects.js";

// What the project feature routes share: finding the project and the
// caller's role on it, and reading a JSON body.

export const P = "/projects/:id{[0-9]+}";

export const notFound = (c: Context) => c.json({ detail: "not found" }, 404);

export const body = async <T>(c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as T;

/** Who did it, for the issue history: the person, or "api token". */
export const actor = (c: Context<AppEnv>) => c.get("user")?.email ?? (c.get("token") ? "api token" : "");

export type Found = { project: Project; role: Role };

/** A handler for a project the caller holds at least `role` in; anything else is a 404 or 403, and NotFound a 404. */
export function projectRoute(db: Db, access: Access) {
  const load = async (c: Context<AppEnv>): Promise<Found | null> => {
    const project = await getProject(db, Number(c.req.param("id")));
    const role = project ? await access.role(project.id, c.get("user")) : null;
    return project && role ? { project, role } : null;
  };
  return (role: Role, fn: (c: Context<AppEnv>, found: Found) => Promise<Response>) => async (c: Context<AppEnv>) => {
    const found = await load(c);
    if (!found) return notFound(c);
    if (!atLeast(found.role, role)) return c.json({ detail: `this needs the ${role} role` }, 403);
    try {
      return await fn(c, found);
    } catch (err) {
      if (err instanceof NotFound) return notFound(c);
      throw err;
    }
  };
}

import { Hono } from "hono";
import type { Access } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import { P, projectRoute } from "./project-routes.js";
import { checkSection, getConfig, saveConfig, type ProjectConfig } from "./settings.js";

/** A project's settings sections: read by anyone on it, saved one section at a time by admins. */
export function configRoutes(db: Db, access: Access): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const withRole = projectRoute(db, access);

  app.get(`${P}/config`, withRole("viewer", async (c, f) => c.json({ project: { id: f.project.id, name: f.project.name, role: f.role }, config: await getConfig(db, f.project.id) })));

  app.put(
    `${P}/config/:section`,
    withRole("admin", async (c, f) => {
      const section = c.req.param("section") as keyof ProjectConfig;
      const checked = checkSection(section, await c.req.json().catch(() => null));
      if ("error" in checked) return c.json({ detail: checked.error }, 400);
      const config = await getConfig(db, f.project.id);
      (config as unknown as Record<string, unknown>)[section] = checked.value;
      await saveConfig(db, f.project.id, config);
      return c.json({ project: { id: f.project.id, name: f.project.name, role: f.role }, config });
    }),
  );

  return app;
}

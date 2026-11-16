import { Hono } from "hono";
import type { Access } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import { body, notFound, P, projectRoute } from "./project-routes.js";
import { upsertRelease } from "./releases.js";
import { forgetMaps } from "./source/sourcemaps.js";

const MAX_ARTIFACT = 20 * 1024 * 1024;
const NAME = /^[\w.~:/@+-]{1,500}$/;

/** A release's source maps: listed by anyone on the project; uploaded (admins or an API token) and deleted (admins). */
export function sourceMapRoutes(db: Db, access: Access): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const withRole = projectRoute(db, access);

  app.get(
    `${P}/sourcemaps`,
    withRole("viewer", async (c, f) => {
      const release = c.req.query("release");
      const rows = await db.all<{ release: string; name: string; size: number; created_at: number }>(
        `SELECT release, name, size, created_at FROM artifacts WHERE project_id = ? ${release ? "AND release = ?" : ""} ORDER BY created_at DESC LIMIT 500`,
        f.project.id,
        ...(release ? [release] : []),
      );
      return c.json({ artifacts: rows.map((r) => ({ release: r.release, name: r.name, size: r.size, createdAt: r.created_at })) });
    }),
  );

  // Upload: multipart (release, and one or more files; a file's name is its
  // URL path, like ~/static/js/app.js.map) or JSON { release, name, content }.
  app.post(
    `${P}/sourcemaps`,
    withRole("admin", async (c, f) => {
      const files: { name: string; content: string }[] = [];
      let release = "";
      if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
        const form = await c.req.parseBody({ all: true });
        release = String(form.release ?? "").trim();
        const prefix = String(form.prefix ?? "~/").trim();
        for (const v of Object.values(form).flat()) {
          if (v instanceof File) {
            if (v.size > MAX_ARTIFACT) return c.json({ detail: `${v.name} is over 20 MB` }, 413);
            const name = v.name.includes("/") ? v.name : `${prefix.replace(/\/?$/, "/")}${v.name}`;
            files.push({ name, content: await v.text() });
          }
        }
      } else {
        const b = await body<{ release?: unknown; name?: unknown; content?: unknown }>(c);
        release = String(b.release ?? "").trim();
        if (typeof b.content === "string") files.push({ name: String(b.name ?? "").trim(), content: b.content });
      }
      if (!release || release.length > 200) return c.json({ detail: "name the release the maps belong to" }, 400);
      if (!files.length) return c.json({ detail: "attach at least one .map file" }, 400);
      for (const file of files) {
        if (!NAME.test(file.name) || !file.name.endsWith(".map")) return c.json({ detail: `"${file.name}" should be a .map path, like ~/static/js/app.js.map` }, 400);
        if (file.content.length > MAX_ARTIFACT) return c.json({ detail: `${file.name} is over 20 MB` }, 413);
        try {
          const m = JSON.parse(file.content) as { version?: unknown; mappings?: unknown };
          if (m.version !== 3 || typeof m.mappings !== "string") throw new Error();
        } catch {
          return c.json({ detail: `${file.name} is not a version 3 source map` }, 400);
        }
      }
      await upsertRelease(db, f.project.id, release, "");
      for (const file of files) {
        await db.run(
          `INSERT INTO artifacts (project_id, release, name, content, size, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (project_id, release, name) DO UPDATE SET content = excluded.content, size = excluded.size, created_at = excluded.created_at`,
          f.project.id,
          release,
          file.name,
          file.content,
          file.content.length,
          Date.now(),
        );
      }
      forgetMaps(f.project.id, release);
      return c.json({ release, uploaded: files.map((x) => x.name) }, 201);
    }),
  );

  app.delete(
    `${P}/sourcemaps`,
    withRole("admin", async (c, f) => {
      const b = await body<{ release?: unknown; name?: unknown }>(c);
      const release = String(b.release ?? "");
      const r = await db.run(
        `DELETE FROM artifacts WHERE project_id = ? AND release = ? ${typeof b.name === "string" ? "AND name = ?" : ""}`,
        f.project.id,
        release,
        ...(typeof b.name === "string" ? [b.name] : []),
      );
      forgetMaps(f.project.id, release);
      return r.changes ? c.body(null, 204) : notFound(c);
    }),
  );

  return app;
}

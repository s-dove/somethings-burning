import { Hono } from "hono";
import type { Access } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Config } from "./env.js";
import type { Db } from "./db.js";
import { getIssue } from "./issues.js";
import { actor, body, notFound, P, projectRoute } from "./project-routes.js";
import { GitHubSource } from "./source/github.js";
import type { CodeSources } from "./source/index.js";
import { getSources } from "./sources.js";
import { publicBase } from "./url.js";

/** A GitHub issue from an issue, in the project's primary repository when it is on GitHub. Members only. */
export function githubIssueRoutes(db: Db, access: Access, deps: { code: CodeSources; config: Config }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const withRole = projectRoute(db, access);
  app.post(
    `${P}/issues/:issue{[0-9]+}/github`,
    withRole("member", async (c, f) => {
      const issue = await getIssue(db, f.project.id, Number(c.req.param("issue")));
      if (!issue) return notFound(c);
      // One more after the first needs { again: true }, so a double click cannot make two.
      const again = (await body<{ again?: boolean }>(c)).again === true;
      if (issue.externalUrl && !again) return c.json({ detail: "a GitHub issue was made already", url: issue.externalUrl }, 409);
      const src = (await getSources(db, f.project.id)).find((s) => s.primary && s.kind === "github");
      if (!src) return c.json({ detail: "the project's primary code source is not a GitHub repository" }, 400);
      const link = `${publicBase(c, deps.config.baseURL)}/issues/${issue.id}`;
      const text = [
        `**${issue.title}**`,
        "",
        `${issue.eventCount} events since ${new Date(issue.firstSeen).toISOString().slice(0, 10)}${issue.culprit ? ` in \`${issue.culprit}\`` : ""}.`,
        "",
        `Burning: ${link}`,
      ].join("\n");
      const reader = deps.code.open(src);
      if (!(reader instanceof GitHubSource)) return c.json({ detail: "the primary source is not read through GitHub" }, 400);
      let url: string;
      try {
        url = await reader.createIssue(issue.title.slice(0, 250), text);
      } catch (err) {
        return c.json({ detail: (err as Error).message }, 502);
      }
      await db.run("UPDATE issues SET external_url = ? WHERE id = ?", url, issue.id);
      await db.run("INSERT INTO activity (issue_id, at, kind, text, actor) VALUES (?, ?, 'linked', ?, ?)", issue.id, Date.now(), `GitHub issue ${url}`, actor(c));
      return c.json({ url });
    }),
  );
  return app;
}

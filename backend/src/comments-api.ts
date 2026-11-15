import { Hono, type Context } from "hono";
import { atLeast, type Access, type Role } from "./access.js";
import type { AppEnv } from "./api.js";
import { addComment, type Comment, deleteComment, editComment, getComment, listComments, MAX_COMMENT } from "./comments.js";
import type { Db } from "./db.js";
import { getIssue } from "./issues.js";
import { people, usernameFrom } from "./users.js";

// Only the author edits a comment: an admin changing someone's words would
// misquote them. The author may delete their own comment, and admins any.
const canEdit = (c: Pick<Comment, "author">, email: string) => email !== "" && c.author === email;
const canDelete = (c: Pick<Comment, "author">, email: string, role: Role) => canEdit(c, email) || atLeast(role, "admin");

/**
 * An issue's comments, each saying what this person may do, with the name to
 * show for its author and the username to @-mention. Earlier texts are kept
 * but not sent; nothing shows them yet.
 */
export async function commentsView(db: Db, issueId: number, email: string, role: Role) {
  const list = await listComments(db, issueId);
  const who = await people(db, list.map((c) => c.author));
  return list.map(({ history: _, ...c }) => {
    const p = c.author ? (who.get(c.author.toLowerCase()) ?? { displayName: c.author, username: usernameFrom({}, c.author) }) : null;
    return { ...c, authorName: p?.displayName ?? "", authorUsername: p?.username ?? "", canEdit: canEdit(c, email), canDelete: canDelete(c, email, role) };
  });
}

async function readBody(c: Context<AppEnv>): Promise<string | { error: string }> {
  const body = String(((await c.req.json().catch(() => ({}))) as { body?: unknown }).body ?? "").trim();
  if (!body) return { error: "write something first" };
  if (body.length > MAX_COMMENT) return { error: `keep it under ${MAX_COMMENT.toLocaleString()} characters` };
  return body;
}

/**
 * Adds, edits, and deletes comments. Anyone with a role on the project may
 * comment; viewers too, since a comment does not change the issue.
 */
export function commentRoutes(db: Db, access: Access): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const base = "/projects/:id{[0-9]+}/issues/:issue{[0-9]+}/comments";

  const load = async (c: Context<AppEnv>) => {
    const projectId = Number(c.req.param("id"));
    const role = await access.role(projectId, c.get("user"));
    const issue = role ? await getIssue(db, projectId, Number(c.req.param("issue"))) : undefined;
    return role && issue ? { role, issue, email: c.get("user")?.email.toLowerCase() ?? "" } : null;
  };

  app.post(base, async (c) => {
    const found = await load(c);
    if (!found) return c.json({ detail: "issue not found" }, 404);
    if (!found.email) return c.json({ detail: "sign in to comment" }, 403);
    const body = await readBody(c);
    if (typeof body !== "string") return c.json({ detail: body.error }, 400);
    await addComment(db, found.issue.id, found.email, body);
    return c.json(await commentsView(db, found.issue.id, found.email, found.role));
  });

  // PATCH changes the text; the old text goes into the comment's history.
  app.patch(`${base}/:comment{[0-9]+}`, async (c) => {
    const found = await load(c);
    if (!found) return c.json({ detail: "issue not found" }, 404);
    const comment = await getComment(db, found.issue.id, Number(c.req.param("comment")));
    if (!comment) return c.json({ detail: "comment not found" }, 404);
    if (!canEdit(comment, found.email)) return c.json({ detail: "only the author can edit it" }, 403);
    const body = await readBody(c);
    if (typeof body !== "string") return c.json({ detail: body.error }, 400);
    await editComment(db, comment.id, body);
    return c.json(await commentsView(db, found.issue.id, found.email, found.role));
  });

  app.delete(`${base}/:comment{[0-9]+}`, async (c) => {
    const found = await load(c);
    if (!found) return c.json({ detail: "issue not found" }, 404);
    const comment = await getComment(db, found.issue.id, Number(c.req.param("comment")));
    if (!comment) return c.json({ detail: "comment not found" }, 404);
    if (!canDelete(comment, found.email, found.role)) return c.json({ detail: "only the author or an admin can delete it" }, 403);
    await deleteComment(db, comment.id);
    return c.json(await commentsView(db, found.issue.id, found.email, found.role));
  });

  return app;
}

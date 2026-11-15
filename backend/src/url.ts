import type { Context } from "hono";

/** The URL people reach the app at: the configured base URL, or what the request came in on. */
export function publicBase(c: Context, baseURL = ""): string {
  if (baseURL) return baseURL.replace(/\/$/, "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost";
  const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function dsn(c: Context, baseURL: string, projectId: number, key: string): string {
  const u = new URL(publicBase(c, baseURL));
  return `${u.protocol}//${key}@${u.host}${u.pathname.replace(/\/$/, "")}/${projectId}`;
}

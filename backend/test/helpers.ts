import { Hono, type Context } from "hono";
import type { SmtpSettings } from "../src/mail.js";
import { createApp } from "../src/app.js";
import type { Authenticator, User } from "../src/auth.js";
import { openDb, type Db } from "../src/db.js";
import { readConfig } from "../src/env.js";
import { Senders } from "../src/notify/deliver.js";
import { Mattermost } from "../src/notify/mattermost.js";
import type { Delivery, Message } from "../src/notify/store.js";
import { createProject } from "../src/projects.js";
import { recordLogin } from "../src/users.js";

export const ADMIN = "admin@example.com";

/**
 * Signs in whoever the X-Test-User header names ("email" or
 * "email|group,group"), or else `fallback` (a site admin by default).
 */
export const testAuth = (fallback: string | null = ADMIN): Authenticator => ({
  methods: { oidc: false, oidcName: "SSO", password: true },
  async user(c: Context): Promise<User | null> {
    const raw = c.req.header("x-test-user") ?? fallback;
    if (!raw) return null;
    const [email, groups] = raw.split("|");
    return { email: email!, name: "", groups: groups ? groups.split(",") : [], username: email!.split("@")[0]!, displayName: email! };
  },
  routes: () => new Hono(),
});

/** Senders that record what they would send. */
export class FakeSenders extends Senders {
  sent: { d: Delivery; m: Message }[] = [];
  constructor(email = true) {
    super({ host: email ? "smtp.example.com" : "", from: email ? "burning@example.com" : "" } as SmtpSettings, new Mattermost({ url: "", token: "" }));
  }
  override async send(d: Delivery, m: Message): Promise<void> {
    this.sent.push({ d, m });
  }
}

/**
 * A fresh app. By default requests are signed in as a site admin; with
 * auth: true only the X-Test-User header signs anyone in.
 */
export function setup(opts: { auth?: boolean; siteAdmins?: string } = {}) {
  const db = openDb(":memory:");
  const senders = new FakeSenders();
  const config = readConfig({ BURNING_SITE_ADMINS: [ADMIN, opts.siteAdmins ?? ""].join(",") });
  const { app, outbox, queue, live } = createApp(db, { auth: testAuth(opts.auth ? null : ADMIN), config, senders });
  const project = createProject(db, "web");
  return { db, app, outbox, queue, live, senders, project };
}

export const as = (email: string, groups: string[] = []) => ({ "x-test-user": groups.length ? `${email}|${groups.join(",")}` : email });

export function signIn(db: Db, email: string, claims: Record<string, unknown> = {}) {
  recordLogin(db, { email, issuer: "https://issuer.example.com", claims: { sub: email, email, ...claims } });
}

export const json = (body: unknown, headers: Record<string, string> = {}) => ({
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export const pythonError = {
  event_id: "fc6d8c0c43fc4630ad850ee518f1b9d0",
  platform: "python",
  level: "error",
  exception: {
    values: [
      {
        type: "ZeroDivisionError",
        value: "division by zero",
        stacktrace: {
          frames: [
            { filename: "lib/runner.py", function: "run", lineno: 10, in_app: false },
            { filename: "app/views.py", module: "app.views", function: "ratio", lineno: 42, in_app: true },
          ],
        },
      },
    ],
  },
};

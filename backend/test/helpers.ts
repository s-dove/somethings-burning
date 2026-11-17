import { Hono, type Context } from "hono";
import type { SmtpSettings } from "../src/mail.js";
import { createApp } from "../src/app.js";
import type { Authenticator, User } from "../src/auth.js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { openDb, type Db } from "../src/db.js";
import { readConfig } from "../src/env.js";
import { Senders } from "../src/notify/deliver.js";
import { Mattermost } from "../src/notify/mattermost.js";
import type { Delivery, Message } from "../src/notify/store.js";
import { createProject } from "../src/projects.js";
import type { CodeSources } from "../src/source/index.js";
import { recordLogin } from "../src/users.js";

export const ADMIN = "admin@example.com";

/**
 * Signs in whoever the X-Test-User header names ("email" or
 * "email|group,group"), or else `fallback` (a site admin by default).
 */
export const testAuth = (fallback: string | null = ADMIN): Authenticator => ({
  methods: { oidc: false, oidcName: "SSO", password: true, github: false },
  async user(c: Context): Promise<User | null> {
    const raw = c.req.header("x-test-user") ?? fallback;
    if (!raw) return null;
    const [email, groups] = raw.split("|");
    return { email: email!, name: "", groups: groups ? groups.split(",") : [], username: email!.split("@")[0]!, displayName: email!, lang: "" };
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
 * A fresh, empty database: SQLite in memory, or a schema of its own on the
 * Postgres server BURNING_TEST_PG names, so the same tests run on both.
 */
export async function testDb(): Promise<Db> {
  return process.env.BURNING_TEST_PG ? openDb(await testPgUrl()) : openDb(":memory:");
}

/** A URL for a new, empty schema on the test Postgres; open it twice to play two servers. */
export async function testPgUrl(): Promise<string> {
  const url = process.env.BURNING_TEST_PG!;
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${schema}`);
  return u.toString();
}

/** The target a test should open for a database it reopens: a file, or the test Postgres. */
export const usingPostgres = (): boolean => !!process.env.BURNING_TEST_PG;

/**
 * A fresh app. By default requests are signed in as a site admin; with
 * auth: true only the X-Test-User header signs anyone in.
 */
export async function setup(opts: { auth?: boolean; siteAdmins?: string; code?: CodeSources } = {}) {
  const db = await testDb();
  const senders = new FakeSenders();
  const config = readConfig({ BURNING_SITE_ADMINS: [ADMIN, opts.siteAdmins ?? ""].join(",") });
  const { app, outbox, queue, live, access } = createApp(db, { auth: testAuth(opts.auth ? null : ADMIN), config, senders, code: opts.code });
  const project = await createProject(db, "web");
  return { db, app, outbox, queue, live, access, senders, project };
}

export const as = (email: string, groups: string[] = []) => ({ "x-test-user": groups.length ? `${email}|${groups.join(",")}` : email });

export async function signIn(db: Db, email: string, claims: Record<string, unknown> = {}) {
  await recordLogin(db, { email, issuer: "https://issuer.example.com", claims: { sub: email, email, ...claims } });
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

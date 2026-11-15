import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Auth, Sessions } from "../src/auth.js";
import { openDb } from "../src/db.js";
import { hashPassword, parseAccounts, PasswordLogin, verifyPassword } from "../src/passwords.js";
import { json } from "./helpers.js";

async function app(lines: string[]) {
  const file = join(mkdtempSync(join(tmpdir(), "burning-")), "passwords");
  writeFileSync(file, lines.join("\n"));
  const db = await openDb(":memory:");
  const auth = new Auth(new Sessions(db, "test-secret", false), null, new PasswordLogin(file));
  return { ...createApp(db, { auth }), db, file };
}

const login = (a: Awaited<ReturnType<typeof app>>, email: string, password: string) =>
  a.app.request("/auth/password", { method: "POST", ...json({ email, password }) });

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = hashPassword("correct horse");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(verifyPassword("x", "plain-text")).toBe(false);
  });

  it("reads accounts with groups, skipping comments", async () => {
    expect(parseAccounts("# people\nAna@Example.com:scrypt$x:eng, ops\n\nbo@example.com:scrypt$y\n")).toEqual([
      { email: "ana@example.com", hash: "scrypt$x", groups: ["eng", "ops"] },
      { email: "bo@example.com", hash: "scrypt$y", groups: [] },
    ]);
  });

  it("signs in with the right password and starts a session", async () => {
    const a = await app([`ana@example.com:${hashPassword("pw")}:eng`]);
    expect((await login(a, "ana@example.com", "nope")).status).toBe(401);
    const ok = await login(a, "Ana@Example.com", "pw");
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0]!;
    const session = (await (await a.app.request("/api/session", { headers: { cookie } })).json()) as {
      methods: { password: boolean };
      user: { email: string; groups: string[]; username: string };
    };
    expect(session.methods.password).toBe(true);
    expect(session.user).toMatchObject({ email: "ana@example.com", groups: ["eng"], username: "ana" });
    expect((await a.app.request("/api/board", { headers: { cookie } })).status).toBe(200);

    // Signing out ends the session.
    await a.app.request("/auth/logout", { method: "POST", headers: { cookie } });
    expect((await a.app.request("/api/board", { headers: { cookie } })).status).toBe(401);
  });

  it("locks an email out after five failures", async () => {
    const a = await app([`ana@example.com:${hashPassword("pw")}`]);
    for (let i = 0; i < 5; i++) expect((await login(a, "ana@example.com", "nope")).status).toBe(401);
    expect((await login(a, "ana@example.com", "pw")).status).toBe(429);
  });

  it("reads the file at every sign-in", async () => {
    const a = await app([]);
    expect((await login(a, "new@example.com", "pw")).status).toBe(401);
    writeFileSync(a.file, `new@example.com:${hashPassword("pw")}\n`);
    expect((await login(a, "new@example.com", "pw")).status).toBe(200);
  });
});

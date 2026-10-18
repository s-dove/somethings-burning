import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { readConfig } from "../src/env.js";
import { as, testAuth } from "./helpers.js";

describe("site settings", () => {
  it("shows what is configured, never the secrets", async () => {
    const config = readConfig({
      BURNING_PASSWORD_FILE: "/etc/burning/passwords",
      BURNING_OIDC_ISSUER: "https://id.example.com",
      BURNING_OIDC_CLIENT_ID: "burning",
      BURNING_OIDC_CLIENT_SECRET: "s3cret",
      BURNING_OIDC_REDIRECT_URL: "https://burning.example.com/auth/callback",
      BURNING_SITE_ADMINS: "root@example.com,ops",
      BURNING_SMTP_HOST: "smtp.example.com",
      BURNING_SMTP_TLS: "true",
      BURNING_SMTP_USER: "burning",
      BURNING_SMTP_PASSWORD: "hunter2",
    });
    const { app } = createApp(openDb(":memory:"), { auth: testAuth(null), config });
    expect((await app.request("/api/site/settings")).status).toBe(401);
    const res = await app.request("/api/site/settings", { headers: as("ana@example.com") });
    const text = await res.text();
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text)).toMatchObject({
      signIn: {
        password: { enabled: true, file: "/etc/burning/passwords" },
        oidc: { enabled: true, issuer: "https://id.example.com", clientAuth: "client_secret_basic", secretSet: true, name: "SSO" },
        siteAdmins: 2,
      },
      email: { enabled: false, missing: ["BURNING_SMTP_FROM"], host: "smtp.example.com", port: 587, security: "starttls", user: "burning", passwordSet: true },
      mattermost: { enabled: false, url: "", tokenSet: false },
    });
  });
});

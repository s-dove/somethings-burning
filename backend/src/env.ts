import { readFileSync } from "node:fs";

// loadEnvFile reads KEY=VALUE lines into process.env. Values already set win,
// so a shell export overrides the file.
export function loadEnvFile(path: string): void {
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (let line of body.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^export\s+/, "");
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

const num = (env: NodeJS.ProcessEnv, key: string, def: number): number => {
  const v = env[key];
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : def;
};

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// readConfig reads the server's settings from the environment. Nothing has
// a default that points at a real service: sign-in, email, and Mattermost
// stay off until they are configured. With no sign-in configured, no one can
// use the app (SDKs can still report).
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    port: num(env, "BURNING_PORT", 8195),
    db: env.BURNING_DB || "data/burning.db",
    // The public URL of the web app, for DSNs and links in alerts. Empty
    // means the address the request came in on.
    baseURL: (env.BURNING_BASE_URL ?? "").replace(/\/$/, ""),
    // Ingest limit for the whole server: events per second, and the burst
    // allowed above it. Over it, SDKs are told to wait (429, Retry-After).
    rate: num(env, "BURNING_RATE", 50),
    burst: num(env, "BURNING_BURST", 500),
    // Event payloads older than this are deleted; issues and counts stay.
    retentionDays: num(env, "BURNING_RETENTION_DAYS", 30),
    // Emails or group names that are admin on every project.
    siteAdmins: list(env.BURNING_SITE_ADMINS),
    // The secret that signs session cookies. Empty means a random one kept in the database.
    sessionSecret: env.BURNING_SESSION_SECRET ?? "",
    // Password sign-in: a file of email:hash[:groups] lines. On when set.
    passwordFile: env.BURNING_PASSWORD_FILE ?? "",
    // Any OpenID Connect provider (Keycloak, Okta, Auth0, Google, Microsoft
    // Entra ID, GitLab, Authentik, Dex, ...): the endpoints come from the
    // issuer's discovery document. On when the issuer is set.
    oidc: {
      issuer: env.BURNING_OIDC_ISSUER ?? "",
      clientId: env.BURNING_OIDC_CLIENT_ID ?? "",
      clientSecret: env.BURNING_OIDC_CLIENT_SECRET ?? "",
      // How the client authenticates to the token endpoint:
      // client_secret_basic, client_secret_post, or none (a public client,
      // PKCE only). Empty means basic with a secret, none without.
      clientAuth: env.BURNING_OIDC_CLIENT_AUTH ?? "",
      redirectURL: env.BURNING_OIDC_REDIRECT_URL ?? "",
      scope: env.BURNING_OIDC_SCOPE ?? "openid email profile groups",
      groupsClaim: env.BURNING_OIDC_GROUPS_CLAIM ?? "groups",
      // What the sign-in button calls the provider: "Sign in with <name>".
      // Empty means "SSO".
      name: env.BURNING_OIDC_NAME ?? "",
    },
    // Email goes out when a host and a From address are set. Port 587 with
    // STARTTLS (tls) is the usual submission port; ssl is TLS from the first byte.
    smtp: {
      host: env.BURNING_SMTP_HOST ?? "",
      port: num(env, "BURNING_SMTP_PORT", 587),
      user: env.BURNING_SMTP_USER ?? "",
      password: env.BURNING_SMTP_PASSWORD ?? "",
      from: env.BURNING_SMTP_FROM ?? "",
      tls: env.BURNING_SMTP_TLS === "true",
      ssl: env.BURNING_SMTP_SSL === "true",
    },
    // A Mattermost bot account for direct messages and channel posts.
    mattermost: {
      url: env.BURNING_MATTERMOST_URL ?? "",
      token: env.BURNING_MATTERMOST_TOKEN ?? "",
    },
  };
}

export type Config = ReturnType<typeof readConfig>;

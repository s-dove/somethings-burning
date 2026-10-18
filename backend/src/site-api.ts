import { Hono } from "hono";
import type { AppEnv } from "./api.js";
import { CLIENT_AUTH } from "./auth.js";
import type { Config } from "./env.js";
import type { Senders } from "./notify/deliver.js";

/**
 * The server settings page. It is read-only: the values come from the
 * environment. Passwords, secrets, and tokens are never sent, only whether
 * they are set. Who gets alerts is set per project (routing) and per person,
 * not here.
 */
export function siteRoutes(config: Config, senders: Senders): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/site/settings", (c) => {
    const { smtp, oidc, mattermost } = config;
    const missing = [!smtp.host && "BURNING_SMTP_HOST", !smtp.from && "BURNING_SMTP_FROM"].filter((m): m is string => !!m);
    const clientAuth = oidc.clientAuth || (oidc.clientSecret ? "client_secret_basic" : "none");
    return c.json({
      signIn: {
        password: { enabled: !!config.passwordFile, file: config.passwordFile },
        oidc: {
          enabled: !!oidc.issuer,
          issuer: oidc.issuer,
          clientId: oidc.clientId,
          clientAuth: (CLIENT_AUTH as readonly string[]).includes(clientAuth) ? clientAuth : "",
          secretSet: oidc.clientSecret !== "",
          redirectURL: oidc.redirectURL,
          scope: oidc.scope,
          groupsClaim: oidc.groupsClaim,
          name: oidc.name || "SSO",
        },
        siteAdmins: config.siteAdmins.length,
        sessionSecretSet: config.sessionSecret !== "",
      },
      email: {
        enabled: senders.emailEnabled,
        missing,
        host: smtp.host,
        port: smtp.port,
        security: smtp.ssl ? "ssl" : smtp.tls ? "starttls" : "none",
        from: smtp.from,
        user: smtp.user,
        passwordSet: smtp.password !== "",
      },
      mattermost: {
        enabled: senders.mattermost.enabled,
        url: mattermost.url,
        tokenSet: mattermost.token !== "",
      },
    });
  });
  return app;
}

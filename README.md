# Something's burning

A small error tracker. Official Sentry SDKs report to it.

## Development

```sh
pnpm install
pnpm dev        # backend on :8195, web app on :5190 (proxies /api and /auth to the backend)
pnpm test
pnpm typecheck
```

The backend keeps its data in SQLite at `backend/data/burning.db`. It reads settings from the environment and from `backend/.env`; see `backend/.env.example`.

### Sign-in in development

For passwords, make an accounts file and point `BURNING_PASSWORD_FILE` at it:

```sh
echo "you@example.com:$(echo -n 'a password' | pnpm --silent --filter backend hash-password)" > backend/passwords.local.txt
```

For single sign-on you need an OpenID Connect provider. Any will do; `dev/dex.yaml` runs [Dex](https://dexidp.io) in Docker as a throwaway local one with two users. The file says how to start it and what to put in `backend/.env`.

## Reporting errors

Create a project and use its DSN with any Sentry SDK:

```
http://<public key>@<host>/<project id>
```

SDKs post to the same paths Sentry uses:

- `POST /api/<project id>/envelope/`
- `POST /api/<project id>/store/`

The key is read from the `X-Sentry-Auth` header, the `sentry_key` query parameter, or the envelope's DSN. Bodies may be gzip, deflate, or brotli encoded. Only error events are stored; other envelope items are accepted and dropped.

DSNs and alert links use `BURNING_BASE_URL`, or the host the request came in on.

## Sign-in

There are two ways to sign in, each turned on in the backend. Both can be on. With neither, the API refuses everything but SDK events, and the sign-in page asks to configure one.

- **Passwords**: `BURNING_PASSWORD_FILE` names a file with one account per line, `email:scrypt-hash[:group,group]`. `pnpm --filter backend hash-password` makes a hash from standard input. The file is read at every sign-in, so changes apply without a restart. After five wrong passwords an email is locked out for 15 minutes.
- **OpenID Connect**: any standard provider. It is on when `BURNING_OIDC_ISSUER` is set, with the client ID and redirect URL (`<web app URL>/auth/callback`). See [Single sign-on](#single-sign-on).

### Single sign-on

Burning reads the provider's endpoints from its discovery document (`<issuer>/.well-known/openid-configuration`) and signs in with the authorization code flow and PKCE. Register a web application with the provider, with `<web app URL>/auth/callback` as its redirect URL, then set:

| Setting | |
|---|---|
| `BURNING_OIDC_ISSUER` | The issuer URL, as in the discovery document |
| `BURNING_OIDC_CLIENT_ID` | The client ID |
| `BURNING_OIDC_CLIENT_SECRET` | The client secret; leave empty for a public client |
| `BURNING_OIDC_CLIENT_AUTH` | `client_secret_basic` (the default with a secret), `client_secret_post`, or `none` (the default without) |
| `BURNING_OIDC_REDIRECT_URL` | `<web app URL>/auth/callback` |
| `BURNING_OIDC_SCOPE` | Default `openid email profile groups` |
| `BURNING_OIDC_GROUPS_CLAIM` | The claim with the person's groups, default `groups` |
| `BURNING_OIDC_NAME` | Shown on the button, "Sign in with …"; default `SSO` |

Issuers of some common providers:

| Provider | Issuer | Notes |
|---|---|---|
| Keycloak | `https://<host>/realms/<realm>` | Add a group membership mapper for groups |
| Okta | `https://<org>.okta.com/oauth2/default` | Add a groups claim to the authorization server |
| Auth0 | `https://<tenant>.auth0.com/` | Groups need a custom claim from an Action |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant id>/v2.0` | Groups arrive as object IDs when the app emits them |
| Google | `https://accounts.google.com` | No groups; set the scope to `openid email profile` |
| GitLab | `https://gitlab.com` | Groups are in the `groups` claim of userinfo |
| Authentik | `https://<host>/application/o/<app slug>/` | |
| Dex | `https://<host>/dex` | |

At every OIDC sign-in Burning saves the ID token's claims in the `users` table: email, `preferred_username` as the username (or the part of the email before `@`), `name`, issuer, subject, and the token's expiry. It does not keep the tokens. The groups come from the `groups` claim (`BURNING_OIDC_GROUPS_CLAIM`), or from userinfo when the ID token has none. A password sign-in saves the email, the username from it, and the groups from the file, with `password` as the issuer.

Sessions last 12 hours. The cookie holds only a session id and is signed with `BURNING_SESSION_SECRET`, or a random secret kept in the database.

## Project access

Each project grants roles to users (by email) and to groups (by name, from the groups claim). The highest matching role wins.

- viewer: sees issues and events
- member: also gets alerts by the default route
- admin: also changes access, notifications, and the project

Whoever creates a project is its admin, and a project always keeps at least one user as admin. People in `BURNING_SITE_ADMINS` (emails or groups) are admin on every project.

## Notifications

A new issue alerts. Each project has a routing table in the style of Alertmanager: routes are tried from the top, a route matches when all its conditions do, and matching stops at the first route that matches unless it says continue. A sink route drops what it matches. When no route matches, the default route sends to the project's members and admins.

Conditions test `trigger`, `env`, `release`, `level`, `type`, `message`, `culprit`, `path` (any in-app frame's file), or `tag.<name>`, with `=`, `!=`, `=~`, `!~` (regexes match the whole value), or whether the field has a value, is empty, or is absent.

A route sends to people, email addresses, Mattermost channels, or webhooks (a JSON post). A person gets alerts the way their own routing on their profile says: by email or Mattermost direct message, or not at all. It starts as everything by email.

Email needs `BURNING_SMTP_HOST` and `BURNING_SMTP_FROM`; Mattermost needs `BURNING_MATTERMOST_URL` and a bot token. Messages go through an outbox and are retried up to five times.

## API

The API needs a session, except `/api/session`, `/api/health`, and the ingest paths.

- `POST /auth/password` with `{ "email", "password" }`: signs in and sets the session cookie
- `POST /auth/oidc` (a form with `next`): starts single sign-on; the provider returns to `/auth/callback`
- `POST /auth/logout`

- `GET /api/health`
- `GET /api/session`: the ways to sign in, and who is signed in
- `GET /api/board?project=<id>&sort=hot|latest|count&q=<text>`
- `GET /api/projects`: the projects you can see
- `POST /api/projects` with `{ "name": "<name>" }`: creates a project, with you as admin
- `GET /api/projects/<id>`, `PATCH` with `{ "name": "<name>" }` (admin), `DELETE` (admin)
- `GET /api/projects/<id>/issues`
- `GET /api/projects/<id>/issues/<issue>?event=<id>`: the issue, its releases, its latest events, and one event in full
- `GET /api/projects/<id>/issues/<issue>/events?before=<id>`: the next 10 older events
- `GET /api/projects/<id>/settings`: the DSN, grants, and your role
- `PUT /api/projects/<id>/access` with `{ "kind": "user" | "group", "subject": "<email or group>", "role": "viewer" | "member" | "admin" }` (admin)
- `DELETE /api/projects/<id>/access` with `{ "kind", "subject" }` (admin)
- `GET /api/projects/<id>/routing`, `PUT` with `{ "routes": [...] }` (admin)
- `GET /api/people?project=<id>`: who a route can send to
- `GET /api/profile`, `PUT` with `{ "displayName": "<name>" }`
- `GET /api/profile/notifications`, `PUT` with `{ "routes": [...] }`, and `POST /api/profile/notifications/test` with one receiver

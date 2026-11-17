# Something's burning

A small error tracker. Official Sentry SDKs report to it.

## Development

```sh
pnpm install
pnpm dev        # backend on :8195, web app on :5190 (proxies /api and /auth to the backend)
pnpm test
pnpm typecheck
pnpm --filter backend seed   # demo projects and issues in the configured database
```

The backend reads settings from the environment and from `backend/.env`; see `backend/.env.example`.

The seed writes to the database directly, so run it with the server stopped or on a fresh database. It skips a project whose name is taken, so running it twice adds nothing. `BURNING_SEED_ADMINS=you@example.com` makes those people admin of the demo projects; otherwise only site admins see them.

Tests run on SQLite. To run them on Postgres too (including the several-servers tests), point `BURNING_TEST_PG` at a server the tests may create schemas on:

```sh
docker run -d --name burning-test-pg -e POSTGRES_USER=burning -e POSTGRES_PASSWORD=burning -p 127.0.0.1:55433:5432 postgres:16-alpine
BURNING_TEST_PG=postgres://burning:burning@127.0.0.1:55433/burning pnpm test
```

## Running it

`pnpm build && pnpm start` serves the API and the built web app on one port (`BURNING_PORT`, 8195), with `GET /healthz` for health checks. Or as a container:

```sh
docker build -t burning .
docker run -p 8195:8195 -v burning-data:/data --env-file backend/.env burning
```

The image keeps SQLite in `/data`, and has git for code sources on git servers.

Every push to `main` publishes the image to `ghcr.io/s-dove/somethings-burning`, tagged `main` and `sha-<commit>`. A `v1.2.3` tag also publishes `1.2.3` and `latest`.

## Storage

- **SQLite** (default): `BURNING_DB` is the file, `data/burning.db` by default. One server only.
- **Postgres**: set `BURNING_DATABASE_URL=postgres://user:password@host:5432/db`. It wins over `BURNING_DB`. Several servers can share it.

The schema is created and brought up to date at startup; an existing database is upgraded in place.

With Postgres, every server can run at once:

- A new error seen by two servers at the same moment becomes one issue: the unique fingerprint decides, and the issue's row is locked while an event changes it.
- Notifications are claimed with `FOR UPDATE SKIP LOCKED` and a two-minute lease, so each goes out from one server; one whose server stopped mid-send is taken over when the lease ends.
- Timed mutes end once: the update claims the rows it changes.
- Live alerts go out through `LISTEN`/`NOTIFY`, so browsers on every server hear them.

Still per server: the ingest rate limit, the queue of events not yet written, and the git mirrors for code sources.

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

The key is read from the `X-Sentry-Auth` header, the `sentry_key` query parameter, or the envelope's DSN. Only error events are stored; other envelope items are accepted and dropped.

### Limits and storage

- **Rate limit**: the whole server takes `BURNING_RATE` events a second (50), with bursts up to `BURNING_BURST` (500). Over it, SDKs get a 429 with `Retry-After` and `X-Sentry-Rate-Limits` and pause.
- **Queue**: a request is answered with the event id at once, and events are written in order right after. Past 2000 waiting events, SDKs get a 429 too.
- **Bodies**: up to 10 MB, plain or gzip, deflate (zlib or raw), brotli, or zstd encoded.
- **Payload sampling**: an issue keeps every payload for its first 50 events, then at most one a minute, and at most 500; past that the oldest go. A payload that starts an alert is always kept. Event counts, the hourly heat, and the per-release numbers count every event either way.
- **Retention**: payloads older than `BURNING_RETENTION_DAYS` (30) are deleted once an hour, with hourly counts as old. Issues and their totals stay.

### Grouping

Events with the same fingerprint are one issue:

- An exception groups by its type and the five frames of your code closest to where it was raised (module, or the file and its folder, and the function), for every exception in the chain. Library frames are skipped unless the SDK marked none as yours. Line numbers and the message do not matter, so one bug stays one issue as the code moves.
- An exception with no frames groups by its message, and an event with no exception by its message template (`logentry.message`) or message. Numbers, UUIDs, hex values, long ids, and quoted strings are masked first, so `user 12 not found` and `user 13 not found` are one issue.
- A `fingerprint` from the SDK wins. `{{ default }}` inside it stands for the default parts, so `["{{ default }}", "eu"]` splits the usual group by region.

An issue's culprit is the event's transaction (a route or task name, like `POST /invoices/{id}/charge`) when the SDK sends one, else the innermost frame of your code.

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
- member: also resolves, mutes, and reopens issues, and gets alerts by the default route
- admin: also changes access, notifications, and the project

Project names are unique, ignoring case. Whoever creates a project is its admin, and a project always keeps at least one user as admin. People in `BURNING_SITE_ADMINS` (emails or groups) are admin on every project.

## Triage

An issue is open, resolved, or muted.

- **Resolve** says everything so far is handled. The next event fires the issue again: it goes back to open and alerts.
- **Mute** keeps counting events without alerting: for 1 hour, 1 day, or 1 week; until the next release (an event from a release first seen after the mute ends it); or until unmuted. When a timed mute ends, the issue goes back to open and its next event alerts.
- **Reopen** (or **Unmute**) puts it back to open by hand.

Members and admins triage, one issue at a time or several from the list. Every change is in the issue's history, with who made it.

## Releases

Each project has a Releases page: every release the SDKs reported or CI created, newest first, with its first-seen time, commit, deploys, events, issues, issues first seen in it, and issues that fired again in it. Opening a release shows its issues (the board filtered with `release=`).

CI creates releases and marks deploys with a project API token (see API tokens):

```sh
curl -X POST <web app URL>/api/projects/<id>/releases -H "Authorization: Bearer $BURNING_TOKEN" \
  -H "Content-Type: application/json" -d '{"version": "'"$RELEASE"'", "commit": "'"$(git rev-parse HEAD)"'"}'
curl -X POST <web app URL>/api/projects/<id>/deploys -H "Authorization: Bearer $BURNING_TOKEN" \
  -H "Content-Type: application/json" -d '{"release": "'"$RELEASE"'", "environment": "production"}'
```

`RELEASE` is the app's release, exactly as its SDK reports it (the SDK's `release` option; Sentry SDKs also read the `SENTRY_RELEASE` environment variable). Releases, deploys, and source maps are matched to events by it.

A release's commit, when CI gives one, is what suspect changes compare.

## Tags and users

The issue page shows how an issue's events spread over each tag (environment, release, browser, OS, server, level when the SDK sent one, and the SDK's own tags), and how many distinct users it reached, counted from the event's `user` (id, email, username, or IP address, kept only as a hash). The counts include every event, kept or sampled away.

## Assignment and ownership

Members assign an issue to a person from its page; the board filters by assignee (everyone's, assigned to me, unassigned). A project's ownership rules (Settings, Ownership) assign new issues: the first rule whose pattern matches the issue's path (any in-app frame's file), type, message, culprit, or a tag gives its owner. A route can send to **the assignee**, delivered through their own routing.

## Grouping rules and merging

A project's grouping rules (Settings, Grouping) give matching events a fingerprint of their own: `db-timeout {{ tag.region }}` groups every matching event by region. `{{ type }}`, `{{ message }}`, `{{ culprit }}`, `{{ tag.<name> }}`, and `{{ default }}` take the event's values.

Members merge issues from the board: check two or more of one project and choose Merge. The one with the most events is kept; the others' events, counts, comments, and history move to it, and their later events join it. The kept issue lists what was merged into it, and each can be split back out: its stored events move to a new issue, with their counts (counts of events whose payloads were sampled away stay).

## Data scrubbing

Before an event is stored, values that look secret are replaced with `[Filtered]`: fields named like password, secret, token, API key, authorization, cookie, session, card number, CVV, or SSN anywhere in the event (request headers, cookies, body, query string, extra, contexts, breadcrumb data, local variables), and in any text card numbers that pass the Luhn check, `Bearer` tokens, and JWTs. A project can turn these defaults off and add field names of its own (Settings, Data scrubbing).

## Source maps

JavaScript source maps are uploaded per release, named by the URL path of their script with `~` for any host (`~/static/js/app.min.js.map`), from Settings, Source maps, or from CI:

```sh
curl -X POST <web app URL>/api/projects/<id>/sourcemaps -H "Authorization: Bearer $BURNING_TOKEN" \
  -F release="$RELEASE" -F prefix="~/static/js/" -F file=@dist/app.min.js.map
```

The issue page then shows minified frames as their original file, line, function, and code. Mapping happens when the page is shown, so a map uploaded after the events still applies.

## API tokens

A project admin creates API tokens (Settings, API tokens). A token is shown once, kept only as a hash, and reaches only its project's releases, deploys, and source maps, as `Authorization: Bearer brn_...`.

## Languages

The web app is in English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, and Brazilian Portuguese. Each person picks theirs at their first sign-in; it is kept with them, so it follows them to any browser, and they change it on their profile. Before signing in, the page follows the browser's language, and the sign-in page has a switch. Alert messages stay English. Known history lines are translated on the issue page; anything unrecognized stays as the server wrote it.

To add a language, add a dictionary under `frontend/src/shared/locales/` (the keys are the English texts) and list it in `frontend/src/shared/i18n.tsx` and in `LANGS` in `backend/src/users.ts`.

## Live alerts

When an issue alerts (new, firing again, or firing after a mute), its project's square in the sidebar gets a pulsing red ring in every open browser that can see the project, without a reload. Opening the project clears it. The browser listens on `GET /api/alerts`, a server-sent events stream that carries only `{ "projectId": <id> }`, with a ping every 25 seconds to keep proxies from closing it.

## Comments

Anyone with a role on a project can comment on its issues, viewers too, since a comment does not change the issue. Comments are GitHub-flavoured Markdown (tables, task lists, fenced code with highlighting); raw HTML is not rendered. `@username` is highlighted, and clicking a commenter's name starts a reply that mentions them; mentions do not notify anyone yet.

Only the author can edit a comment, and earlier texts are kept (not shown). The author or a project admin can delete it.

## Notifications

A new issue, an issue firing again, an issue firing after a mute, and a spike are alerts. Each project has a routing table in the style of Alertmanager: routes are tried from the top, a route matches when all its conditions do (one with none matches every alert of its kinds), and matching stops at the first route that matches unless it says continue. A sink route drops what it matches. When no route matches, the default route sends to the project's members and admins.

Conditions test `env`, `release`, `level`, `type`, `message`, `culprit`, `path` (any in-app frame's file), or `tag.<name>`, with `=`, `!=`, `=~`, `!~` (regexes match the whole value), or whether the field has a value, is empty, or is absent.

Each route picks the kinds of alert it takes at the top of its editor: new issue, fired again, after a mute, and spike (stored as a `trigger` condition). **Spikes** are routed like any alert, but a route that takes them says what counts as one: "at least 50 events in an hour, and 5 times the usual rate" (the issue's hourly average over the 24 hours before). So spikes can go somewhere more urgent than the rest. The default route takes no spikes. Each route's spike numbers alert an open issue at most every six hours; a route with higher numbers still alerts when the issue reaches them.

A route sends to people, the assignee, email addresses, Mattermost channels, Slack (an incoming webhook URL), or webhooks (a JSON post). A person gets alerts the way their own routing on their profile says: by email or Mattermost direct message, or not at all; spikes come with the trigger `spike`. It starts as everything by email.

Anyone can turn on a **daily summary** on their profile: one email a day from `BURNING_DIGEST_HOUR` (UTC, 8 by default) about their projects: issues first seen and firing again in the last day, and the busiest. Nothing is sent on a quiet day.

Email needs `BURNING_SMTP_HOST` and `BURNING_SMTP_FROM`; Mattermost needs `BURNING_MATTERMOST_URL` and a bot token. Messages go through an outbox and are retried up to five times. The issue's history records who was notified and by which route.

## Code sources

A project lists the repositories its stack frames come from, on its Code settings page. Sources can be of different kinds in one project:

- **GitHub**: github.com or a GitHub Enterprise host, written `host/owner/repo`. Read through the REST API; nothing is cloned.
- **Git**: any git server, by clone URL (https or ssh). Burning keeps a bare, blobless mirror under `BURNING_GIT_DIR` (default: a `git` folder next to the database) and fetches when it meets an unknown ref, at most every five minutes. Links need a template with `{ref}`, `{path}`, and `{line}`.

Each source has path mappings: where a frame's path starts, and which folder that is in the repository. A frame goes to the source whose mapping has the longest matching prefix, so a vendored library inside the app's folder still finds its own repository. Frames no mapping covers, and library frames, are left alone.

Each source also says how an event's release becomes a commit:

- **Auto** (default): a commit after `+` (`payments-api@2.15.0+3e7cbf4`), a release that is a commit, `git describe` output (`v2.1.0-12-g3e7cbf4`), then a tag named like the version, then `v` plus the version.
- **Commit in release**, **Tag = release**, **Tag = v + version**, **Tag template** (`payments-api/v{version}`, for monorepos), **Event tag** (the commit in a tag the SDK sends), **Regex** (one capture group), or **Default branch**.

Anything that does not resolve falls back to the default branch. The recommended release is `<service>@<version>+<full commit>`; Sentry SDKs read it from the `SENTRY_RELEASE` environment variable, so a build only has to set that.

Stack frames on the issue page link to their line at the resolved commit, and a frame the SDK sent without its code lines gets them from the repository. The settings page can test a draft against the latest stored event.

**Suspect changes**: when an event's release follows an earlier one, the issue page lists the stack's files that changed in the primary source between the two releases' commits (CI's commit for a release when it gave one, else the release rule), the commits that changed them, and a compare link; those frames are marked "modified in this release".

**GitHub issues**: when the primary source is on GitHub and its host has a token, members can open a GitHub issue from an issue page. It links back, and the issue links to it.

Credentials come from the environment, matched by host:

- `BURNING_GIT_CREDENTIALS`: git-credentials lines, `https://user:token@host`, one per host (newlines or commas). Used for the GitHub API and for https clones.
- `BURNING_GIT_SSH_KEY`: path to a private key for ssh clone URLs.

## Global settings

`/settings` (the Settings tab on All issues, or Global settings on a project's settings) shows how this server is set up: sign-in, email, Mattermost, and code access. The values come from the environment and are read-only there. Passwords, secrets, and tokens are never shown, only whether they are set.

## API

The API needs a session, except `/api/session`, `/api/health`, and the ingest paths.

- `POST /auth/password` with `{ "email", "password" }`: signs in and sets the session cookie
- `POST /auth/oidc` (a form with `next`): starts single sign-on; the provider returns to `/auth/callback`
- `POST /auth/logout`

- `GET /api/health`
- `GET /api/session`: the ways to sign in, and who is signed in
- `POST /api/projects/<id>/issues/<issue>/assign` with `{ "assignee": "<email>" | "" }` (member)
- `POST /api/projects/<id>/issues/merge` with `{ "into": <issue>, "issues": [<issue>, ...] }` (member), and `POST /api/projects/<id>/issues/<issue>/unmerge` with `{ "fingerprint" }` (member)
- `POST /api/projects/<id>/issues/<issue>/github` (member): opens a GitHub issue
- `GET /api/projects/<id>/config`, and `PUT /api/projects/<id>/config/<owners|grouping|scrub>` (admin)
- `GET /api/projects/<id>/releases`; `POST /api/projects/<id>/releases` with `{ "version", "commit"? }` and `POST /api/projects/<id>/deploys` with `{ "release", "environment"?, "url"? }` (admin or API token)
- `GET /api/projects/<id>/sourcemaps?release=`, `POST` (multipart, or JSON `{ "release", "name", "content" }`; admin or API token), `DELETE` with `{ "release", "name"? }` (admin)
- `GET /api/projects/<id>/tokens`, `POST` with `{ "name" }`, `DELETE /api/projects/<id>/tokens/<id>` (admin)
- `GET /api/profile/digest`, `PUT` with `{ "enabled" }`, `POST /api/profile/digest/test`
- `GET /api/alerts`: server-sent events, `{ "projectId": <id> }` when one of its issues alerts (projects you can see)
- `GET /api/board?project=<id>&status=open|resolved|muted|all&sort=hot|latest|count&q=<text>&assignee=me|none|<email>&release=<version>`
- `GET /api/projects`: the projects you can see
- `POST /api/projects` with `{ "name": "<name>" }`: creates a project, with you as admin (409 when the name is taken)
- `GET /api/projects/<id>`, `PATCH` with `{ "name": "<name>" }` (admin), `DELETE` (admin)
- `GET /api/projects/<id>/issues`
- `GET /api/issues/<issue>`: the issue's project, for links by number (`/issues/<issue>` in the web app); a merged issue gives the one it went into
- `GET /api/projects/<id>/issues/<issue>?event=<id>`: the issue, its releases, history, comments, tags, users affected, merged fingerprints, suspect changes, latest events, and one event in full
- `POST /api/projects/<id>/issues/<issue>/comments` with `{ "body": "<markdown>" }` (anyone with a role)
- `PATCH /api/projects/<id>/issues/<issue>/comments/<comment>` with `{ "body": "<markdown>" }` (the author)
- `DELETE /api/projects/<id>/issues/<issue>/comments/<comment>` (the author or an admin)
- `POST /api/projects/<id>/issues/<issue>/resolve` (member)
- `POST /api/projects/<id>/issues/<issue>/reopen` (member): reopens or unmutes
- `POST /api/projects/<id>/issues/<issue>/mute` with `{ "for": "1h" | "1d" | "1w" | "release" | "forever" }` (member)
- `GET /api/projects/<id>/issues/<issue>/events?before=<id>`: the next 10 older events
- `GET /api/projects/<id>/settings`: the DSN, grants, and your role
- `PUT /api/projects/<id>/access` with `{ "kind": "user" | "group", "subject": "<email or group>", "role": "viewer" | "member" | "admin" }` (admin)
- `DELETE /api/projects/<id>/access` with `{ "kind", "subject" }` (admin)
- `GET /api/projects/<id>/routing`, `PUT` with `{ "routes": [...] }` (admin); a route is `{ name, matchers, receivers, sink, continue, spike? }`, with `spike` as `{ "events", "factor" }`
- `GET /api/projects/<id>/sources`, `PUT` with `{ "sources": [...] }` (admin), and `POST /api/projects/<id>/sources/test` with a draft list (admin): the project's code sources
- `GET /api/people?project=<id>`: who a route can send to
- `GET /api/site/settings`: the server's sign-in, email, Mattermost, and code access settings, without secrets
- `GET /api/profile`, `PUT` with `{ "displayName": "<name>" }`; `PUT /api/profile/lang` with `{ "lang": "en" | "zh" | "zh-TW" | "ja" | "ko" | "es" | "fr" | "de" | "pt-BR" }`
- `GET /api/profile/notifications`, `PUT` with `{ "routes": [...] }`, and `POST /api/profile/notifications/test` with one receiver

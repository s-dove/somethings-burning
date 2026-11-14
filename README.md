# Something's burning

A small error tracker. Official Sentry SDKs report to it.

## Development

```sh
pnpm install
pnpm dev        # backend on :8195, web app on :5190 (proxies /api to the backend)
pnpm test
pnpm typecheck
```

The backend keeps its data in SQLite at `backend/data/burning.db` (`DATABASE_PATH` changes it).

## Reporting errors

Create a project and use its DSN with any Sentry SDK:

```
http://<public key>@<host>/<project id>
```

SDKs post to the same paths Sentry uses:

- `POST /api/<project id>/envelope/`
- `POST /api/<project id>/store/`

The key is read from the `X-Sentry-Auth` header, the `sentry_key` query parameter, or the envelope's DSN. Bodies may be gzip, deflate, or brotli encoded. Only error events are stored; other envelope items are accepted and dropped.

DSNs are built from the host the web app is opened at. Set `PUBLIC_URL` on the backend to override it.

## API

There is no sign-in yet.

- `GET /api/health`
- `GET /api/projects`: projects with issue and event counts
- `POST /api/projects` with `{ "name": "<name>" }`: creates a project and returns it with its DSN
- `GET /api/projects/<id>`
- `PATCH /api/projects/<id>` with `{ "name": "<name>" }`
- `DELETE /api/projects/<id>`: removes the project with its issues and events
- `GET /api/projects/<id>/issues`
- `GET /api/projects/<id>/issues/<issue>`: the issue and its 10 latest events

```sh
curl -X POST http://localhost:8195/api/projects -H 'Content-Type: application/json' -d '{"name": "web"}'
```

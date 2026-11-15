# One image with the backend and the built web app on one port.
#
#   docker build -t burning .
#   docker run -p 8195:8195 -v burning-data:/data --env-file backend/.env burning
#
# SQLite in /data by default; set BURNING_DATABASE_URL=postgres://... to share
# a Postgres between several containers.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile
COPY backend backend
COPY frontend frontend
RUN pnpm build

FROM node:22-slim
# git for code sources read from git servers, ssh for ssh clone URLs.
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --prod --filter backend
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
WORKDIR /app/backend
ENV NODE_ENV=production \
    BURNING_DB=/data/burning.db \
    BURNING_STATIC_DIR=/app/frontend/dist \
    BURNING_PORT=8195
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8195
USER node
HEALTHCHECK CMD node -e "fetch('http://localhost:8195/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/src/server.js"]

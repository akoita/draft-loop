# The hosted worker image, built from the repository root: `docker build -f apps/worker/Dockerfile .`.
# It runs the workspace's TypeScript sources with tsx, so the image needs no separate build step.
# Cloud project identifiers, credentials and bucket names come from the runtime, never from here.
FROM node:24.5.0-bookworm-slim

ENV CI=true \
    NODE_ENV=production \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

WORKDIR /app
COPY . .
# Only the worker's production dependency graph, exactly as the lockfile pins it.
RUN pnpm install --frozen-lockfile --prod --filter "@draft-loop/worker..." \
    && pnpm store prune

USER node
WORKDIR /app/apps/worker
# The same image runs the migration job: `/app/node_modules/.bin/tsx src/migrate.ts`.
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]

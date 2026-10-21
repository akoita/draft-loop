# The hosted api image, built from the repository root: `docker build -f apps/api/Dockerfile .`.
# It runs the workspace's TypeScript sources with tsx, so the image needs no separate build step.
# Cloud project identifiers, credentials and bucket names come from the runtime, never from here.
FROM node:24.5.0-bookworm-slim

ENV CI=true \
    NODE_ENV=production \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

WORKDIR /app
COPY . .
# Only the api's production dependency graph, exactly as the lockfile pins it.
RUN pnpm install --frozen-lockfile --prod --filter "@draft-loop/api..." \
    && pnpm store prune

USER node
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]

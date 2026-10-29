# The hosted page fetcher image, built from the repository root:
# `docker build -f apps/page-fetcher/Dockerfile .`. It runs the workspace's TypeScript sources with
# tsx, so the image needs no separate build step. It holds no database, no secret and no candidate
# material: the API asks it for each hop of an approved job page's fetch (#1837).

# Install stage: pnpm and its store stay here, out of the image.
FROM node:24.22.1-bookworm-slim AS dependencies

ENV CI=true \
    NODE_ENV=production \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

WORKDIR /app
COPY . .
# The build context keeps each file's mode from the clone, and a clone made under a strict umask
# (077) would leave folders the image's `node` user cannot open. Every file is made readable.
RUN chmod -R a+rX,go-w /app
# Only the fetcher's production dependency graph, exactly as the lockfile pins it.
RUN pnpm install --frozen-lockfile --prod --filter "@draft-loop/page-fetcher..."

FROM node:24.22.1-bookworm-slim

ENV NODE_ENV=production
COPY --from=dependencies /app /app

USER node
WORKDIR /app/apps/page-fetcher
EXPOSE 8080
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]

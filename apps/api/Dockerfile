# The hosted api image, built from the repository root: `docker build -f apps/api/Dockerfile .`.
# It runs the workspace's TypeScript sources with tsx, so the image needs no separate build step.
# Cloud project identifiers, credentials and bucket names come from the runtime, never from here.

# Install stage: pnpm and its store stay here, out of the image.
FROM node:24.22.1-bookworm-slim AS dependencies

ENV CI=true \
    NODE_ENV=production \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

WORKDIR /app
COPY . .
# Only the api's production dependency graph, exactly as the lockfile pins it. The api never
# embeds text (runs and their retrieval belong to the worker), and the embedding runtime loads only
# on demand, so its native binaries, most of the graph's size, are left out.
RUN pnpm install --frozen-lockfile --prod --filter "@draft-loop/api..." \
    && rm -rf node_modules/onnxruntime-node

FROM node:24.22.1-bookworm-slim

ENV NODE_ENV=production
COPY --from=dependencies /app /app

USER node
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]

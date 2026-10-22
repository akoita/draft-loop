# The hosted worker image, built from the repository root: `docker build -f apps/worker/Dockerfile .`.
# It runs the workspace's TypeScript sources with tsx, so the image needs no separate build step.
# Cloud project identifiers, credentials and bucket names come from the runtime, never from here.

# Install stage: pnpm and its store stay here, out of the image.
FROM node:24.22.1-bookworm-slim AS dependencies

# Set by BuildKit: amd64 on Cloud Run, arm64 on an Apple-silicon machine running the local stack.
ARG TARGETARCH
ENV CI=true \
    NODE_ENV=production \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

WORKDIR /app
COPY . .
# Only the worker's production dependency graph, exactly as the lockfile pins it. The embedding
# runtime ships native binaries for every platform; only this image's Linux build is kept.
RUN pnpm install --frozen-lockfile --prod --filter "@draft-loop/worker..." \
    && arch="$(if [ "$TARGETARCH" = arm64 ]; then echo arm64; else echo x64; fi)" \
    && runtime=node_modules/onnxruntime-node/bin/napi-v6 \
    && test -d "$runtime/linux/$arch" \
    && find "$runtime" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
    && find "$runtime/linux" -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} +

FROM node:24.22.1-bookworm-slim

ENV NODE_ENV=production
COPY --from=dependencies /app /app

USER node
WORKDIR /app/apps/worker
# The same image runs the migration job: `/app/node_modules/.bin/tsx src/migrate.ts`.
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]

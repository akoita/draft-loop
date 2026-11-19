# The hosted api image, built from the repository root: `docker build -f apps/api/Dockerfile .`.
# It runs the server bundled into one JavaScript module (`dist/server.mjs`): compiling the
# TypeScript sources with tsx at start took seconds of each cold start. It serves the web screen
# (`apps/web`), which a separate stage builds so its build tools stay out of the image.
# Cloud project identifiers, credentials and bucket names come from the runtime, never from here.

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
# Only the api's production dependency graph, exactly as the lockfile pins it. The api never
# embeds text (runs and their retrieval belong to the worker), and the embedding runtime loads only
# on demand, so its native binaries, most of the graph's size, are left out.
RUN pnpm install --frozen-lockfile --prod --filter "@draft-loop/api..." \
    && rm -rf node_modules/onnxruntime-node
# The pinned speech model the web screen runs in the browser (#2199), fetched once at build and
# checked file by file against its SHA-256; the api serves it from its own origin.
RUN /app/node_modules/.bin/tsx packages/application/src/speech-model-install-command.ts /app/speech-models
# The server and its workspace packages, bundled once here instead of compiled at every start.
RUN cd apps/api && node scripts/bundle-server.mjs

# Web stage: the screen's static files, built with its development dependencies.
FROM node:24.22.1-bookworm-slim AS web

ENV CI=true \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@draft-loop/web..." \
    && pnpm --filter @draft-loop/web build

FROM node:24.22.1-bookworm-slim

# The release tag the deploy builds, such as server-v0.26.46, and its build day (YYYY-MM-DD): the
# Help menu shows both and feedback notes record the tag. Empty on a local build: no version shows.
ARG DRAFT_LOOP_SERVER_RELEASE=""
ARG DRAFT_LOOP_SERVER_RELEASED_ON=""
ENV DRAFT_LOOP_SERVER_RELEASE=$DRAFT_LOOP_SERVER_RELEASE \
    DRAFT_LOOP_SERVER_RELEASED_ON=$DRAFT_LOOP_SERVER_RELEASED_ON \
    NODE_ENV=production \
    DRAFT_LOOP_WEB_ROOT=/app/apps/web/dist \
    DRAFT_LOOP_SPEECH_MODEL_DIR=/app/speech-models
COPY --from=dependencies /app /app
COPY --from=web /app/apps/web/dist /app/apps/web/dist

# Take the base image's security updates, and drop npm: nothing runs it at run time, and its
# bundled packages are where most of the base image's scan findings live.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER node
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/server.mjs"]

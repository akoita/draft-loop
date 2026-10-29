import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { URL } from "node:url";

const read = (path) => readFile(new URL(`../deploy/local/${path}`, import.meta.url), "utf8");

/** The text of one top-level service block of compose.yaml, up to the next service. */
function serviceBlock(compose, name) {
  const match = compose.match(
    new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nvolumes:)`),
  );
  assert.ok(match, `compose.yaml defines ${name}`);
  return match[1];
}

describe("self-hosted stack", () => {
  it("publishes the API on the loopback address only, and nothing else", async () => {
    const compose = await read("compose.yaml");
    const published = [...compose.matchAll(/^ {6}- "([^"]+:\d+)"$/gmu)].map((match) => match[1]);
    // Compose's own variable syntax, not a template placeholder.
    const port = ["$", "{DRAFT_LOOP_PORT:-8080}"].join("");
    assert.deepEqual(published, [`127.0.0.1:${port}:8080`]);
    assert.ok(serviceBlock(compose, "api").includes("ports:"));
  });

  it("holds no fixed password or token", async () => {
    const compose = await read("compose.yaml");
    assert.doesNotMatch(compose, /POSTGRES_PASSWORD:/u);
    assert.doesNotMatch(compose, /OWNER_TOKEN:/u);
    assert.doesNotMatch(compose, /DATABASE_URL:/u);
    assert.doesNotMatch(compose, /PASSWORD '/u);
    assert.match(compose, /POSTGRES_PASSWORD_FILE:/u);
  });

  it("keeps the database superuser password away from the API and the worker", async () => {
    const compose = await read("compose.yaml");
    for (const service of ["api", "worker", "page-fetcher"]) {
      assert.doesNotMatch(serviceBlock(compose, service), /postgres-secrets/u, service);
    }
    const start = await read("init/with-secrets.sh");
    const roles = Object.fromEntries(
      [...start.matchAll(/^ {2}(\w+)\)\n([\s\S]*?);;/gmu)].map((match) => [match[1], match[2]]),
    );
    assert.deepEqual(Object.keys(roles), ["api", "worker", "migrate"]);
    assert.doesNotMatch(roles.api, /postgres_password|MIGRATION/u);
    assert.doesNotMatch(roles.worker, /postgres_password|MIGRATION|OWNER_TOKEN/u);
    assert.doesNotMatch(roles.migrate, /app_password|OWNER_TOKEN/u);
  });

  it("runs the worker on the direct routes with keys from files and blobs on disk", async () => {
    const compose = await read("compose.yaml");
    const worker = serviceBlock(compose, "worker");
    assert.match(compose, /DRAFT_LOOP_MODEL_ROUTES: direct/u);
    assert.match(compose, /DRAFT_LOOP_BLOB_BACKEND: filesystem/u);
    assert.match(worker, /provider-keys:\/run\/draft-loop\/provider-keys:ro/u);
    assert.match(worker, /blobs:\/var\/lib\/draft-loop\/blobs/u);
    assert.doesNotMatch(
      compose,
      /DRAFT_LOOP_VERTEX_|DRAFT_LOOP_BLOB_BUCKET|DRAFT_LOOP_GCS_ENDPOINT/u,
    );
  });

  it("never commits a provider key", async () => {
    assert.deepEqual(
      (await read("keys/.gitignore"))
        .split("\n")
        .filter((line) => !line.startsWith("#") && line !== ""),
      ["*", "!.gitignore"],
    );
  });
});

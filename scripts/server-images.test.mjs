import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { URL } from "node:url";

const workflow = await readFile(
  new URL("../.github/workflows/server-images.yml", import.meta.url),
  "utf8",
);

describe("server images workflow", () => {
  it("runs on server tags, and by hand for an existing tag", () => {
    assert.match(workflow, /\n {2}push:\n {4}tags: \["server-v\*"\]\n/u);
    assert.match(workflow, /\n {2}workflow_dispatch:\n/u);
    assert.doesNotMatch(workflow, /\n {2}pull_request/u);
    // A dispatched name is checked as a server tag before anything is built.
    assert.match(workflow, /\^server-v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/u);
  });

  it("writes packages only, with the workflow's own token", () => {
    assert.match(workflow, /\npermissions:\n {2}contents: read\n/u);
    assert.match(workflow, /permissions:\n {6}contents: read\n {6}packages: write\n/u);
    const secrets = [...workflow.matchAll(/secrets\.([A-Z_]+)/gu)].map((match) => match[1]);
    assert.deepEqual([...new Set(secrets)], ["GITHUB_TOKEN"]);
  });

  it("publishes the three self-hosted images by version, never as latest", () => {
    assert.match(workflow, /app: \[api, worker, page-fetcher\]/u);
    assert.match(workflow, /file: apps\/\$\{\{ matrix\.app \}\}\/Dockerfile/u);
    assert.match(
      workflow,
      /tags: ghcr\.io\/akoita\/draft-loop-\$\{\{ matrix\.app \}\}:\$\{\{ env\.VERSION \}\}\n/u,
    );
    assert.doesNotMatch(workflow, /:latest/u);
    assert.match(
      workflow,
      /org\.opencontainers\.image\.source=https:\/\/github\.com\/akoita\/draft-loop\n/u,
    );
    assert.match(workflow, /org\.opencontainers\.image\.revision=\$\{\{ env\.REVISION \}\}/u);
  });

  it("builds the tagged commit for both Linux architectures", () => {
    assert.match(workflow, /ref: refs\/tags\/\$\{\{ env\.TAG \}\}/u);
    assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/u);
  });
});

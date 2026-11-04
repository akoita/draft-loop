import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath, URL } from "node:url";

import { classifyChanges, formatOutputs, readWorkspace } from "./ci-scope.mjs";

const workspace = new Map([
  ["packages/domain", []],
  ["packages/ui", ["packages/domain"]],
  ["packages/review-state", ["packages/ui"]],
  ["packages/storage-postgres", ["packages/domain"]],
  ["apps/web", ["packages/ui"]],
  ["apps/api", ["apps/web", "packages/review-state", "packages/storage-postgres"]],
  ["apps/worker", ["apps/api"]],
  ["apps/cli", ["packages/domain"]],
]);

describe("CI change scope", () => {
  it("runs no tests for a docs-only change", () => {
    const result = classifyChanges(
      ["docs/architecture/overview.md", "docs/images/flow.png", "README.md", "AGENTS.md"],
      workspace,
    );
    assert.equal(result.docsOnly, true);
    assert.equal(result.tests, false);
    assert.equal(result.runAll, false);
    assert.equal(result.serverStorage, false);
    assert.equal(result.selfHosted, false);
  });

  it("tests a leaf app alone", () => {
    const result = classifyChanges(["apps/cli/src/main.ts", "docs/reference/cli.md"], workspace);
    assert.deepEqual(result.packages, ["apps/cli"]);
    assert.equal(result.docsOnly, false);
    assert.equal(result.runAll, false);
    assert.equal(result.serverStorage, false);
    assert.equal(result.selfHosted, false);
  });

  it("tests every package that depends on a changed one", () => {
    const result = classifyChanges(["packages/ui/src/review.tsx"], workspace);
    assert.deepEqual(result.packages, [
      "apps/api",
      "apps/web",
      "apps/worker",
      "packages/review-state",
      "packages/ui",
    ]);
    assert.equal(result.serverStorage, true);
    assert.equal(result.selfHosted, true);
  });

  it("treats Markdown inside a package as that package's change", () => {
    const result = classifyChanges(["packages/domain/fixtures/case-a/resume.md"], workspace);
    assert.equal(result.docsOnly, false);
    assert.ok(result.packages.includes("packages/domain"));
  });

  it("runs the self-hosted stack for deploy inputs without package tests", () => {
    const result = classifyChanges(["deploy/local/compose.yaml"], workspace);
    assert.equal(result.selfHosted, true);
    assert.equal(result.tests, true);
    assert.deepEqual(result.packages, []);
    assert.equal(result.runAll, false);
  });

  it("leaves scripts and other workflows to the release tooling tests", () => {
    const result = classifyChanges(
      ["scripts/release.mjs", ".github/workflows/release.yml", "server-release.json"],
      workspace,
    );
    assert.equal(result.tests, true);
    assert.deepEqual(result.packages, []);
    assert.equal(result.runAll, false);
  });

  it("runs everything for toolchain, CI and unknown paths", () => {
    for (const path of [
      "pnpm-lock.yaml",
      "package.json",
      "tsconfig.json",
      "vitest.config.mts",
      ".github/workflows/ci.yml",
      "scripts/ci-scope.mjs",
      "packages/brand-new/src/index.ts",
      "something-new.yaml",
    ]) {
      const result = classifyChanges(["docs/roadmap.md", path], workspace);
      assert.equal(result.runAll, true, path);
      assert.equal(result.serverStorage, true, path);
      assert.equal(result.selfHosted, true, path);
    }
  });

  it("runs everything when the change list is empty", () => {
    assert.equal(classifyChanges([], workspace).runAll, true);
  });

  it("writes GitHub step outputs", () => {
    const outputs = formatOutputs(classifyChanges(["apps/cli/src/main.ts"], workspace));
    assert.match(outputs, /^docs_only=false$/mu);
    assert.match(outputs, /^packages=apps\/cli$/mu);
    assert.match(outputs, /^server_storage=false$/mu);
  });

  it("reads the repository's workspace graph", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const graph = readWorkspace(root);
    assert.ok(graph.get("apps/web").includes("packages/ui"));
    assert.deepEqual(classifyChanges(["apps/mcp/src/index.ts"], graph).packages, ["apps/mcp"]);
  });
});

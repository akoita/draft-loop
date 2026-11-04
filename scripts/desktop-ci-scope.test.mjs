import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { desktopAffected } from "./desktop-ci-scope.mjs";

describe("desktop CI scope", () => {
  it("skips changes that cannot reach the packaged desktop client", () => {
    assert.equal(
      desktopAffected([
        "docs/roadmap.md",
        "README.md",
        "AGENTS.md",
        "compose.yaml",
        ".claude/skills/steward/SKILL.md",
        "packages/storage/src/knowledge-store.ts",
        "apps/web/src/main.tsx",
        "apps/api/src/server.ts",
        "apps/desktop-client/src/navigation.test.ts",
        "scripts/release.mjs",
      ]),
      false,
    );
  });

  it("runs when the client, its acceptance, its workflow or the dependencies change", () => {
    for (const path of [
      "apps/desktop-client/src/main.ts",
      "apps/desktop-client/forge.config.ts",
      "scripts/desktop-client-acceptance.mjs",
      "scripts/desktop-ci-scope.mjs",
      ".github/workflows/desktop-acceptance.yml",
      "pnpm-lock.yaml",
      "package.json",
      ".nvmrc",
    ]) {
      assert.equal(desktopAffected(["docs/roadmap.md", path]), true, path);
    }
  });

  it("runs when the change list is empty", () => {
    assert.equal(desktopAffected([]), true);
  });
});

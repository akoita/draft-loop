import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { desktopAffected } from "./desktop-ci-scope.mjs";

describe("desktop CI scope", () => {
  it("skips documentation and test-only changes", () => {
    assert.equal(
      desktopAffected([
        "docs/roadmap.md",
        "README.md",
        "AGENTS.md",
        "compose.yaml",
        ".claude/skills/steward/SKILL.md",
        "packages/storage/src/conformance/sqlite.test.ts",
        "apps/desktop/src/renderer/app.test.tsx",
        "scripts/desktop-acceptance.test.mjs",
      ]),
      false,
    );
  });

  it("runs when any bundled source, script, workflow or dependency changes", () => {
    for (const path of [
      "packages/storage/src/knowledge-store.ts",
      "apps/desktop/forge.config.ts",
      "packages/rendering/fonts/carlito/NOTICE.md",
      "scripts/desktop-acceptance.mjs",
      ".github/workflows/desktop-acceptance.yml",
      "pnpm-lock.yaml",
      "package.json",
    ]) {
      assert.equal(desktopAffected(["docs/roadmap.md", path]), true, path);
    }
  });

  it("runs when the change list is empty", () => {
    assert.equal(desktopAffected([]), true);
  });
});

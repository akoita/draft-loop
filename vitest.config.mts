import { defineConfig } from "vitest/config";

import { linguiMacro } from "./packages/ui/lingui-macro.mjs";

const testExclusions = [
  "**/node_modules/**",
  "**/dist/**",
  "**/scripts/**",
  "**/.claude/worktrees/**",
];

const loadSensitiveIntegrationFiles = [
  "apps/cli/src/workflow.test.ts",
  "packages/application/src/adjudicated-revision-validation.test.ts",
];

export default defineConfig({
  // The shared screens' Lingui macros compile to catalog lookups, as in the web build (#2321).
  plugins: [linguiMacro()],
  test: {
    // English is active before any screen test renders, as the hosts activate it at startup.
    setupFiles: ["./packages/ui/src/i18n-test-setup.ts"],
    // Agent tooling creates git worktrees under `.claude/worktrees/`. Vitest
    // does not read `.gitignore`, so without this it collects test files from
    // those checkouts, which have no installed dependencies, and `pnpm test`
    // fails for reasons unrelated to the working tree.
    exclude: testExclusions,
    // A handful of tests drive the real application: a SQLite workspace, the
    // filesystem, a full author-critic round. They finish in a few seconds on an
    // idle machine and exceed the default when the suite runs in parallel on a
    // busy one, which made `pnpm test` fail locally on a tree that CI passed.
    // The bound stays low enough that a genuinely hung test still fails.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These filesystem/SQLite integration suites pass alone but have
    // failed at varying assertions when scheduled alongside other files. Keep
    // them in a serial group before the rest of the suite; other files retain
    // Vitest's normal parallel scheduling. Vitest sends isolated, single-worker
    // projects at the default groupOrder 0 to a trailing serial group, so use
    // explicit nonzero orders to make the intended sequence effective.
    projects: [
      {
        extends: true,
        test: {
          name: "load-sensitive-integration",
          include: loadSensitiveIntegrationFiles,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "parallel-suite",
          exclude: [...testExclusions, ...loadSensitiveIntegrationFiles],
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agent tooling creates git worktrees under `.claude/worktrees/`. Vitest
    // does not read `.gitignore`, so without this it collects test files from
    // those checkouts, which have no installed dependencies, and `pnpm test`
    // fails for reasons unrelated to the working tree.
    exclude: ["**/node_modules/**", "**/dist/**", "**/scripts/**", "**/.claude/worktrees/**"],
    // A handful of tests drive the real application: a SQLite workspace, the
    // filesystem, a full author-critic round. They finish in a few seconds on an
    // idle machine and exceed the default when the suite runs in parallel on a
    // busy one, which made `pnpm test` fail locally on a tree that CI passed.
    // The bound stays low enough that a genuinely hung test still fails.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

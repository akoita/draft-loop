import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agent tooling creates git worktrees under `.claude/worktrees/`. Vitest
    // does not read `.gitignore`, so without this it collects test files from
    // those checkouts, which have no installed dependencies, and `pnpm test`
    // fails for reasons unrelated to the working tree.
    exclude: ["**/node_modules/**", "**/dist/**", "**/scripts/**", "**/.claude/worktrees/**"],
  },
});

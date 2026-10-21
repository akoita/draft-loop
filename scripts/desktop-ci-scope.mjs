#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Paths that cannot change the packaged desktop application. Everything else,
// including workflows, scripts, the lockfile and any package the app bundles,
// keeps the cross-platform desktop acceptance jobs in scope.
const outOfScope = [
  (path) => path.startsWith("docs/"),
  (path) => path.startsWith(".claude/"),
  (path) => !path.includes("/") && path.endsWith(".md"),
  (path) => path === "compose.yaml",
  (path) => /\.test\.(?:ts|tsx|mjs)$/.test(path),
];

export function desktopAffected(paths) {
  if (paths.length === 0) {
    return true;
  }
  return paths.some((path) => !outOfScope.some((matches) => matches(path)));
}

function pullRequestPaths() {
  // On pull_request events the checkout is the merge commit, whose first
  // parent is the base branch tip.
  const output = execFileSync("git", ["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"], {
    encoding: "utf8",
  });
  return output.split("\n").filter((line) => line.length > 0);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const affected =
    process.env.GITHUB_EVENT_NAME !== "pull_request" || desktopAffected(pullRequestPaths());
  process.stdout.write(`desktop=${affected}\n`);
}

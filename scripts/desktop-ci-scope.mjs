#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Paths that can change the packaged desktop client (ADR 0011, D9). The client
// bundles no workspace package: it loads the server's own web screen, so only
// its own sources, its acceptance, the toolchain and the dependencies count.
// Tests are left out because the acceptance drives the packaged app.
const inScope = [
  (path) => path.startsWith("apps/desktop-client/"),
  (path) => path === "scripts/desktop-client-acceptance.mjs",
  (path) => path === "scripts/desktop-ci-scope.mjs",
  (path) => path === ".github/workflows/desktop-acceptance.yml",
  (path) => path === "package.json",
  (path) => path === "pnpm-lock.yaml",
  (path) => path === "pnpm-workspace.yaml",
  (path) => path === ".nvmrc",
];

const testOnly = (path) => /\.test\.(?:ts|tsx|mjs)$/.test(path);

export function desktopAffected(paths) {
  if (paths.length === 0) {
    return true;
  }
  return paths.some((path) => !testOnly(path) && inScope.some((matches) => matches(path)));
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

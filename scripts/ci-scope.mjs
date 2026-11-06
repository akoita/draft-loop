#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Decides which CI jobs a pull request needs. Tests run for the workspace
// packages a change touches plus every package that depends on them. Any path
// no rule below knows runs everything, so a new kind of file is safe by default.

const docsFiles = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  ".claude/settings.json",
  ".github/pull_request_template.md",
]);

const isDocs = (path) =>
  docsFiles.has(path) || path.startsWith("docs/") || path.startsWith(".github/ISSUE_TEMPLATE/");

// Inputs of the static checks only, which run on every pull request.
const staticOnlyFiles = new Set([
  ".markdownlint-cli2.mjs",
  ".editorconfig",
  "lefthook.yml",
  ".github/dependabot.yml",
]);

// The toolchain and CI itself: a change here can break any test.
const runAllFiles = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".nvmrc",
  ".node-version",
  ".npmrc",
  "tsconfig.json",
  "vitest.config.mts",
  "lingui.config.ts",
  "biome.json",
  "eslint.config.mjs",
  "prettier.config.mjs",
  ".github/workflows/ci.yml",
  "scripts/ci-scope.mjs",
]);

// Checked by `pnpm test:release`, which runs on every pull request that is not docs only.
const isReleaseTooling = (path) =>
  path.startsWith("scripts/") ||
  path.startsWith(".github/workflows/") ||
  path === "release.json" ||
  path === "server-release.json";

const isSelfHostedInput = (path) =>
  path.startsWith("deploy/") ||
  path.startsWith("compose/") ||
  path === "compose.yaml" ||
  path === ".dockerignore" ||
  path.startsWith("scripts/self-hosted-") ||
  path.startsWith("scripts/draft-loop-server");

const serverStoragePackages = [
  "packages/storage-postgres",
  "packages/storage-gcs",
  "packages/run-queue",
  "apps/api",
  "apps/worker",
];

const selfHostedPackages = ["apps/api", "apps/worker", "apps/page-fetcher", "apps/web"];

function packageDirectory(path) {
  const match = /^(apps|packages)\/([^/]+)\//u.exec(path);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * @param {string[]} paths changed paths
 * @param {Map<string, string[]>} workspace package directory -> directories of the workspace packages it depends on
 */
export function classifyChanges(paths, workspace) {
  const result = {
    docsOnly: false,
    runAll: false,
    tests: false,
    packages: [],
    serverStorage: false,
    selfHosted: false,
  };
  if (paths.length === 0) {
    return everything(result);
  }

  const changed = new Set();
  let docsOnly = true;
  for (const path of paths) {
    if (isDocs(path)) {
      continue;
    }
    docsOnly = false;
    const directory = packageDirectory(path);
    if (runAllFiles.has(path) || (directory !== undefined && !workspace.has(directory))) {
      return everything(result);
    }
    if (directory !== undefined) {
      changed.add(directory);
    } else if (isSelfHostedInput(path)) {
      result.selfHosted = true;
    } else if (!staticOnlyFiles.has(path) && !isReleaseTooling(path)) {
      return everything(result);
    }
  }
  if (docsOnly) {
    result.docsOnly = true;
    return result;
  }

  const affected = withDependents(changed, workspace);
  result.tests = true;
  result.packages = [...affected].sort();
  result.serverStorage = serverStoragePackages.some((directory) => affected.has(directory));
  result.selfHosted ||= selfHostedPackages.some((directory) => affected.has(directory));
  return result;
}

function everything(result) {
  return { ...result, runAll: true, tests: true, serverStorage: true, selfHosted: true };
}

function withDependents(changed, workspace) {
  const affected = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [directory, dependencies] of workspace) {
      if (!affected.has(directory) && dependencies.some((dependency) => affected.has(dependency))) {
        affected.add(directory);
        grew = true;
      }
    }
  }
  return affected;
}

export function readWorkspace(root) {
  const manifests = new Map();
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = `${group}/${entry.name}`;
      try {
        manifests.set(
          directory,
          JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8")),
        );
      } catch {
        // A folder without a manifest is not a workspace package.
      }
    }
  }
  const directoryOf = new Map([...manifests].map(([directory, { name }]) => [name, directory]));
  const workspace = new Map();
  for (const [directory, manifest] of manifests) {
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    workspace.set(
      directory,
      names.flatMap((name) => (directoryOf.has(name) ? [directoryOf.get(name)] : [])),
    );
  }
  return workspace;
}

function pullRequestPaths() {
  // On pull_request events the checkout is the merge commit, whose first
  // parent is the base branch tip.
  const output = execFileSync("git", ["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"], {
    encoding: "utf8",
  });
  return output.split("\n").filter((line) => line.length > 0);
}

export function formatOutputs(result) {
  return [
    `docs_only=${result.docsOnly}`,
    `run_all=${result.runAll}`,
    `tests=${result.tests}`,
    `packages=${result.packages.join(" ")}`,
    // The Tests job's matrix: a full run splits the suite across three runners.
    `shards=${JSON.stringify(result.runAll ? [1, 2, 3] : [1])}`,
    `server_storage=${result.serverStorage}`,
    `self_hosted=${result.selfHosted}`,
  ].join("\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workspace = readWorkspace(process.cwd());
  let paths = [];
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    try {
      paths = pullRequestPaths();
    } catch (error) {
      process.stderr.write(`Could not list the changed paths, so everything runs: ${error}\n`);
    }
  }
  const result = classifyChanges(paths, workspace);
  process.stderr.write(`Changed paths:\n${paths.join("\n") || "(none)"}\n`);
  process.stdout.write(`${formatOutputs(result)}\n`);
}

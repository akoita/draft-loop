#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

/**
 * Checks the self-hosted stack the way a person installs it, with no provider call: it builds the
 * three images from this clone and tags them as release 0.0.0 of a local registry, installs that
 * release with `draft-loop-server install`, starts it with the worker on its offline fixtures, runs
 * the hosted smoke through the API (upload, run, review, approval, DOCX export), backs the stack
 * up, erases it, restores the archive, checks that the records, files and owner token came back,
 * and runs the smoke once more. Used by the Self-hosted stack CI job and `pnpm self-hosted:test`.
 */
const repository = fileURLToPath(new URL("..", import.meta.url));

export const selfHostedSmokeVersion = "0.0.0";
export const selfHostedSmokeRegistry = "draft-loop-smoke";
// A project name and port of their own, so the smoke never touches a person's own stack.
export const selfHostedSmokeProject = "draft-loop-self-hosted-smoke";
export const selfHostedSmokePort = "58090";
export const selfHostedSmokeApiUrl = `http://127.0.0.1:${selfHostedSmokePort}`;
const apps = ["api", "worker", "page-fetcher"];

/** What the smoke compares before the backup and after the restore. */
export const selfHostedSmokeChecks = Object.freeze({
  runs: [
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username=postgres",
    "--dbname=draft_loop",
    "--tuples-only",
    "--no-align",
    "--command=select count(*) from draft_loop.runs",
  ],
  files: [
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "--entrypoint",
    "sh",
    "init",
    "-c",
    "find /blobs -type f | wc -l",
  ],
});

/** Packs this clone's deploy/local as GitHub's tag archive would hold it. */
function packRelease(scratch) {
  const top = join(scratch, "archive", `draft-loop-server-v${selfHostedSmokeVersion}`);
  mkdirSync(join(top, "deploy"), { recursive: true });
  cpSync(join(repository, "deploy/local"), join(top, "deploy/local"), {
    recursive: true,
    filter: (path) => !/[\\/]keys[\\/].+/u.test(path) || path.endsWith(".gitignore"),
  });
  const archive = join(scratch, "release.tar.gz");
  return {
    archive,
    args: [
      "-czf",
      archive,
      "-C",
      join(scratch, "archive"),
      `draft-loop-server-v${selfHostedSmokeVersion}`,
    ],
  };
}

export function runSelfHostedSmoke({
  env = process.env,
  spawn = spawnSync,
  keep = false,
  scratch = mkdtempSync(join(tmpdir(), "draft-loop-self-hosted-smoke-")),
} = {}) {
  const home = join(scratch, "server");
  const script = join(home, "bin", "draft-loop-server");
  const stackEnv = {
    ...env,
    COMPOSE_PROJECT_NAME: selfHostedSmokeProject,
    DRAFT_LOOP_SERVER_HOME: home,
  };
  const run = (command, args, options = {}) =>
    spawn(command, args, { env: stackEnv, stdio: "inherit", cwd: repository, ...options });
  const read = (command, args) => {
    const result = run(command, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
    return result.status === 0 ? String(result.stdout ?? "").trim() : undefined;
  };
  const compose = (...args) => [
    "docker",
    [
      "compose",
      "--file",
      join(home, "compose.yaml"),
      "--file",
      join(home, "compose.override.yaml"),
      ...args,
    ],
  ];
  const ok = (result) => result.status === 0;
  const smoke = (token) =>
    ok(
      run("pnpm", ["exec", "vitest", "run", "apps/api/src/server-stack.smoke.test.ts"], {
        env: {
          ...stackEnv,
          DRAFT_LOOP_TEST_API_URL: selfHostedSmokeApiUrl,
          DRAFT_LOOP_TEST_API_OWNER_TOKEN: token,
        },
      }),
    );
  const fail = (message) => {
    process.stderr.write(`self-hosted smoke: ${message}\n`);
    return 1;
  };

  let status;
  try {
    status = (() => {
      const build = [
        "compose",
        "--file",
        "deploy/local/compose.yaml",
        "--file",
        "deploy/local/compose.build.yaml",
        "build",
      ];
      if (!ok(run("docker", build))) return fail("building the images failed");
      for (const app of apps) {
        const tag = `${selfHostedSmokeRegistry}/draft-loop-${app}:${selfHostedSmokeVersion}`;
        if (!ok(run("docker", ["tag", `draft-loop-${app}:self-hosted`, tag]))) {
          return fail(`tagging ${app} failed`);
        }
      }
      const release = packRelease(scratch);
      if (!ok(run("tar", release.args))) return fail("packing the release failed");
      const install = run(
        "bash",
        [
          join(repository, "deploy/local/bin/draft-loop-server"),
          "install",
          selfHostedSmokeVersion,
          home,
        ],
        { env: { ...stackEnv, DRAFT_LOOP_SERVER_SOURCE: release.archive } },
      );
      if (!ok(install)) return fail("install failed");
      appendFileSync(
        join(home, ".env"),
        `DRAFT_LOOP_IMAGE_REGISTRY=${selfHostedSmokeRegistry}\nDRAFT_LOOP_PORT=${selfHostedSmokePort}\n`,
      );
      // Test only: the worker runs its offline fixtures, so no provider is called.
      writeFileSync(
        join(home, "compose.override.yaml"),
        'services:\n  worker:\n    environment:\n      DRAFT_LOOP_MODEL_ROUTES: ""\n',
      );
      if (!ok(run("bash", [script, "up"]))) return fail("up failed");
      const token = read("bash", [script, "token"]);
      if (token === undefined || token === "") return fail("no owner token");
      if (!smoke(token)) return fail("the smoke failed before the backup");

      const before = {
        runs: read(...compose(...selfHostedSmokeChecks.runs)),
        files: read(...compose(...selfHostedSmokeChecks.files)),
      };
      if (before.runs === undefined || before.runs === "0") return fail("no run was recorded");
      const archive = join(scratch, "backup.tar.gz");
      if (!ok(run("bash", [script, "backup", archive]))) return fail("backup failed");
      if (!ok(run(...compose("down", "--volumes")))) return fail("erasing the stack failed");
      if (!ok(run("bash", [script, "restore", archive]))) return fail("restore failed");
      const after = {
        runs: read(...compose(...selfHostedSmokeChecks.runs)),
        files: read(...compose(...selfHostedSmokeChecks.files)),
      };
      if (after.runs !== before.runs || after.files !== before.files) {
        return fail(
          `the restored stack differs: runs ${before.runs} then ${after.runs}, files ${before.files} then ${after.files}`,
        );
      }
      if (read("bash", [script, "token"]) !== token) return fail("the owner token changed");
      if (!smoke(token)) return fail("the smoke failed after the restore");
      process.stdout.write(
        `self-hosted smoke: passed; ${after.runs} runs and ${after.files} files restored
`,
      );
      return 0;
    })();
    if (status !== 0) run(...compose("logs", "--no-color", "--tail", "200"));
  } finally {
    if (!keep) {
      run(...compose("down", "--volumes"));
      rmSync(scratch, { force: true, recursive: true });
    }
  }
  return status;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runSelfHostedSmoke({ keep: process.argv.includes("--keep") });
}

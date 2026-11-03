import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, URL } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));

let scratch = "";
let archive = "";
let fakeBin = "";
let dockerLog = "";

/** The two twins: bash for Linux and macOS, PowerShell for Windows (tested where pwsh exists). */
const shells = [
  { name: "bash", run: ["bash"], file: "draft-loop-server", available: true },
  {
    name: "PowerShell",
    run: ["pwsh", "-NoLogo", "-NoProfile", "-File"],
    file: "draft-loop-server.ps1",
    available: spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"]).status === 0,
  },
];

/** Runs one twin with a fake `docker` that records its arguments. */
function server(shell, args, { home, env = {} } = {}) {
  const [command, ...options] = shell.run;
  const target =
    home === undefined
      ? join(repository, "deploy/local/bin", shell.file)
      : join(home, "bin", shell.file);
  const result = spawnSync(command, [...options, target, ...args], {
    encoding: "utf8",
    env: {
      PATH: `${fakeBin}:${process.env.PATH}`,
      HOME: scratch,
      DRAFT_LOOP_SERVER_SOURCE: archive,
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const dockerCalls = () =>
  readFileSync(dockerLog, "utf8")
    .split("\n")
    .filter((line) => line !== "");

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "draft-loop-server-"));
  // A release archive shaped like GitHub's tag archive: one top folder holding the repository.
  const top = join(scratch, "archive", "draft-loop-server-v0.12.0");
  mkdirSync(join(top, "deploy"), { recursive: true });
  cpSync(join(repository, "deploy/local"), join(top, "deploy/local"), {
    recursive: true,
    filter: (path) =>
      !path.includes(`${join("deploy", "local", "keys")}/`) || path.endsWith(".gitignore"),
  });
  archive = join(scratch, "source.tar.gz");
  const packed = spawnSync("tar", [
    "-czf",
    archive,
    "-C",
    join(scratch, "archive"),
    "draft-loop-server-v0.12.0",
  ]);
  assert.equal(packed.status, 0);
  fakeBin = join(scratch, "bin");
  mkdirSync(fakeBin);
  dockerLog = join(scratch, "docker.log");
  writeFileSync(dockerLog, "");
  writeFileSync(join(fakeBin, "docker"), `#!/bin/sh\necho "$*" >> "${dockerLog}"\n`);
  chmodSync(join(fakeBin, "docker"), 0o755);
});

after(() => rmSync(scratch, { force: true, recursive: true }));

for (const shell of shells) {
  describe(`draft-loop-server (${shell.name})`, {
    skip: !shell.available && "pwsh is not installed",
  }, () => {
    const homeOf = () => join(scratch, `home-${shell.name}`);
    const compose = () => `compose --file ${join(homeOf(), "compose.yaml")}`;

    it("installs a release's stack into a new folder with its version, and nothing to build", () => {
      writeFileSync(dockerLog, "");
      const installed = server(shell, ["install", "0.12.0", homeOf()]);
      assert.equal(installed.status, 0, installed.stderr);
      assert.equal(readFileSync(join(homeOf(), ".env"), "utf8"), "DRAFT_LOOP_VERSION=0.12.0\n");
      for (const file of [
        "compose.yaml",
        "README.md",
        "init/prepare.sh",
        "keys/.gitignore",
        "bin/draft-loop-server",
        "bin/draft-loop-server.ps1",
      ]) {
        assert.ok(statSync(join(homeOf(), file)).isFile(), file);
      }
      assert.throws(() => statSync(join(homeOf(), "compose.build.yaml")));
      if (shell.name === "bash") assert.equal(statSync(join(homeOf(), "keys")).mode & 0o777, 0o700);
      assert.match(installed.stdout, /keys/u);
      assert.deepEqual(dockerCalls(), []);
    });

    it("runs Docker Compose on the installed folder", () => {
      for (const command of ["up", "status", "token", "down"]) {
        const result = server(shell, [command], { home: homeOf() });
        assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      }
      assert.deepEqual(dockerCalls(), [
        `${compose()} up --detach --wait --remove-orphans`,
        `${compose()} ps`,
        `${compose()} exec -T api cat /secrets/owner_token`,
        `${compose()} down`,
      ]);
    });

    it("refuses a second install, a malformed version and a downgrade", () => {
      assert.match(
        server(shell, ["install", "0.12.0", homeOf()]).stderr,
        /already holds a stack; use upgrade/u,
      );
      assert.match(
        server(shell, ["install", "latest", join(scratch, "other")]).stderr,
        /must look like 0\.12\.0/u,
      );
      assert.match(
        server(shell, ["upgrade", "0.11.0"], { home: homeOf() }).stderr,
        /going back to 0\.11\.0 is not supported/u,
      );
    });

    it("upgrades in place, keeping the keys and the other settings, then restarts", () => {
      writeFileSync(join(homeOf(), ".env"), "DRAFT_LOOP_VERSION=0.11.0\nDRAFT_LOOP_PORT=9090\n");
      writeFileSync(join(homeOf(), "keys", "anthropic_api_key"), "fixture-not-a-key");
      writeFileSync(dockerLog, "");
      const upgraded = server(shell, ["upgrade", "0.12.0"], { home: homeOf() });
      assert.equal(upgraded.status, 0, upgraded.stderr);
      assert.equal(
        readFileSync(join(homeOf(), ".env"), "utf8"),
        "DRAFT_LOOP_VERSION=0.12.0\nDRAFT_LOOP_PORT=9090\n",
      );
      assert.equal(
        readFileSync(join(homeOf(), "keys", "anthropic_api_key"), "utf8"),
        "fixture-not-a-key",
      );
      assert.deepEqual(dockerCalls(), [`${compose()} up --detach --wait --remove-orphans`]);
    });

    it("names a folder that holds no stack instead of calling Docker", () => {
      const result = server(shell, ["up"], {
        env: { DRAFT_LOOP_SERVER_HOME: join(scratch, "empty") },
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /holds no self-hosted stack; run install first/u);
    });
  });
}

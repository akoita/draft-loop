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
function server(shell, args, { home, script, env = {} } = {}) {
  const [command, ...options] = shell.run;
  const target =
    script ??
    (home === undefined
      ? join(repository, "deploy/local/bin", shell.file)
      : join(home, "bin", shell.file));
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
  // Records each call; the steps that hand files back (a dump copied out, a files archive written
  // to a mounted folder) leave a placeholder file where the real ones would.
  writeFileSync(
    join(fakeBin, "docker"),
    [
      "#!/bin/sh",
      `echo "$*" >> "${dockerLog}"`,
      "for last; do :; done",
      'case "$*" in *" cp postgres:"*) printf dump > "$last" ;; esac',
      'case "$*" in *"-czf /backup/files.tar.gz"*)',
      "  folder=\"$(printf '%s\\n' \"$@\" | sed -n 's#^\\(.*\\):/backup$#\\1#p')\"",
      '  printf files > "$folder/files.tar.gz" ;;',
      "esac",
      "",
    ].join("\n"),
  );
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
        if (command === "up") {
          assert.match(result.stdout, /DraftLoop is running at http:\/\/127\.0\.0\.1:8080\n/u);
          assert.match(
            result.stdout,
            /owner token, which this prints: .+draft-loop-server(\.ps1)? token\n/u,
          );
          assert.match(
            result.stdout,
            /github\.com\/akoita\/draft-loop\/releases and choose This computer/u,
          );
        }
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
      const fileInTheWay = join(scratch, "file-in-the-way");
      writeFileSync(fileInTheWay, "#!/usr/bin/env bash\n");
      assert.match(
        server(shell, ["install", "0.12.0", fileInTheWay]).stderr,
        /is a file, not a folder/u,
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
      assert.match(upgraded.stdout, /running at http:\/\/127\.0\.0\.1:9090\n/u);
      assert.match(upgraded.stdout, /releases and add http:\/\/127\.0\.0\.1:9090\./u);
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

    it("backs up the database, files and secrets into one private archive", () => {
      writeFileSync(dockerLog, "");
      const archive = join(scratch, `backup-${shell.name}.tar.gz`);
      const result = server(shell, ["backup", archive], { home: homeOf() });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Keep it private/u);
      const listed = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" }).stdout;
      assert.deepEqual(listed.trim().split("\n").sort(), [
        "backup.json",
        "database.dump",
        "files.tar.gz",
      ]);
      const manifest = JSON.parse(
        spawnSync("tar", ["-xzOf", archive, "backup.json"], { encoding: "utf8" }).stdout,
      );
      assert.equal(manifest.format, "draft-loop-self-hosted-backup");
      assert.equal(manifest.formatVersion, 1);
      assert.equal(manifest.serverVersion, "0.12.0");
      if (shell.name === "bash") assert.equal(statSync(archive).mode & 0o077, 0);
      const calls = dockerCalls().map((call) => call.replace(`${compose()} `, ""));
      assert.match(calls[0], /^exec -T postgres pg_dump --username=postgres --format=custom /u);
      assert.match(calls[1], /^cp postgres:\/tmp\/draft-loop-backup\.dump /u);
      assert.match(
        calls[3],
        /^run --rm --no-deps -T --volume .+:\/backup --entrypoint tar init -czf \/backup\/files\.tar\.gz -C \/ blobs secrets postgres-secrets$/u,
      );
      assert.ok(calls.every((call) => !call.includes("provider-keys")));
      assert.match(
        server(shell, ["backup", archive], { home: homeOf() }).stderr,
        /already exists; name a new file/u,
      );
    });

    it("restores an archive in order: files and secrets, Postgres, its role, the dump, the rest", () => {
      writeFileSync(dockerLog, "");
      const archive = join(scratch, `backup-${shell.name}.tar.gz`);
      const result = server(shell, ["restore", archive], { home: homeOf() });
      assert.equal(result.status, 0, result.stderr);
      const calls = dockerCalls().map((call) => call.replace(`${compose()} `, ""));
      const steps = calls.map((call) =>
        call.includes("test ! -s /secrets/owner_token")
          ? "check-empty"
          : call.includes("-xzf /backup/files.tar.gz")
            ? "unpack-files"
            : call === "up --detach --wait postgres"
              ? "postgres"
              : call === "run --rm --no-deps postgres-setup"
                ? "role"
                : call.startsWith("cp ")
                  ? "copy-dump"
                  : call.includes("pg_restore")
                    ? "load-dump"
                    : call.includes("rm -f")
                      ? "clean"
                      : call === "up --detach --wait --remove-orphans"
                        ? "start"
                        : call,
      );
      assert.deepEqual(steps, [
        "check-empty",
        "unpack-files",
        "postgres",
        "role",
        "copy-dump",
        "load-dump",
        "clean",
        "start",
      ]);
      assert.match(calls[1], /--volume .+:\/backup:ro /u);
    });

    it("refuses an archive from a newer server or one that is not a backup", () => {
      const newer = join(scratch, `newer-${shell.name}`);
      mkdirSync(newer, { recursive: true });
      writeFileSync(
        join(newer, "backup.json"),
        '{"format":"draft-loop-self-hosted-backup","formatVersion":1,"serverVersion":"0.99.0","createdAt":"2026-11-03T00:00:00Z"}\n',
      );
      writeFileSync(join(newer, "database.dump"), "dump");
      writeFileSync(join(newer, "files.tar.gz"), "files");
      const archive = join(scratch, `newer-${shell.name}.tar.gz`);
      spawnSync("tar", [
        "-czf",
        archive,
        "-C",
        newer,
        "backup.json",
        "database.dump",
        "files.tar.gz",
      ]);
      assert.match(
        server(shell, ["restore", archive], { home: homeOf() }).stderr,
        /comes from server 0\.99\.0, newer than 0\.12\.0 here/u,
      );
      assert.match(
        server(shell, ["restore", join(scratch, "source.tar.gz")], { home: homeOf() }).stderr,
        /is not a DraftLoop server backup/u,
      );
    });

    it("upgrades the default folder from a downloaded copy of the script", () => {
      // The install steps fetch the script to a scratch folder such as /tmp, outside any stack.
      const downloads = join(scratch, `downloads-${shell.name}`);
      mkdirSync(downloads, { recursive: true });
      const script = join(downloads, shell.file);
      cpSync(join(repository, "deploy/local/bin", shell.file), script);
      const home = join(scratch, `home-default-${shell.name}`);
      const env = { HOME: home };
      assert.equal(server(shell, ["install", "0.11.0"], { script, env }).status, 0);
      writeFileSync(dockerLog, "");
      const upgraded = server(shell, ["upgrade", "0.12.0"], { script, env });
      assert.equal(upgraded.status, 0, upgraded.stderr);
      const installed = join(home, "draft-loop-server");
      assert.match(
        readFileSync(join(installed, ".env"), "utf8"),
        /^DRAFT_LOOP_VERSION=0\.12\.0$/mu,
      );
      assert.deepEqual(dockerCalls(), [
        `compose --file ${join(installed, "compose.yaml")} up --detach --wait --remove-orphans`,
      ]);
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

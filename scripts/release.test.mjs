import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  checkRelease,
  collectArtifacts,
  createReleaseManifest,
  discoverPackagePaths,
  main,
  validateReleaseMetadata,
} from "./release.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createFixture({ packageVersions = {}, metadata = {} } = {}) {
  const rootDirectory = mkdtempSync(join(tmpdir(), "draft-loop-release-"));
  temporaryDirectories.push(rootDirectory);
  writeJson(join(rootDirectory, "package.json"), {
    name: "draft-loop",
    version: "0.1.0",
    packageManager: "pnpm@10.18.3",
    ...packageVersions.root,
  });
  writeJson(join(rootDirectory, "release.json"), {
    project: "draft-loop",
    stage: "integrated-local-alpha",
    channel: "alpha",
    releaseName: "Integrated local alpha",
    artifactTargets: ["linux-x64", "macos-arm64", "windows-x64"],
    ...metadata,
  });

  const workspacePackages = [
    ["apps/zeta", "@draft-loop/zeta"],
    ["apps/alpha", "@draft-loop/alpha"],
    ["packages/zeta", "@draft-loop/packages-zeta"],
    ["packages/alpha", "@draft-loop/packages-alpha"],
  ];
  for (const [directory, name] of workspacePackages) {
    mkdirSync(join(rootDirectory, directory), { recursive: true });
    writeJson(join(rootDirectory, directory, "package.json"), {
      name,
      version: packageVersions[directory]?.version ?? "0.1.0",
    });
  }
  mkdirSync(join(rootDirectory, "apps", "without-manifest"));
  return rootDirectory;
}

function streams() {
  const result = { stdout: "", stderr: "" };
  return {
    result,
    stdout: {
      write(value) {
        result.stdout += value;
      },
    },
    stderr: {
      write(value) {
        result.stderr += value;
      },
    },
  };
}

describe("release package discovery and checks", () => {
  test("discovers root and workspace manifests in deterministic order", () => {
    const rootDirectory = createFixture();

    assert.deepEqual(discoverPackagePaths(rootDirectory), [
      "package.json",
      "apps/alpha/package.json",
      "apps/zeta/package.json",
      "packages/alpha/package.json",
      "packages/zeta/package.json",
    ]);
    assert.equal(checkRelease(rootDirectory).version, "0.1.0");
  });

  test("reports a useful package version mismatch", () => {
    const rootDirectory = createFixture({
      packageVersions: { "packages/alpha": { version: "0.2.0" } },
    });

    assert.throws(
      () => checkRelease(rootDirectory),
      /packages\/alpha\/package\.json has version 0\.2\.0, expected 0\.1\.0/,
    );
  });

  test("validates required release metadata fields", () => {
    assert.throws(
      () => validateReleaseMetadata({ project: "draft-loop", artifactTargets: [] }),
      /stage must be a non-empty string[\s\S]*channel must be a non-empty string[\s\S]*releaseName must be a non-empty string[\s\S]*artifactTargets must be a non-empty array/,
    );

    const rootDirectory = createFixture({ metadata: { project: "other-project" } });
    assert.throws(
      () => checkRelease(rootDirectory),
      /project must match the root package name draft-loop/,
    );
  });
});

describe("release manifest artifacts", () => {
  test("hashes artifacts, reports byte sizes, and ignores checksum files", () => {
    const rootDirectory = createFixture();
    const artifactsDirectory = join(rootDirectory, "artifacts");
    mkdirSync(join(artifactsDirectory, "nested"), { recursive: true });
    const binaryArtifact = Uint8Array.from([0, 1, 2, 3]);
    writeFileSync(join(artifactsDirectory, "app.bin"), binaryArtifact);
    writeFileSync(join(artifactsDirectory, "nested", "readme.txt"), "hello\n", "utf8");
    writeFileSync(join(artifactsDirectory, "app.bin.sha256"), "ignored", "utf8");
    writeFileSync(join(artifactsDirectory, "checksums.txt"), "ignored", "utf8");

    const artifacts = collectArtifacts(artifactsDirectory);
    assert.deepEqual(artifacts, [
      {
        path: "app.bin",
        bytes: 4,
        sha256: createHash("sha256").update(binaryArtifact).digest("hex"),
      },
      {
        path: "nested/readme.txt",
        bytes: 6,
        sha256: createHash("sha256").update("hello\n", "utf8").digest("hex"),
      },
    ]);
  });

  test("builds a deterministic manifest from explicit inputs", () => {
    const rootDirectory = createFixture();
    const artifactsDirectory = join(rootDirectory, "artifacts");
    mkdirSync(artifactsDirectory);
    writeFileSync(join(artifactsDirectory, "release.txt"), "release", "utf8");

    const options = {
      rootDirectory,
      artifactsDirectory,
      commit: "0123456789abcdef",
      generatedAt: "2026-08-13T12:00:00.000Z",
      runtime: { node: "v24.5.0", pnpm: "10.18.3" },
    };
    const first = createReleaseManifest(options);
    const second = createReleaseManifest(options);

    assert.deepEqual(first, second);
    assert.equal(first.schemaVersion, 1);
    assert.equal(first.tag, "v0.1.0");
    assert.deepEqual(first.artifactTargets, ["linux-x64", "macos-arm64", "windows-x64"]);
    assert.equal(first.packages[0].path, "package.json");
    assert.equal(first.artifacts[0].path, "release.txt");
  });
});

describe("release CLI", () => {
  test("dry-run prints JSON and does not write an output file", async () => {
    const rootDirectory = createFixture();
    const outputPath = join(rootDirectory, "manifest.json");
    const io = streams();

    const exitCode = await main(
      [
        "manifest",
        "--dry-run",
        "--output",
        outputPath,
        "--commit",
        "0123456",
        "--generated-at",
        "2026-08-13T12:00:00.000Z",
      ],
      { rootDirectory, stdout: io.stdout, stderr: io.stderr },
    );

    assert.equal(exitCode, 0);
    assert.equal(io.result.stderr, "");
    assert.equal(JSON.parse(io.result.stdout).commit, "0123456");
    assert.equal(JSON.parse(io.result.stdout).generatedAt, "2026-08-13T12:00:00.000Z");
    assert.throws(() => readFileSync(outputPath), /ENOENT/);
  });

  test("writes a manifest for the normal command", async () => {
    const rootDirectory = createFixture();
    const outputPath = join(rootDirectory, "out", "release-manifest.json");
    const io = streams();

    const exitCode = await main(
      ["manifest", "--output", outputPath, "--generated-at", "2026-08-13T12:00:00Z"],
      { rootDirectory, stdout: io.stdout, stderr: io.stderr },
    );

    assert.equal(exitCode, 0);
    assert.equal(io.result.stderr, "");
    assert.equal(
      JSON.parse(readFileSync(outputPath, "utf8")).generatedAt,
      "2026-08-13T12:00:00.000Z",
    );
  });
});

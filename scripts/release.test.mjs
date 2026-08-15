import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  checkRelease,
  classifySizeReportPath,
  collectArtifacts,
  createReleaseManifest,
  createSizeReport,
  discoverPackagePaths,
  formatSizeReport,
  main,
  serializeSizeReport,
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
    stageIssue: 46,
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

function writeSizedFile(filePath, bytes) {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, Buffer.alloc(bytes, 65));
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function createStoredZip(filePath, entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    localParts.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  writeFileSync(filePath, Buffer.concat([...localParts, centralDirectory, end]));
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
      /stage must be a non-empty string[\s\S]*channel must be a non-empty string[\s\S]*releaseName must be a non-empty string[\s\S]*stageIssue must be a positive integer[\s\S]*artifactTargets must be a non-empty array/,
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
    assert.equal(first.stageIssue, 46);
    assert.deepEqual(first.artifactTargets, ["linux-x64", "macos-arm64", "windows-x64"]);
    assert.equal(first.packages[0].path, "package.json");
    assert.equal(first.artifacts[0].path, "release.txt");
  });
});

describe("package size reports", () => {
  test("uses exact path rules for categories", () => {
    assert.equal(classifySizeReportPath("runtime/electron"), "runtime");
    assert.equal(
      classifySizeReportPath("node_modules/better-sqlite3/build/binding.node"),
      "nativeModules",
    );
    assert.equal(classifySizeReportPath("node_modules/react/index.js"), "dependencies");
    assert.equal(classifySizeReportPath("assets/icon.png"), "assets");
    assert.equal(classifySizeReportPath("dist/main.js"), "generated");
    assert.equal(classifySizeReportPath("dist/main.js.map"), "sourceMaps");
    assert.equal(classifySizeReportPath("tests/review.test.js"), "tests");
    assert.equal(classifySizeReportPath("src/contest.js"), "other");
    assert.throws(() => classifySizeReportPath("../outside.txt"), /unsafe size report path/);
  });

  test("reports deterministic directory totals with explicit category totals", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "draft-loop-size-"));
    temporaryDirectories.push(rootDirectory);
    const inputDirectory = join(rootDirectory, "package");
    writeSizedFile(join(inputDirectory, "runtime", "electron"), 4);
    writeSizedFile(
      join(inputDirectory, "node_modules", "better-sqlite3", "build", "binding.node"),
      5,
    );
    writeSizedFile(join(inputDirectory, "node_modules", "react", "index.js"), 6);
    writeSizedFile(join(inputDirectory, "assets", "icon.png"), 7);
    writeSizedFile(join(inputDirectory, "dist", "main.js"), 8);
    writeSizedFile(join(inputDirectory, "dist", "main.js.map"), 9);
    writeSizedFile(join(inputDirectory, "tests", "review.test.js"), 10);
    writeSizedFile(join(inputDirectory, "src", "readme.txt"), 11);

    const first = createSizeReport(inputDirectory);
    const second = createSizeReport(inputDirectory);

    assert.deepEqual(first, second);
    assert.equal(first.inputType, "directory");
    assert.equal(first.totalBytes, 60);
    assert.equal(first.totalStoredBytes, 60);
    assert.deepEqual(first.categories, {
      runtime: { bytes: 4, storedBytes: 4, files: 1 },
      nativeModules: { bytes: 5, storedBytes: 5, files: 1 },
      dependencies: { bytes: 6, storedBytes: 6, files: 1 },
      assets: { bytes: 7, storedBytes: 7, files: 1 },
      generated: { bytes: 8, storedBytes: 8, files: 1 },
      sourceMaps: { bytes: 9, storedBytes: 9, files: 1 },
      tests: { bytes: 10, storedBytes: 10, files: 1 },
      other: { bytes: 11, storedBytes: 11, files: 1 },
    });
    assert.deepEqual(
      first.files.map(({ path, category, bytes }) => ({ path, category, bytes })),
      [
        { path: "assets/icon.png", category: "assets", bytes: 7 },
        { path: "dist/main.js", category: "generated", bytes: 8 },
        { path: "dist/main.js.map", category: "sourceMaps", bytes: 9 },
        {
          path: "node_modules/better-sqlite3/build/binding.node",
          category: "nativeModules",
          bytes: 5,
        },
        { path: "node_modules/react/index.js", category: "dependencies", bytes: 6 },
        { path: "runtime/electron", category: "runtime", bytes: 4 },
        { path: "src/readme.txt", category: "other", bytes: 11 },
        { path: "tests/review.test.js", category: "tests", bytes: 10 },
      ],
    );
    assert.match(formatSizeReport(first), /Largest files:\n- 11 B other: src\/readme\.txt/);
    assert.match(serializeSizeReport(first), /"totalBytes": 60/);
  });

  test("reports ZIP archive logical and stored bytes", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "draft-loop-size-"));
    temporaryDirectories.push(rootDirectory);
    const archivePath = join(rootDirectory, "package.zip");
    createStoredZip(archivePath, [
      { path: "runtime/electron", data: Buffer.alloc(4, 65) },
      { path: "node_modules/native/binding.node", data: Buffer.alloc(5, 66) },
      { path: "dist/main.js.map", data: Buffer.alloc(6, 67) },
    ]);

    const report = createSizeReport(archivePath);

    assert.equal(report.inputType, "zip");
    assert.equal(report.totalBytes, 15);
    assert.equal(report.totalStoredBytes, 15);
    assert.equal(report.inputBytes > report.totalStoredBytes, true);
    assert.deepEqual(report.categories.runtime, { bytes: 4, storedBytes: 4, files: 1 });
    assert.deepEqual(report.categories.nativeModules, { bytes: 5, storedBytes: 5, files: 1 });
    assert.deepEqual(report.categories.sourceMaps, { bytes: 6, storedBytes: 6, files: 1 });
    assert.match(formatSizeReport(report), /Package size report \(ZIP archive\)/);
  });

  test("rejects unsafe ZIP entry paths", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "draft-loop-size-"));
    temporaryDirectories.push(rootDirectory);
    const archivePath = join(rootDirectory, "unsafe.zip");
    createStoredZip(archivePath, [{ path: "../outside.txt", data: "unsafe" }]);

    assert.throws(() => createSizeReport(archivePath), /unsafe size report path/);
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

  test("runs the size report without release metadata and supports text output", async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "draft-loop-size-cli-"));
    temporaryDirectories.push(rootDirectory);
    const inputDirectory = join(rootDirectory, "package");
    writeSizedFile(join(inputDirectory, "runtime", "electron"), 4);
    const io = streams();

    const exitCode = await main(["size-report", "--input", inputDirectory, "--format", "text"], {
      rootDirectory,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    assert.equal(exitCode, 0);
    assert.equal(io.result.stderr, "");
    assert.match(io.result.stdout, /Package size report \(directory\)/);
    assert.match(io.result.stdout, /runtime: 4 B \(1 file\)/);
  });
});

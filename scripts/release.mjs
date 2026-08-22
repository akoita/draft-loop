import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELEASE_METADATA_FILE = "release.json";
const ROOT_PACKAGE_FILE = "package.json";
const README_FILE = "README.md";
const CANONICAL_RELEASES_URL = "https://github.com/akoita/draft-loop/releases";
const PINNED_RELEASE_TAG_URL_PATTERN =
  /https:\/\/github\.com\/akoita\/draft-loop\/releases\/tag\/v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?:[/?#\s)"'<>]|$)/;
const WORKSPACE_GROUPS = ["apps", "packages"];
const MANIFEST_SCHEMA_VERSION = 1;
export const SIZE_REPORT_SCHEMA_VERSION = 1;
export const SIZE_REPORT_CATEGORIES = Object.freeze([
  "runtime",
  "nativeModules",
  "dependencies",
  "assets",
  "generated",
  "sourceMaps",
  "tests",
  "other",
]);

const SIZE_REPORT_CATEGORY_LABELS = Object.freeze({
  runtime: "runtime",
  nativeModules: "native modules",
  dependencies: "dependencies",
  assets: "assets",
  generated: "generated",
  sourceMaps: "source maps",
  tests: "tests",
  other: "other",
});

export class ReleaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseError";
  }
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toPosixPath(value) {
  return value.split(sep).join("/");
}

function ensureObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ReleaseError(`${label} must contain a JSON object`);
  }
  return value;
}

function readJson(filePath, label) {
  let contents;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new ReleaseError(`cannot read ${label} at ${filePath}: ${error.message}`);
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new ReleaseError(`cannot parse ${label} at ${filePath}: ${error.message}`);
  }
}

function defaultRepositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function findRepositoryRoot(startDirectory = process.cwd()) {
  let current = resolve(startDirectory);

  try {
    if (!statSync(current).isDirectory()) current = dirname(current);
  } catch {
    current = resolve(startDirectory);
  }

  while (true) {
    if (existsSync(join(current, ROOT_PACKAGE_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return defaultRepositoryRoot();
}

export function discoverPackagePaths(rootDirectory = findRepositoryRoot()) {
  const rootDir = resolve(rootDirectory);
  const rootPackagePath = join(rootDir, ROOT_PACKAGE_FILE);
  if (!existsSync(rootPackagePath)) {
    throw new ReleaseError(`root package manifest is missing at ${rootPackagePath}`);
  }

  const paths = [ROOT_PACKAGE_FILE];
  for (const group of WORKSPACE_GROUPS) {
    const groupDirectory = join(rootDir, group);
    if (!existsSync(groupDirectory) || !lstatSync(groupDirectory).isDirectory()) continue;

    const children = readdirSync(groupDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareStrings);

    for (const child of children) {
      const relativePath = `${group}/${child}/${ROOT_PACKAGE_FILE}`;
      if (existsSync(join(rootDir, relativePath))) paths.push(relativePath);
    }
  }

  return paths;
}

export function discoverPackages(rootDirectory = findRepositoryRoot()) {
  const rootDir = resolve(rootDirectory);
  return discoverPackagePaths(rootDir).map((relativePath) => {
    const absolutePath = join(rootDir, relativePath);
    const packageJson = ensureObject(
      readJson(absolutePath, "package manifest"),
      "package manifest",
    );
    return {
      path: toPosixPath(relativePath),
      absolutePath,
      name: typeof packageJson.name === "string" ? packageJson.name : undefined,
      version: packageJson.version,
    };
  });
}

export const discoverPackageManifests = discoverPackages;

export function validatePackageVersions(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new ReleaseError("no package manifests were discovered");
  }

  const rootPackage = packages[0];
  if (rootPackage.path !== ROOT_PACKAGE_FILE) {
    throw new ReleaseError("the root package manifest must be discovered first");
  }
  if (typeof rootPackage.version !== "string" || rootPackage.version.trim() === "") {
    throw new ReleaseError("root package.json must define a non-empty version");
  }

  const version = rootPackage.version;
  const mismatches = [];
  for (const packageManifest of packages) {
    if (typeof packageManifest.version !== "string" || packageManifest.version.trim() === "") {
      mismatches.push(`${packageManifest.path} has no non-empty version`);
    } else if (packageManifest.version !== version) {
      mismatches.push(
        `${packageManifest.path} has version ${packageManifest.version}, expected ${version}`,
      );
    }
  }

  if (mismatches.length > 0) {
    throw new ReleaseError(`package version check failed:\n- ${mismatches.join("\n- ")}`);
  }

  return version;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function validateReleaseMetadata(metadata, { project } = {}) {
  ensureObject(metadata, RELEASE_METADATA_FILE);
  const errors = [];

  for (const field of ["project", "stage", "channel", "releaseName"]) {
    if (!nonEmptyString(metadata[field])) errors.push(`${field} must be a non-empty string`);
  }

  if (project !== undefined && nonEmptyString(metadata.project) && metadata.project !== project) {
    errors.push(`project must match the root package name ${project}`);
  }

  if (!Number.isInteger(metadata.stageIssue) || metadata.stageIssue < 1) {
    errors.push("stageIssue must be a positive integer");
  }

  if (!Array.isArray(metadata.artifactTargets) || metadata.artifactTargets.length === 0) {
    errors.push("artifactTargets must be a non-empty array");
  } else {
    const invalidTargets = metadata.artifactTargets.filter((target) => !nonEmptyString(target));
    if (invalidTargets.length > 0) {
      errors.push("artifactTargets must contain only non-empty strings");
    }
  }

  if (errors.length > 0)
    throw new ReleaseError(`release metadata check failed:\n- ${errors.join("\n- ")}`);
  return metadata;
}

export function validateReadmeReleaseLinks(readmeContents) {
  if (!nonEmptyString(readmeContents)) {
    throw new ReleaseError(
      `README release link check failed: ${README_FILE} must contain the canonical releases URL ${CANONICAL_RELEASES_URL}`,
    );
  }
  if (PINNED_RELEASE_TAG_URL_PATTERN.test(readmeContents)) {
    throw new ReleaseError(
      `README release link check failed: ${README_FILE} must not contain version-pinned GitHub release-tag links; use ${CANONICAL_RELEASES_URL}`,
    );
  }
  if (!readmeContents.includes(CANONICAL_RELEASES_URL)) {
    throw new ReleaseError(
      `README release link check failed: ${README_FILE} must contain the canonical releases URL ${CANONICAL_RELEASES_URL}`,
    );
  }
  return readmeContents;
}

export function checkRelease(rootDirectory = findRepositoryRoot()) {
  const rootDir = resolve(rootDirectory);
  const packages = discoverPackages(rootDir);
  const version = validatePackageVersions(packages);
  const rootPackage = readJson(join(rootDir, ROOT_PACKAGE_FILE), "root package manifest");
  const project = typeof rootPackage.name === "string" ? rootPackage.name : undefined;
  const metadataPath = join(rootDir, RELEASE_METADATA_FILE);
  if (!existsSync(metadataPath)) {
    throw new ReleaseError(`release metadata is missing at ${metadataPath}`);
  }
  const releaseMetadata = validateReleaseMetadata(
    readJson(metadataPath, RELEASE_METADATA_FILE),
    project === undefined ? {} : { project },
  );
  const readmePath = join(rootDir, README_FILE);
  if (!existsSync(readmePath)) {
    throw new ReleaseError(`README is missing at ${readmePath}`);
  }
  validateReadmeReleaseLinks(readFileSync(readmePath, "utf8"));

  return { rootDir, rootPackage, packages, releaseMetadata, version };
}

export const validateRelease = checkRelease;

const CHECKSUM_FILE_PATTERN =
  /(?:\.sha(?:1|224|256|384|512)(?:sum)?|\.md5(?:sum)?|\.checksum|\.checksums)$/i;
const CHECKSUM_FILE_NAMES = new Set([
  "checksum",
  "checksums",
  "checksums.txt",
  "md5sums",
  "md5sums.txt",
  "sha1sums",
  "sha1sums.txt",
  "sha256sums",
  "sha256sums.txt",
  "sha512sums",
  "sha512sums.txt",
]);

export function isChecksumFile(filePath) {
  const fileName = basename(filePath).toLowerCase();
  return CHECKSUM_FILE_NAMES.has(fileName) || CHECKSUM_FILE_PATTERN.test(fileName);
}

export function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function normalizeSizePath(value, { allowDirectory = false } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReleaseError("size report paths must be non-empty strings");
  }

  const pathWithPosixSeparators = value.replaceAll("\\", "/");
  if (
    [...pathWithPosixSeparators].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new ReleaseError(`size report path contains control characters: ${value}`);
  }

  const isDirectory = pathWithPosixSeparators.endsWith("/");
  if (pathWithPosixSeparators.startsWith("/") || /^[A-Za-z]:/.test(pathWithPosixSeparators)) {
    throw new ReleaseError(`unsafe size report path: ${value}`);
  }

  const segments = pathWithPosixSeparators.split("/").filter((segment) => segment !== "");
  if (segments.includes("..")) throw new ReleaseError(`unsafe size report path: ${value}`);
  const normalized = segments.filter((segment) => segment !== ".").join("/");
  if (normalized.length === 0) {
    if (allowDirectory && isDirectory) return undefined;
    throw new ReleaseError(`size report path is empty: ${value}`);
  }
  return normalized;
}

const SIZE_REPORT_RUNTIME_FILE_NAMES = new Set([
  "chrome-sandbox",
  "crashpad_handler",
  "d3dcompiler_47.dll",
  "electron",
  "electron.exe",
  "icudtl.dat",
  "libegl.so",
  "libegl.dll",
  "libffmpeg.so",
  "libffmpeg.dll",
  "libglesv2.so",
  "libglesv2.dll",
  "libvk_swiftshader.so",
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
]);
const SIZE_REPORT_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".icns",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
]);
const SIZE_REPORT_ASSET_SEGMENTS = new Set(["assets", "fonts", "icons", "images", "static"]);
const SIZE_REPORT_GENERATED_SEGMENTS = new Set([
  ".vite",
  "app.asar",
  "app.asar.unpacked",
  "build",
  "bundle",
  "bundles",
  "compiled",
  "dist",
  "generated",
  "out",
]);
const SIZE_REPORT_TEST_SEGMENTS = new Set([
  "__snapshots__",
  "__tests__",
  "fixtures",
  "test",
  "tests",
]);
const SIZE_REPORT_TEST_FILE_PATTERN = /(?:^|[._-])(?:spec|test)(?:[._-]|$)/i;

function fileExtension(fileName) {
  const extensionStart = fileName.lastIndexOf(".");
  return extensionStart === -1 ? "" : fileName.slice(extensionStart).toLowerCase();
}

export function classifySizeReportPath(pathValue) {
  const normalizedPath = normalizeSizePath(pathValue);
  const segments = normalizedPath.split("/");
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const lowerPath = lowerSegments.join("/");
  const fileName = lowerSegments.at(-1);
  const extension = fileExtension(fileName);

  if (
    lowerSegments.includes("runtime") ||
    lowerSegments.includes("electron") ||
    lowerSegments.includes("electron.app") ||
    lowerPath.includes("/contents/frameworks/") ||
    lowerPath.includes("/contents/macos/") ||
    SIZE_REPORT_RUNTIME_FILE_NAMES.has(fileName)
  ) {
    return "runtime";
  }
  if (extension === ".node") return "nativeModules";
  if (extension === ".map" || lowerPath.endsWith(".map.gz")) return "sourceMaps";
  if (
    lowerSegments.some((segment) => SIZE_REPORT_TEST_SEGMENTS.has(segment)) ||
    fileName.endsWith(".snap") ||
    SIZE_REPORT_TEST_FILE_PATTERN.test(fileName)
  ) {
    return "tests";
  }
  if (lowerSegments.includes("node_modules")) return "dependencies";
  if (
    lowerSegments.some((segment) => SIZE_REPORT_ASSET_SEGMENTS.has(segment)) ||
    SIZE_REPORT_ASSET_EXTENSIONS.has(extension)
  ) {
    return "assets";
  }
  if (
    lowerSegments.some((segment) => SIZE_REPORT_GENERATED_SEGMENTS.has(segment)) ||
    extension === ".asar"
  ) {
    return "generated";
  }
  return "other";
}

function collectSizeDirectoryEntries(directory, relativeDirectory = "", ignored = []) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareStrings(left.name, right.name),
  );
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
    const normalizedPath = normalizeSizePath(relativePath);
    if (entry.isDirectory()) {
      files.push(...collectSizeDirectoryEntries(absolutePath, relativePath, ignored));
    } else if (entry.isFile()) {
      files.push({
        path: normalizedPath,
        bytes: statSync(absolutePath).size,
        storedBytes: statSync(absolutePath).size,
      });
    } else if (entry.isSymbolicLink()) {
      ignored.push({ path: normalizedPath, reason: "symbolic-link" });
    } else {
      ignored.push({ path: normalizedPath, reason: "unsupported-entry" });
    }
  }
  return files;
}

function findZipEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) throw new ReleaseError("size report archive is not a valid ZIP file");
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new ReleaseError("size report archive is not a valid ZIP file");
}

function isZipDirectory(versionMadeBy, externalAttributes, pathValue) {
  const mode = externalAttributes >>> 16;
  const isPosixDirectory = (mode & 0o170000) === 0o040000;
  return pathValue.endsWith("/") || (versionMadeBy >>> 8 === 3 && isPosixDirectory);
}

function isZipSymbolicLink(versionMadeBy, externalAttributes) {
  const mode = externalAttributes >>> 16;
  return versionMadeBy >>> 8 === 3 && (mode & 0o170000) === 0o120000;
}

function collectZipEntries(archiveBuffer) {
  const endOfCentralDirectory = findZipEndOfCentralDirectory(archiveBuffer);
  const diskNumber = archiveBuffer.readUInt16LE(endOfCentralDirectory + 4);
  const centralDirectoryDisk = archiveBuffer.readUInt16LE(endOfCentralDirectory + 6);
  const entriesOnDisk = archiveBuffer.readUInt16LE(endOfCentralDirectory + 8);
  const entriesTotal = archiveBuffer.readUInt16LE(endOfCentralDirectory + 10);
  const centralDirectorySize = archiveBuffer.readUInt32LE(endOfCentralDirectory + 12);
  const centralDirectoryOffset = archiveBuffer.readUInt32LE(endOfCentralDirectory + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entriesTotal ||
    entriesTotal === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new ReleaseError("size report supports single-disk ZIP archives smaller than 4 GiB");
  }
  if (
    centralDirectoryOffset + centralDirectorySize > archiveBuffer.length ||
    endOfCentralDirectory < centralDirectoryOffset + centralDirectorySize
  ) {
    throw new ReleaseError("size report archive has an invalid ZIP central directory");
  }

  const files = [];
  const ignored = [];
  const seenPaths = new Set();
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < entriesTotal; index += 1) {
    if (cursor + 46 > archiveBuffer.length || archiveBuffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new ReleaseError("size report archive has an invalid ZIP entry");
    }
    const versionMadeBy = archiveBuffer.readUInt16LE(cursor + 4);
    const flags = archiveBuffer.readUInt16LE(cursor + 8);
    const compressedSize = archiveBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = archiveBuffer.readUInt32LE(cursor + 24);
    const fileNameLength = archiveBuffer.readUInt16LE(cursor + 28);
    const extraLength = archiveBuffer.readUInt16LE(cursor + 30);
    const commentLength = archiveBuffer.readUInt16LE(cursor + 32);
    const externalAttributes = archiveBuffer.readUInt32LE(cursor + 38);
    const entryEnd = cursor + 46 + fileNameLength + extraLength + commentLength;
    if (entryEnd > archiveBuffer.length) {
      throw new ReleaseError("size report archive has a truncated ZIP entry");
    }

    const rawPath = archiveBuffer
      .subarray(cursor + 46, cursor + 46 + fileNameLength)
      .toString(flags & 0x800 ? "utf8" : "latin1");
    const normalizedPath = normalizeSizePath(rawPath, { allowDirectory: true });
    if (
      normalizedPath === undefined ||
      isZipDirectory(versionMadeBy, externalAttributes, rawPath)
    ) {
      cursor = entryEnd;
      continue;
    }
    if (seenPaths.has(normalizedPath)) {
      throw new ReleaseError(`size report archive contains duplicate path: ${normalizedPath}`);
    }
    seenPaths.add(normalizedPath);
    if (isZipSymbolicLink(versionMadeBy, externalAttributes)) {
      ignored.push({ path: normalizedPath, reason: "symbolic-link" });
    } else {
      files.push({ path: normalizedPath, bytes: uncompressedSize, storedBytes: compressedSize });
    }
    cursor = entryEnd;
  }

  return { files, ignored };
}

function summarizeSizeReport({ inputType, files, ignored, inputBytes }) {
  const categories = Object.fromEntries(
    SIZE_REPORT_CATEGORIES.map((category) => [category, { bytes: 0, storedBytes: 0, files: 0 }]),
  );
  const sortedFiles = [...files].sort((left, right) => compareStrings(left.path, right.path));
  for (const file of sortedFiles) {
    const category = classifySizeReportPath(file.path);
    categories[category].bytes += file.bytes;
    categories[category].storedBytes += file.storedBytes;
    categories[category].files += 1;
  }

  const report = {
    schemaVersion: SIZE_REPORT_SCHEMA_VERSION,
    inputType,
    totalBytes: sortedFiles.reduce((total, file) => total + file.bytes, 0),
    totalStoredBytes: sortedFiles.reduce((total, file) => total + file.storedBytes, 0),
    categories,
    files: sortedFiles.map((file) => ({
      path: file.path,
      category: classifySizeReportPath(file.path),
      bytes: file.bytes,
      storedBytes: file.storedBytes,
    })),
    ignored: [...ignored].sort((left, right) => compareStrings(left.path, right.path)),
  };
  if (inputBytes !== undefined) report.inputBytes = inputBytes;
  return report;
}

export function createSizeReport(inputPath) {
  if (!nonEmptyString(inputPath)) {
    throw new ReleaseError("size report requires an explicit directory or ZIP archive path");
  }
  const resolvedInput = resolve(inputPath);
  if (!existsSync(resolvedInput)) {
    throw new ReleaseError(`size report input is missing at ${resolvedInput}`);
  }

  const inputDetails = lstatSync(resolvedInput);
  if (inputDetails.isDirectory()) {
    const ignored = [];
    const files = collectSizeDirectoryEntries(resolvedInput, "", ignored);
    return summarizeSizeReport({ inputType: "directory", files, ignored });
  }
  if (!inputDetails.isFile()) {
    throw new ReleaseError(`size report input is not a directory or archive: ${resolvedInput}`);
  }

  const archiveBuffer = readFileSync(resolvedInput);
  if (archiveBuffer.length < 4 || archiveBuffer.readUInt32LE(0) !== 0x04034b50) {
    throw new ReleaseError(`size report archive must be a ZIP file: ${resolvedInput}`);
  }
  const { files, ignored } = collectZipEntries(archiveBuffer);
  return summarizeSizeReport({
    inputType: "zip",
    files,
    ignored,
    inputBytes: inputDetails.size,
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024 || nextUnit === units.at(-1)) break;
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${unit} (${bytes} B)`;
}

export function serializeSizeReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatSizeReport(report) {
  const inputLabel = report.inputType === "zip" ? "ZIP archive" : "directory";
  const lines = [
    `Package size report (${inputLabel})`,
    `Logical bytes: ${formatBytes(report.totalBytes)}`,
  ];
  if (report.inputType === "zip") {
    lines.push(`Stored member bytes: ${formatBytes(report.totalStoredBytes)}`);
    lines.push(`Archive file bytes: ${formatBytes(report.inputBytes)}`);
  }
  lines.push("", "Categories:");
  for (const category of SIZE_REPORT_CATEGORIES) {
    const summary = report.categories[category];
    const fileLabel = summary.files === 1 ? "file" : "files";
    lines.push(
      `- ${SIZE_REPORT_CATEGORY_LABELS[category]}: ${formatBytes(summary.bytes)} (${summary.files} ${fileLabel})`,
    );
  }
  if (report.files.length > 0) {
    lines.push("", "Largest files:");
    const largestFiles = [...report.files]
      .sort((left, right) => right.bytes - left.bytes || compareStrings(left.path, right.path))
      .slice(0, 10);
    for (const file of largestFiles) {
      lines.push(`- ${formatBytes(file.bytes)} ${file.category}: ${file.path}`);
    }
  }
  if (report.ignored.length > 0) {
    lines.push("", `Ignored entries: ${report.ignored.length}`);
    for (const entry of report.ignored) lines.push(`- ${entry.reason}: ${entry.path}`);
  }
  return `${lines.join("\n")}\n`;
}

function collectArtifactFiles(directory, relativeDirectory = "") {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareStrings(left.name, right.name),
  );
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectArtifactFiles(absolutePath, relativePath));
    } else if (entry.isFile() && !isChecksumFile(entry.name)) {
      files.push({ absolutePath, relativePath: toPosixPath(relativePath) });
    }
  }
  return files;
}

export function collectArtifacts(artifactsDirectory) {
  if (artifactsDirectory === undefined || artifactsDirectory === null) return [];
  const directory = resolve(artifactsDirectory);
  if (!existsSync(directory))
    throw new ReleaseError(`artifacts directory is missing at ${directory}`);
  if (!lstatSync(directory).isDirectory()) {
    throw new ReleaseError(`artifacts path is not a directory: ${directory}`);
  }

  return collectArtifactFiles(directory)
    .sort((left, right) => compareStrings(left.relativePath, right.relativePath))
    .map(({ absolutePath, relativePath }) => {
      const bytes = statSync(absolutePath).size;
      return { path: relativePath, bytes, sha256: hashFile(absolutePath) };
    });
}

function packageManagerVersion(packageJson) {
  if (typeof packageJson?.packageManager !== "string") return undefined;
  const match = /^pnpm@([^+\s]+)$/.exec(packageJson.packageManager);
  return match?.[1];
}

export function detectPnpmVersion(fallbackPackageJson) {
  try {
    const version = execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (nonEmptyString(version)) return version;
  } catch {
    // A release can still be described when pnpm is not installed globally.
  }
  return packageManagerVersion(fallbackPackageJson);
}

export function detectRuntime({ nodeVersion = process.version, pnpmVersion } = {}, packageJson) {
  const runtime = { node: nodeVersion };
  const resolvedPnpmVersion = pnpmVersion ?? detectPnpmVersion(packageJson);
  if (nonEmptyString(resolvedPnpmVersion)) runtime.pnpm = resolvedPnpmVersion;
  return runtime;
}

function normalizeGeneratedAt(value) {
  if (!nonEmptyString(value))
    throw new ReleaseError("generatedAt must be a non-empty ISO timestamp");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()))
    throw new ReleaseError(`generatedAt is not a valid ISO timestamp: ${value}`);
  return parsed.toISOString();
}

function normalizeCommit(value) {
  if (!nonEmptyString(value)) throw new ReleaseError("commit must be a non-empty commit SHA");
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new ReleaseError("commit contains control characters");
  }
  return value;
}

export function createReleaseManifest({
  rootDirectory = findRepositoryRoot(),
  commit = "unknown",
  generatedAt = new Date().toISOString(),
  artifactsDirectory,
  runtime,
} = {}) {
  const checked = checkRelease(rootDirectory);
  const artifactDirectory =
    artifactsDirectory === undefined ? undefined : resolve(checked.rootDir, artifactsDirectory);
  const packages = checked.packages.map(({ path, name, version }) => ({
    path,
    ...(name === undefined ? {} : { name }),
    version,
  }));

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    project: checked.releaseMetadata.project,
    version: checked.version,
    tag: `v${checked.version}`,
    stage: checked.releaseMetadata.stage,
    channel: checked.releaseMetadata.channel,
    releaseName: checked.releaseMetadata.releaseName,
    stageIssue: checked.releaseMetadata.stageIssue,
    commit: normalizeCommit(commit),
    generatedAt: normalizeGeneratedAt(generatedAt),
    runtime: runtime ?? detectRuntime({}, checked.rootPackage),
    packages,
    artifactTargets: [...checked.releaseMetadata.artifactTargets],
    artifacts: collectArtifacts(artifactDirectory),
  };
}

export const buildManifest = createReleaseManifest;

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new TypeError("argv must be an array");
  const [command, ...argumentsList] = argv;
  if (command !== "check" && command !== "manifest" && command !== "size-report") {
    throw new ReleaseError(
      "usage: node scripts/release.mjs <check|manifest|size-report> [options]",
    );
  }

  const options = { command, dryRun: false, format: "json" };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const optionNames = new Map([
      ["--output", "output"],
      ["--commit", "commit"],
      ["--generated-at", "generatedAt"],
      ["--artifacts-dir", "artifactsDirectory"],
      ["--input", "inputPath"],
      ["--format", "format"],
    ]);
    const option = optionNames.get(argument);
    if (option === undefined) throw new ReleaseError(`unknown option: ${argument}`);
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ReleaseError(`${argument} requires a value`);
    }
    options[option] = value;
    index += 1;
  }

  if (command === "check" && options.dryRun) {
    throw new ReleaseError("--dry-run is only supported by the manifest command");
  }
  if (command === "manifest" && !options.dryRun && options.output === undefined) {
    throw new ReleaseError("manifest requires --output <path> unless --dry-run is used");
  }
  if (command !== "size-report" && options.format !== "json") {
    throw new ReleaseError("--format is only supported by the size-report command");
  }
  if (command === "size-report" && options.dryRun) {
    throw new ReleaseError("--dry-run is not supported by the size-report command");
  }
  if (command === "size-report" && options.inputPath === undefined) {
    throw new ReleaseError("size-report requires --input <directory-or-archive>");
  }
  if (command === "size-report" && options.format !== "json" && options.format !== "text") {
    throw new ReleaseError("size-report --format must be json or text");
  }
  return options;
}

function outputPath(rootDir, output) {
  return isAbsolute(output) ? output : resolve(rootDir, output);
}

export async function runCli(
  argv = process.argv.slice(2),
  { rootDirectory = findRepositoryRoot(), stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    const options = parseArgs(argv);
    if (options.command === "size-report") {
      const report = createSizeReport(resolve(rootDirectory, options.inputPath));
      const serialized =
        options.format === "text" ? formatSizeReport(report) : serializeSizeReport(report);
      if (options.output === undefined) {
        stdout.write(serialized);
      } else {
        const destination = outputPath(rootDirectory, options.output);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, serialized, "utf8");
        stdout.write(`size report: wrote ${destination}\n`);
      }
      return 0;
    }

    const checked = checkRelease(rootDirectory);
    if (options.command === "check") {
      stdout.write(
        `release check: ok (${checked.packages.length} packages, version ${checked.version})\n`,
      );
      return 0;
    }

    const manifest = createReleaseManifest({
      rootDirectory: checked.rootDir,
      commit: options.commit,
      generatedAt: options.generatedAt,
      artifactsDirectory: options.artifactsDirectory,
    });
    const serialized = serializeManifest(manifest);
    if (options.dryRun) {
      stdout.write(serialized);
      return 0;
    }

    const destination = outputPath(checked.rootDir, options.output);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, serialized, "utf8");
    stdout.write(`release manifest: wrote ${destination}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`release: ${message}\n`);
    return 1;
  }
}

export const main = runCli;

function isMainModule() {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && pathToFileURL(resolve(entryPoint)).href === import.meta.url;
}

if (isMainModule()) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}

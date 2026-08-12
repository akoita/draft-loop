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
const WORKSPACE_GROUPS = ["apps", "packages"];
const MANIFEST_SCHEMA_VERSION = 1;

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
  if (command !== "check" && command !== "manifest") {
    throw new ReleaseError("usage: node scripts/release.mjs <check|manifest> [options]");
  }

  const options = { command, dryRun: false };
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

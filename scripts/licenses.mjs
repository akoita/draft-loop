#!/usr/bin/env node

import console from "node:console";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

export const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "Unlicense",
  "Python-2.0",
  "BlueOak-1.0.0",
  "WTFPL",
]);

function requireFile(path, label) {
  let details;
  try {
    details = statSync(path);
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${path}`, { cause: error });
  }
  if (!details.isFile()) {
    throw new Error(`${label} is not a file: ${path}`);
  }
}

export function findWorkspaceManifests(root = rootDir) {
  const manifests = [];
  const rootManifestPath = join(root, "package.json");
  requireFile(rootManifestPath, "Root package manifest");
  manifests.push(rootManifestPath);

  for (const group of ["packages", "apps"]) {
    const groupDir = join(root, group);
    let entries;
    try {
      entries = readdirSync(groupDir, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Workspace group is missing or unreadable: ${groupDir}`, { cause: error });
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(groupDir, entry.name, "package.json");
      requireFile(pkgPath, `Workspace package manifest for ${group}/${entry.name}`);
      manifests.push(pkgPath);
    }
  }
  return manifests;
}

export function extractDirectDependencies(manifestPaths) {
  const dependencyNames = new Set();

  for (const manifestPath of manifestPaths) {
    let content;
    try {
      content = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`Package manifest is unreadable or invalid: ${manifestPath}`, {
        cause: error,
      });
    }
    if (typeof content !== "object" || content === null || Array.isArray(content)) {
      throw new Error(`Package manifest must contain a JSON object: ${manifestPath}`);
    }
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (content[field] && typeof content[field] === "object") {
        for (const dep of Object.keys(content[field])) {
          if (!dep.startsWith("@draft-loop/")) {
            dependencyNames.add(dep);
          }
        }
      } else if (content[field] !== undefined) {
        throw new Error(`Package manifest field ${field} must be an object: ${manifestPath}`);
      }
    }
  }
  return [...dependencyNames].sort();
}

function resolvePackageLicense(pkgName, root = rootDir) {
  const pkgPath = join(root, "node_modules", pkgName, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      name: pkgName,
      version: "unknown",
      license: "UNKNOWN",
      found: false,
      error: `Dependency package manifest was not found: ${pkgPath}`,
    };
  }
  try {
    const data = JSON.parse(readFileSync(pkgPath, "utf8"));
    let license = data.license;
    if (typeof license === "object" && license !== null && !Array.isArray(license)) {
      license = license.type;
    }
    return {
      name: pkgName,
      version: typeof data.version === "string" ? data.version : "unknown",
      license: typeof license === "string" ? license : "UNKNOWN",
      found: true,
    };
  } catch (error) {
    return {
      name: pkgName,
      version: "unknown",
      license: "UNKNOWN",
      found: false,
      error: `Dependency package manifest is unreadable or invalid: ${pkgPath} (${error instanceof Error ? error.message : "unknown error"})`,
    };
  }
}

function tokenizeLicenseExpression(expression) {
  const tokens = [];
  let offset = 0;
  while (offset < expression.length) {
    const remaining = expression.slice(offset);
    const whitespace = /^\s+/u.exec(remaining);
    if (whitespace !== null) {
      offset += whitespace[0].length;
      continue;
    }
    const character = expression[offset];
    if (character === "(" || character === ")") {
      tokens.push(character);
      offset += 1;
      continue;
    }
    const identifier = /^[^\s()]+/u.exec(remaining);
    if (identifier === null) return [];
    const value = identifier[0];
    const operator = value.toUpperCase();
    tokens.push(operator === "AND" || operator === "OR" || operator === "WITH" ? operator : value);
    offset += value.length;
  }
  return tokens;
}

export function isLicenseAllowed(licenseStr, allowed = ALLOWED_LICENSES) {
  if (typeof licenseStr !== "string" || licenseStr.trim() === "") return false;
  const tokens = tokenizeLicenseExpression(licenseStr);
  let index = 0;

  const parsePrimary = () => {
    const token = tokens[index];
    if (token === "(") {
      index += 1;
      const value = parseOr();
      if (tokens[index] !== ")") throw new Error("unclosed license expression");
      index += 1;
      return value;
    }
    if (token === undefined || token === ")" || token === "AND" || token === "OR") {
      throw new Error("invalid license expression");
    }
    index += 1;
    if (tokens[index] === "WITH") {
      const exception = tokens[index + 1];
      if (
        exception === undefined ||
        exception === "(" ||
        exception === ")" ||
        exception === "AND" ||
        exception === "OR" ||
        exception === "WITH"
      ) {
        throw new Error("invalid license exception expression");
      }
      index += 2;
      return allowed.has(`${token} WITH ${exception}`);
    }
    return allowed.has(token);
  };

  const parseAnd = () => {
    let value = parsePrimary();
    while (tokens[index] === "AND") {
      index += 1;
      value = parsePrimary() && value;
    }
    return value;
  };

  function parseOr() {
    let value = parseAnd();
    while (tokens[index] === "OR") {
      index += 1;
      value = parseAnd() || value;
    }
    return value;
  }

  try {
    const value = parseOr();
    return index === tokens.length && value;
  } catch {
    return false;
  }
}

export function auditLicenses(root = rootDir, allowed = ALLOWED_LICENSES) {
  const issues = [];
  const auditedDependencies = [];
  let directDeps;

  try {
    const manifests = findWorkspaceManifests(root);
    directDeps = extractDirectDependencies(manifests);
  } catch (error) {
    issues.push({
      package: "<workspace>",
      version: "unknown",
      license: "UNKNOWN",
      reason: error instanceof Error ? error.message : "Workspace dependency discovery failed.",
    });
    return { valid: false, auditedDependencies, issues };
  }

  for (const dep of directDeps) {
    const info = resolvePackageLicense(dep, root);
    auditedDependencies.push(info);

    if (!info.found) {
      issues.push({
        package: dep,
        version: info.version,
        license: info.license,
        reason: info.error ?? "Dependency package could not be resolved.",
      });
    } else if (!isLicenseAllowed(info.license, allowed)) {
      issues.push({
        package: dep,
        version: info.version,
        license: info.license,
        reason: `Disallowed license expression: ${info.license}`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    auditedDependencies,
    issues,
  };
}

if (process.argv[1] === __filename) {
  const result = auditLicenses();
  console.log(
    `Audited ${result.auditedDependencies.length} direct dependencies for license compliance.`,
  );
  if (!result.valid) {
    console.error("License compliance check failed:");
    for (const issue of result.issues) {
      console.error(`- ${issue.package}@${issue.version}: ${issue.reason}`);
    }
    process.exit(1);
  }
  console.log("All dependencies comply with approved permissive license policies.");
}

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

export function findWorkspaceManifests(root = rootDir) {
  const manifests = [];
  const rootManifestPath = join(root, "package.json");
  if (existsSync(rootManifestPath)) {
    manifests.push(rootManifestPath);
  }

  for (const group of ["packages", "apps"]) {
    const groupDir = join(root, group);
    try {
      const entries = readdirSync(groupDir);
      for (const entry of entries) {
        const entryPath = join(groupDir, entry);
        if (statSync(entryPath).isDirectory()) {
          const pkgPath = join(entryPath, "package.json");
          if (existsSync(pkgPath) && statSync(pkgPath).isFile()) {
            manifests.push(pkgPath);
          }
        }
      }
    } catch {
      // Ignored
    }
  }
  return manifests;
}

export function extractDirectDependencies(manifestPaths) {
  const dependencyNames = new Set();

  for (const manifestPath of manifestPaths) {
    try {
      const content = JSON.parse(readFileSync(manifestPath, "utf8"));
      for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
        if (content[field] && typeof content[field] === "object") {
          for (const dep of Object.keys(content[field])) {
            if (!dep.startsWith("@draft-loop/")) {
              dependencyNames.add(dep);
            }
          }
        }
      }
    } catch {
      // Ignored
    }
  }
  return [...dependencyNames].sort();
}

function resolvePackageLicense(pkgName, root = rootDir) {
  const possiblePaths = [join(root, "node_modules", pkgName, "package.json")];

  for (const pkgPath of possiblePaths) {
    if (existsSync(pkgPath)) {
      try {
        const data = JSON.parse(readFileSync(pkgPath, "utf8"));
        let license = data.license;
        if (typeof license === "object" && license !== null) {
          license = license.type;
        }
        return {
          name: pkgName,
          version: data.version,
          license: license ?? "UNKNOWN",
          found: true,
        };
      } catch {
        // Ignored
      }
    }
  }
  return { name: pkgName, version: "unknown", license: "UNKNOWN", found: false };
}

function isLicenseAllowed(licenseStr, allowed = ALLOWED_LICENSES) {
  if (!licenseStr) return false;
  // Handle compound expressions like "(MIT OR Apache-2.0)" or "MIT AND Apache-2.0"
  const clean = licenseStr.replace(/[()]/g, "").trim();
  const parts = clean.split(/\s+(?:OR|AND)\s+/i);
  return parts.some((part) => allowed.has(part.trim()));
}

export function auditLicenses(root = rootDir, allowed = ALLOWED_LICENSES) {
  const manifests = findWorkspaceManifests(root);
  const directDeps = extractDirectDependencies(manifests);
  const issues = [];
  const auditedDependencies = [];

  for (const dep of directDeps) {
    const info = resolvePackageLicense(dep, root);
    auditedDependencies.push(info);

    if (info.found && !isLicenseAllowed(info.license, allowed)) {
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

#!/usr/bin/env node

// Dependency advisory gate. A high or critical advisory in a production dependency fails, unless
// `.audit-accept.json` accepts it with a reason and an expiry date that has not passed. The same
// advisory in a development-only dependency only warns.

import { execFileSync } from "node:child_process";
import console from "node:console";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ACCEPT_FILE = ".audit-accept.json";
const BLOCKING = new Set(["high", "critical"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Reads the advisories of one `pnpm audit --json` report as { id, severity, module, title, url }. */
export function advisoriesOf(report) {
  return Object.values(report?.advisories ?? {}).map((advisory) => ({
    id: advisory.github_advisory_id ?? String(advisory.id),
    severity: advisory.severity,
    module: advisory.module_name,
    title: advisory.title,
    url: advisory.url,
  }));
}

/** Validates the accept list; returns the entries and any problems with the file itself. */
export function parseAcceptList(value) {
  const problems = [];
  if (!Array.isArray(value)) {
    return { entries: [], problems: [`${ACCEPT_FILE} must hold a JSON array.`] };
  }
  const entries = [];
  for (const [index, entry] of value.entries()) {
    const where = `${ACCEPT_FILE} entry ${index + 1}`;
    if (typeof entry?.id !== "string" || entry.id.trim() === "") {
      problems.push(`${where}: "id" must name the advisory, such as GHSA-xxxx-xxxx-xxxx.`);
      continue;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) {
      problems.push(`${where} (${entry.id}): "reason" must say why the advisory is accepted.`);
      continue;
    }
    if (typeof entry.expires !== "string" || !DATE.test(entry.expires)) {
      problems.push(`${where} (${entry.id}): "expires" must be a date such as 2026-12-31.`);
      continue;
    }
    entries.push({ id: entry.id, reason: entry.reason, expires: entry.expires });
  }
  return { entries, problems };
}

/**
 * Decides the gate. `prodReport` is `pnpm audit --prod --json`, `fullReport` is `pnpm audit
 * --json`; `today` is YYYY-MM-DD. An advisory in the full report but not the production one is
 * development-only.
 */
export function evaluateAudit({ prodReport, fullReport, accepted, today }) {
  const acceptedById = new Map(accepted.map((entry) => [entry.id, entry]));
  const prod = advisoriesOf(prodReport).filter((a) => BLOCKING.has(a.severity));
  const prodIds = new Set(prod.map((a) => a.id));
  const failures = [];
  const acceptedNow = [];
  for (const advisory of prod) {
    const entry = acceptedById.get(advisory.id);
    if (!entry) {
      failures.push({ ...advisory, why: "not accepted" });
    } else if (entry.expires < today) {
      failures.push({ ...advisory, why: `acceptance expired on ${entry.expires}` });
    } else {
      acceptedNow.push({ ...advisory, reason: entry.reason, expires: entry.expires });
    }
  }
  const warnings = advisoriesOf(fullReport).filter(
    (a) => BLOCKING.has(a.severity) && !prodIds.has(a.id),
  );
  const seen = new Set(advisoriesOf(fullReport).map((a) => a.id));
  const stale = accepted.filter((entry) => !prodIds.has(entry.id) && !seen.has(entry.id));
  return { passed: failures.length === 0, failures, accepted: acceptedNow, warnings, stale };
}

function runAudit(args) {
  try {
    return JSON.parse(
      execFileSync("pnpm", ["audit", "--json", ...args], {
        cwd: rootDir,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    // pnpm audit exits non-zero when it finds advisories; its report is still on stdout.
    if (typeof error.stdout === "string" && error.stdout.trim().startsWith("{")) {
      return JSON.parse(error.stdout);
    }
    throw error;
  }
}

function main() {
  const path = join(rootDir, ACCEPT_FILE);
  const { entries, problems } = parseAcceptList(
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [],
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  const result = evaluateAudit({
    prodReport: runAudit(["--prod"]),
    fullReport: runAudit([]),
    accepted: entries,
    today: new Date().toISOString().slice(0, 10),
  });
  for (const a of result.warnings) {
    console.warn(`warning: ${a.severity} ${a.id} in ${a.module} (development only): ${a.title}`);
  }
  for (const a of result.accepted) {
    console.log(`accepted until ${a.expires}: ${a.severity} ${a.id} in ${a.module}: ${a.reason}`);
  }
  for (const entry of result.stale) {
    console.warn(
      `warning: ${ACCEPT_FILE} accepts ${entry.id}, which no longer appears; remove it.`,
    );
  }
  if (!result.passed) {
    for (const a of result.failures) {
      console.error(`${a.severity} ${a.id} in ${a.module} (${a.why}): ${a.title} ${a.url ?? ""}`);
    }
    console.error(
      `Upgrade the dependency, or accept the advisory in ${ACCEPT_FILE} with a reason and an expiry date (SECURITY.md).`,
    );
    process.exit(1);
  }
  console.log("Dependency audit passed: no unaccepted high or critical production advisory.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

#!/usr/bin/env node

// Fails CI when a CodeQL SARIF file holds a blocking result: an error-level result, or a
// security result rated high or critical (security-severity 7.0 or more).
import console from "node:console";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const BLOCKING_SECURITY_SEVERITY = 7;

function ruleFor(run, result) {
  const rules = run.tool?.driver?.rules ?? [];
  if (typeof result.ruleIndex === "number" && rules[result.ruleIndex]) {
    return rules[result.ruleIndex];
  }
  return rules.find((rule) => rule.id === result.ruleId);
}

export function blockingResults(sarif) {
  const blocking = [];
  for (const run of sarif.runs ?? []) {
    for (const result of run.results ?? []) {
      if (result.suppressions?.length) continue;
      const rule = ruleFor(run, result);
      const level = result.level ?? rule?.defaultConfiguration?.level ?? "warning";
      const severity = Number(rule?.properties?.["security-severity"] ?? 0);
      if (level === "error" || severity >= BLOCKING_SECURITY_SEVERITY) {
        const location = result.locations?.[0]?.physicalLocation;
        blocking.push({
          ruleId: result.ruleId ?? rule?.id ?? "unknown",
          message: result.message?.text ?? "",
          file: location?.artifactLocation?.uri ?? "unknown",
          line: location?.region?.startLine ?? 0,
        });
      }
    }
  }
  return blocking;
}

function main(directory) {
  const files = readdirSync(directory).filter((name) => name.endsWith(".sarif"));
  if (files.length === 0) {
    console.error(`No SARIF file found in ${directory}.`);
    return 1;
  }
  const blocking = files.flatMap((name) =>
    blockingResults(JSON.parse(readFileSync(join(directory, name), "utf8"))),
  );
  for (const result of blocking) {
    console.log(
      `::error file=${result.file},line=${result.line}::${result.ruleId}: ${result.message}`,
    );
  }
  console.log(`${blocking.length} blocking CodeQL result(s) in ${files.length} SARIF file(s).`);
  return blocking.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv[2] ?? "codeql-results");
}

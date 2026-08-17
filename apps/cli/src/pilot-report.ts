import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { type ConsentedPilotCase, runConsentedPilotHarness } from "@draft-loop/evaluations";

/** A user-correctable problem. Never carries case-file content. */
export class PilotReportUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PilotReportUserError";
  }
}

export interface PilotReportIo {
  write(message: string): void;
}

export interface PilotReportOptions {
  /** Absolute path to the private case file. Must live outside any repository. */
  readonly casePath: string;
  /** Where the sanitized Markdown summary is written. */
  readonly outputPath: string;
}

/**
 * Whether `.git` is present, as either a directory or a file.
 *
 * A plain clone has a `.git` directory, but a linked worktree and a submodule
 * both have a `.git` *file* pointing elsewhere. Testing only for a directory
 * silently fails to detect a repository in exactly the layouts agents use
 * most, so this checks for existence rather than type.
 */
async function hasGitEntry(directory: string): Promise<boolean> {
  try {
    await stat(join(directory, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the repository root containing `path`, walking upward, or undefined.
 *
 * The pilot protocol requires candidate files to stay outside the repository.
 * A private case file carries drafts and a manual baseline, so committing one
 * by accident is precisely the failure the protocol exists to prevent. This is
 * the check that makes that instruction enforceable rather than advisory.
 */
export async function enclosingRepository(path: string): Promise<string | undefined> {
  let current = dirname(resolve(path));
  for (;;) {
    if (await hasGitEntry(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Parses the private case file.
 *
 * Structural checks only: the harness owns consent, outcome, and sanitization
 * validation, and its messages are better than anything repeated here. Errors
 * never quote the file, because it holds candidate material.
 */
export function parsePilotCases(raw: string): readonly ConsentedPilotCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PilotReportUserError("The private case file is not valid JSON.");
  }
  const cases =
    Array.isArray(parsed) || typeof parsed !== "object" || parsed === null || !("cases" in parsed)
      ? parsed
      : (parsed as { readonly cases: unknown }).cases;
  if (!Array.isArray(cases)) {
    throw new PilotReportUserError(
      "The private case file must be an array of consented cases, or an object with a cases array.",
    );
  }
  if (cases.length === 0) {
    throw new PilotReportUserError("The private case file contains no cases.");
  }
  for (const entry of cases) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new PilotReportUserError("Every consented case must be an object.");
    }
    if (!("consent" in entry)) {
      throw new PilotReportUserError(
        "Every consented case must carry a consent record. See docs/pilot-protocol.md.",
      );
    }
  }
  return cases as readonly ConsentedPilotCase[];
}

/**
 * Runs the consented pilot harness and writes only its sanitized Markdown.
 *
 * Nothing from the case file reaches the output: the harness returns bounded
 * measures and the report is generated from those, so candidate content has
 * nowhere to travel.
 */
export async function generateSanitizedPilotReport(
  options: PilotReportOptions,
  io: PilotReportIo = { write: (message) => process.stdout.write(message) },
): Promise<string> {
  const casePath = resolve(options.casePath);
  const repository = await enclosingRepository(casePath);
  if (repository !== undefined) {
    throw new PilotReportUserError(
      `The private case file is inside the repository at ${repository}. ` +
        "Move it outside any repository before generating a report; it holds candidate material.",
    );
  }

  let raw: string;
  try {
    raw = await readFile(casePath, "utf8");
  } catch {
    throw new PilotReportUserError("The private case file could not be read.");
  }

  const cases = parsePilotCases(raw);
  const report = runConsentedPilotHarness(cases, { requireOutcome: true });
  const outputPath = resolve(options.outputPath);
  await writeFile(outputPath, `${report.markdownReport.trimEnd()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  io.write(
    `Wrote a sanitized pilot summary for ${report.caseCount} consented case(s) to ${outputPath}\n`,
  );
  io.write(`Outcome validation: ${report.outcomeValidation}\n`);
  return outputPath;
}

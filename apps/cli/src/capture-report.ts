import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CliUserError,
  type RejectedAuthorCaptureSummary,
  RejectedAuthorCaptureSummaryInputError,
  summarizeRejectedAuthorCaptures,
} from "@draft-loop/application";

import { enclosingRepository } from "./pilot-report.js";

const captureDirectoryPattern = /^rejected-author-/u;

/** A user-correctable problem. Never carries capture content. */
export class CaptureReportUserError extends CliUserError {
  constructor(message: string) {
    super(message);
    this.name = "CaptureReportUserError";
  }
}

export interface CaptureReportIo {
  write(message: string): void;
}

function capturedAt(capture: unknown): string {
  if (typeof capture !== "object" || capture === null) return "";
  const value = (capture as { readonly capturedAt?: unknown }).capturedAt;
  return typeof value === "string" ? value : "";
}

async function readCaptures(directory: string): Promise<readonly unknown[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new CaptureReportUserError("The private capture directory could not be read.");
  }

  const captures: unknown[] = [];
  const names = entries
    .filter((entry) => entry.isDirectory() && captureDirectoryPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    let raw: string;
    try {
      raw = await readFile(join(directory, name, "replay.json"), "utf8");
    } catch {
      throw new CaptureReportUserError("A rejected-author capture could not be read.");
    }
    try {
      captures.push(JSON.parse(raw));
    } catch {
      throw new CaptureReportUserError("A rejected-author capture is not valid JSON.");
    }
  }
  // Stable sort: equal or missing timestamps keep directory-name order.
  return captures.sort((left, right) => {
    const leftAt = capturedAt(left);
    const rightAt = capturedAt(right);
    return leftAt < rightAt ? -1 : leftAt > rightAt ? 1 : 0;
  });
}

/**
 * Prints a content-free summary of the rejected-author captures in a private
 * directory. The directory must sit outside any repository because captures
 * hold candidate material. Nothing is written to disk, and only counts, safe
 * issue codes, and sanitized section kinds reach stdout.
 */
export async function printRejectedAuthorCaptureReport(
  directory: string,
  io: CaptureReportIo = { write: (message) => process.stdout.write(message) },
): Promise<RejectedAuthorCaptureSummary> {
  const captureDirectory = resolve(directory);
  const repository = await enclosingRepository(join(captureDirectory, "replay.json"));
  if (repository !== undefined) {
    throw new CaptureReportUserError(
      `The private capture directory is inside the repository at ${repository}. ` +
        "Move it outside any repository before summarizing it; captures hold candidate material.",
    );
  }

  const captures = await readCaptures(captureDirectory);
  if (captures.length === 0) {
    throw new CaptureReportUserError(
      "The private capture directory contains no rejected-author-* captures.",
    );
  }

  let summary: RejectedAuthorCaptureSummary;
  try {
    summary = summarizeRejectedAuthorCaptures(captures);
  } catch (error) {
    if (error instanceof RejectedAuthorCaptureSummaryInputError) {
      throw new CaptureReportUserError(
        "A rejected-author capture does not match the replay capture format.",
      );
    }
    throw error;
  }
  io.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

export const maximumLocalClaudeSubtypeBytes = 128;
export const maximumLocalClaudeTerminalReasonBytes = 128;

const categoryTokenPattern = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/u;

export type LocalClaudeCategoryCaptureOutcome = "not-needed" | "saved" | "failed";

export interface LocalClaudeCategoryCaptureInput {
  readonly captureParent: string;
  readonly subtype: unknown;
  readonly terminalReason: unknown;
  readonly knownSubtypes: ReadonlySet<string>;
  readonly knownTerminalReasons: ReadonlySet<string>;
}

interface SelectedCategory {
  readonly value?: string;
  readonly oversized: boolean;
}

function selectUnknownCategory(
  value: unknown,
  knownValues: ReadonlySet<string>,
  maximumBytes: number,
): SelectedCategory {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    knownValues.has(value) ||
    !categoryTokenPattern.test(value)
  ) {
    return { oversized: false };
  }
  if (Buffer.byteLength(value, "utf8") > maximumBytes) return { oversized: true };
  return { value, oversized: false };
}

export async function captureUnknownClaudeCategories(
  input: LocalClaudeCategoryCaptureInput,
): Promise<LocalClaudeCategoryCaptureOutcome> {
  const subtype = selectUnknownCategory(
    input.subtype,
    input.knownSubtypes,
    maximumLocalClaudeSubtypeBytes,
  );
  const terminalReason = selectUnknownCategory(
    input.terminalReason,
    input.knownTerminalReasons,
    maximumLocalClaudeTerminalReasonBytes,
  );
  const capturedValues = {
    ...(subtype.value === undefined ? {} : { subtype: subtype.value }),
    ...(terminalReason.value === undefined ? {} : { terminal_reason: terminalReason.value }),
  };
  if (subtype.oversized || terminalReason.oversized) return "failed";
  if (Object.keys(capturedValues).length === 0) {
    return "not-needed";
  }

  let createdDirectory: string | undefined;
  try {
    const parentInfo = await lstat(input.captureParent);
    if (!parentInfo.isDirectory()) return "failed";
    const parent = await realpath(input.captureParent);
    const directory = join(parent, `claude-category-${randomUUID()}`);
    await mkdir(directory, { mode: 0o700 });
    createdDirectory = directory;
    await chmod(directory, 0o700);

    const filePath = join(directory, "categories.json");
    const file = await open(filePath, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(capturedValues), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await chmod(filePath, 0o600);
    return "saved";
  } catch {
    if (createdDirectory !== undefined) {
      try {
        await rm(createdDirectory, { recursive: true, force: true });
      } catch {
        // Keep the capture failure content-free even if cleanup also fails.
      }
    }
    return "failed";
  }
}

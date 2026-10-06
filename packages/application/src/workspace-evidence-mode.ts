import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { CliUserError } from "./cli-user-error.js";

/**
 * The workspace evidence mode decides what candidate material a run's author and critic receive.
 * `retrieval` (the default) sends the composed top excerpts; `full-source` sends every eligible
 * chunk of the selected sources when they fit the mode's budget. The setting lives beside
 * `workspace.json` and is read once when a run starts or resumes.
 */
export const evidenceModes = ["retrieval", "full-source"] as const;
export type EvidenceMode = (typeof evidenceModes)[number];

export const defaultEvidenceMode: EvidenceMode = "retrieval";

const evidenceModeFilename = "evidence-mode.json";
const evidenceModeDirectory = ".draft-loop";

export const evidenceModeInvalidMessage =
  "The workspace evidence mode file is invalid. Set it again with `evidence mode <workspace> retrieval` or `full-source`.";

const evidenceModeFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(evidenceModes),
  updatedAt: z.iso.datetime(),
});

export interface WorkspaceEvidenceModeRecord {
  readonly mode: EvidenceMode;
  /** Absent while the default applies because no setting was ever saved. */
  readonly updatedAt?: string;
}

function evidenceModePath(root: string): string {
  return join(root, evidenceModeDirectory, evidenceModeFilename);
}

/** A missing file means the default; any unreadable or unrecognized content fails closed. */
export async function readWorkspaceEvidenceMode(
  root: string,
): Promise<WorkspaceEvidenceModeRecord> {
  let content: string;
  try {
    content = await readFile(evidenceModePath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mode: defaultEvidenceMode };
    throw new CliUserError(evidenceModeInvalidMessage);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CliUserError(evidenceModeInvalidMessage);
  }
  const result = evidenceModeFileSchema.safeParse(parsed);
  if (!result.success) throw new CliUserError(evidenceModeInvalidMessage);
  return { mode: result.data.mode, updatedAt: result.data.updatedAt };
}

export async function writeWorkspaceEvidenceMode(
  root: string,
  mode: EvidenceMode,
  now: () => Date = () => new Date(),
): Promise<WorkspaceEvidenceModeRecord> {
  const updatedAt = now().toISOString();
  const path = evidenceModePath(root);
  await mkdir(join(root, evidenceModeDirectory), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ schemaVersion: 1, mode, updatedAt }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, path);
  return { mode, updatedAt };
}

export function parseEvidenceMode(value: string): EvidenceMode {
  const mode = evidenceModes.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw new CliUserError(`The evidence mode must be one of: ${evidenceModes.join(", ")}.`);
  }
  return mode;
}

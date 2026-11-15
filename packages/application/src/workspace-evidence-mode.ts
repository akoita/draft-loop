import { z } from "zod";

import { CliUserError } from "./cli-user-error.js";
import { workspaceSettings } from "./workspace-settings.js";

/**
 * The workspace evidence mode decides what candidate material a run's author and critic receive.
 * `full-source` (the default) sends every eligible chunk of the selected sources when they fit the
 * mode's budget; `retrieval` sends the composed top excerpts. The setting lives beside
 * `workspace.json` and is read once when a run starts or resumes.
 *
 * `maxEvidenceTokens` optionally caps full-source evidence by cost (#2666): above it the run uses
 * retrieval even when the evidence would fit the models' context windows. No cap is the default.
 */
export const evidenceModes = ["retrieval", "full-source"] as const;
export type EvidenceMode = (typeof evidenceModes)[number];

export const defaultEvidenceMode: EvidenceMode = "full-source";

export const evidenceModeInvalidMessage =
  "The workspace evidence mode file is invalid. Set it again with `evidence mode <workspace> retrieval` or `full-source`.";

/** Bounds of the optional cost cap, in estimated tokens of serialized evidence. */
export const minimumMaxEvidenceTokens = 1_000;
export const maximumMaxEvidenceTokens = 1_000_000;

const maxEvidenceTokensSchema = z
  .number()
  .int()
  .min(minimumMaxEvidenceTokens)
  .max(maximumMaxEvidenceTokens);

const evidenceModeFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(evidenceModes),
  maxEvidenceTokens: maxEvidenceTokensSchema.optional(),
  updatedAt: z.iso.datetime(),
});

export interface WorkspaceEvidenceModeRecord {
  readonly mode: EvidenceMode;
  /** Cost cap on full-source evidence; absent means only the context-window budget applies. */
  readonly maxEvidenceTokens?: number;
  /** Absent while the default applies because no setting was ever saved. */
  readonly updatedAt?: string;
}

/** A missing file means the default; any unreadable or unrecognized content fails closed. */
export async function readWorkspaceEvidenceMode(
  root: string,
): Promise<WorkspaceEvidenceModeRecord> {
  let content: string | undefined;
  try {
    content = await workspaceSettings().read(root, "evidence-mode.json");
  } catch {
    throw new CliUserError(evidenceModeInvalidMessage);
  }
  if (content === undefined) return { mode: defaultEvidenceMode };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CliUserError(evidenceModeInvalidMessage);
  }
  const result = evidenceModeFileSchema.safeParse(parsed);
  if (!result.success) throw new CliUserError(evidenceModeInvalidMessage);
  const { mode, maxEvidenceTokens, updatedAt } = result.data;
  return { mode, ...(maxEvidenceTokens === undefined ? {} : { maxEvidenceTokens }), updatedAt };
}

/** Saving a mode without a cap clears any cap saved before. */
export async function writeWorkspaceEvidenceMode(
  root: string,
  mode: EvidenceMode,
  now: () => Date = () => new Date(),
  maxEvidenceTokens?: number,
): Promise<WorkspaceEvidenceModeRecord> {
  if (
    maxEvidenceTokens !== undefined &&
    !maxEvidenceTokensSchema.safeParse(maxEvidenceTokens).success
  ) {
    throw new CliUserError(maxEvidenceTokensMessage);
  }
  const updatedAt = now().toISOString();
  const cap = maxEvidenceTokens === undefined ? {} : { maxEvidenceTokens };
  await workspaceSettings().write(
    root,
    "evidence-mode.json",
    `${JSON.stringify({ schemaVersion: 1, mode, ...cap, updatedAt }, null, 2)}\n`,
  );
  return { mode, ...cap, updatedAt };
}

const maxEvidenceTokensMessage = `The evidence token cap must be a whole number from ${minimumMaxEvidenceTokens} through ${maximumMaxEvidenceTokens}.`;

/** Parse the CLI's cap option; the range is the one the settings file accepts. */
export function parseMaxEvidenceTokens(value: string): number {
  const tokens = /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  if (!maxEvidenceTokensSchema.safeParse(tokens).success) {
    throw new CliUserError(maxEvidenceTokensMessage);
  }
  return tokens;
}

export function parseEvidenceMode(value: string): EvidenceMode {
  const mode = evidenceModes.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw new CliUserError(`The evidence mode must be one of: ${evidenceModes.join(", ")}.`);
  }
  return mode;
}

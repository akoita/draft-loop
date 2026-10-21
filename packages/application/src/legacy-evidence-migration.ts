import { z } from "zod";

import { CliUserError } from "./cli-user-error.js";
import { workspaceSettings } from "./workspace-settings.js";

/**
 * The line every run prints when it reads the legacy workspace `evidence` folder because the
 * workspace has no candidate knowledge base selected.
 */
export const legacyEvidencePreflightLine =
  "Career evidence: legacy workspace evidence (no knowledge base selected)";

/**
 * A workspace with legacy evidence and no knowledge base is offered a one-time import. Declining
 * is remembered here so the offer is not repeated and the workspace keeps the legacy path.
 */
export const legacyEvidenceMigrationInvalidMessage =
  "The legacy evidence migration setting is invalid. Delete .draft-loop/legacy-evidence-migration.json to be offered the import again.";

const decisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  decision: z.literal("declined"),
  decidedAt: z.iso.datetime(),
});

export interface LegacyEvidenceMigrationRecord {
  readonly declined: boolean;
  /** Absent until the person declines. */
  readonly decidedAt?: string;
}

/** A missing file means no decision; unreadable or unrecognized content fails closed. */
export async function readLegacyEvidenceMigration(
  root: string,
): Promise<LegacyEvidenceMigrationRecord> {
  let content: string | undefined;
  try {
    content = await workspaceSettings().read(root, "legacy-evidence-migration.json");
  } catch {
    throw new CliUserError(legacyEvidenceMigrationInvalidMessage);
  }
  if (content === undefined) return { declined: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CliUserError(legacyEvidenceMigrationInvalidMessage);
  }
  const result = decisionSchema.safeParse(parsed);
  if (!result.success) throw new CliUserError(legacyEvidenceMigrationInvalidMessage);
  return { declined: true, decidedAt: result.data.decidedAt };
}

export async function declineLegacyEvidenceMigration(
  root: string,
  now: () => Date = () => new Date(),
): Promise<LegacyEvidenceMigrationRecord> {
  const decidedAt = now().toISOString();
  await workspaceSettings().write(
    root,
    "legacy-evidence-migration.json",
    `${JSON.stringify({ schemaVersion: 1, decision: "declined", decidedAt }, null, 2)}\n`,
  );
  return { declined: true, decidedAt };
}

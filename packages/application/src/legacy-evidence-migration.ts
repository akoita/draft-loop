import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { CliUserError } from "./cli-user-error.js";

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
const decisionFilename = "legacy-evidence-migration.json";
const decisionDirectory = ".draft-loop";

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

function decisionPath(root: string): string {
  return join(root, decisionDirectory, decisionFilename);
}

/** A missing file means no decision; unreadable or unrecognized content fails closed. */
export async function readLegacyEvidenceMigration(
  root: string,
): Promise<LegacyEvidenceMigrationRecord> {
  let content: string;
  try {
    content = await readFile(decisionPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { declined: false };
    throw new CliUserError(legacyEvidenceMigrationInvalidMessage);
  }
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
  const path = decisionPath(root);
  await mkdir(join(root, decisionDirectory), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ schemaVersion: 1, decision: "declined", decidedAt }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, path);
  return { declined: true, decidedAt };
}

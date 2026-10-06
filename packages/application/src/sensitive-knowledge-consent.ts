import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceSensitivityTier } from "@draft-loop/domain/source-sensitivity";

import { CliUserError } from "./cli-user-error.js";

/**
 * Workspace consent to send `sensitive` knowledge-source sections to providers.
 *
 * The consent lives in its own managed file beside `workspace.json`, so the workspace
 * configuration parser is unaffected. `never-share` sections are never sent whatever the consent
 * says. Everything fails closed: a missing file means no consent, and a file that cannot be read
 * back strictly is an error that stops the caller before any provider request.
 */

const consentDirectory = ".draft-loop";
export const sensitiveKnowledgeConsentFilename = "sensitive-knowledge-consent.json";
const workspaceConfigFilename = "workspace.json";

export const sensitiveKnowledgeConsentInvalidMessage =
  "The sensitive-knowledge consent file is unreadable or invalid, so nothing was sent. Run `draft-loop knowledge sensitivity consent <workspace> --deny` to reset it.";

export interface SensitiveKnowledgeConsent {
  /** True only after an explicit allow; absent consent is false. */
  readonly allowSensitive: boolean;
  /** When the consent was last written; null when it has never been set. */
  readonly updatedAt: string | null;
}

/** Tiers withheld from provider requests: never-share always, sensitive unless consented. */
export function excludedSensitivityTiersForConsent(
  allowSensitive: boolean,
): ReadonlySet<SourceSensitivityTier> {
  return new Set<SourceSensitivityTier>(
    allowSensitive ? ["never-share"] : ["never-share", "sensitive"],
  );
}

function consentPath(root: string): string {
  return join(root, consentDirectory, sensitiveKnowledgeConsentFilename);
}

function parseConsent(content: string): SensitiveKnowledgeConsent {
  const value: unknown = JSON.parse(content);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("not an object");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "allowSensitive,schemaVersion,updatedAt") throw new Error("unknown keys");
  if (record.schemaVersion !== 1) throw new Error("unsupported version");
  if (typeof record.allowSensitive !== "boolean") throw new Error("invalid flag");
  const updatedAt = record.updatedAt;
  if (
    typeof updatedAt !== "string" ||
    Number.isNaN(Date.parse(updatedAt)) ||
    new Date(updatedAt).toISOString() !== updatedAt
  ) {
    throw new Error("invalid timestamp");
  }
  return { allowSensitive: record.allowSensitive, updatedAt };
}

/** Missing file: no consent. Present but invalid: a CliUserError, never an implicit allow. */
export async function readSensitiveKnowledgeConsent(
  rootInput: string,
): Promise<SensitiveKnowledgeConsent> {
  let content: string;
  try {
    content = await readFile(consentPath(rootInput), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { allowSensitive: false, updatedAt: null };
    }
    throw new CliUserError(sensitiveKnowledgeConsentInvalidMessage);
  }
  try {
    return parseConsent(content);
  } catch {
    throw new CliUserError(sensitiveKnowledgeConsentInvalidMessage);
  }
}

/** Write the consent atomically (temporary file, then rename) in an existing workspace. */
export async function setSensitiveKnowledgeConsent(
  rootInput: string,
  allowSensitive: boolean,
  now: () => string = () => new Date().toISOString(),
): Promise<SensitiveKnowledgeConsent> {
  if (typeof allowSensitive !== "boolean") {
    throw new CliUserError("Sensitive-knowledge consent must be explicitly allowed or denied.");
  }
  try {
    await readFile(join(rootInput, consentDirectory, workspaceConfigFilename));
  } catch {
    throw new CliUserError(
      `No DraftLoop workspace found at ${rootInput}. Run draft-loop init first.`,
    );
  }
  const consent: SensitiveKnowledgeConsent = { allowSensitive, updatedAt: now() };
  parseConsent(JSON.stringify({ schemaVersion: 1, ...consent }));
  const target = consentPath(rootInput);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(join(rootInput, consentDirectory), { recursive: true });
  try {
    await writeFile(
      temporary,
      `${JSON.stringify({ schemaVersion: 1, ...consent }, null, 2)}\n`,
      "utf8",
    );
    await rename(temporary, target);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new CliUserError("The sensitive-knowledge consent could not be saved.");
  }
  return consent;
}

/** The tiers to withhold for a workspace; throws before any send when the consent is invalid. */
export async function excludedSensitivityTiersForWorkspace(
  rootInput: string,
): Promise<ReadonlySet<SourceSensitivityTier>> {
  return excludedSensitivityTiersForConsent(
    (await readSensitiveKnowledgeConsent(rootInput)).allowSensitive,
  );
}

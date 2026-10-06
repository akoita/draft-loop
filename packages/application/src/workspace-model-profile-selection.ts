import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

import { CliUserError } from "./cli-user-error.js";
import type { ModelProfileReferences } from "./index.js";
import { readWorkspace } from "./local.js";
import { defaultModelProfileRegistry, type ModelProfileRegistry } from "./model-profiles.js";

/**
 * The applied author and critic profile pair of a workspace. New runs that name no profiles use it,
 * so an applied preset survives restarts. It lives beside `workspace.json`; a missing file means no
 * pair is applied, and a file that cannot be read back strictly stops the caller (fail closed).
 * Exact ids and versions are stored; each run still records its own snapshot of the profiles.
 */
const selectionDirectory = ".draft-loop";
export const workspaceModelProfileSelectionFilename = "model-profile-selection.json";

export const workspaceModelProfileSelectionInvalidMessage =
  "The workspace model profile selection file is unreadable or invalid, so no run was started. Apply a pair again with `draft-loop model-profiles apply <workspace>` or remove it with `draft-loop model-profiles clear <workspace>`.";

const referenceSchema = z.strictObject({
  id: z.string().min(1),
  version: z.number().int().positive().safe(),
});

const selectionFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelProfiles: z.strictObject({ author: referenceSchema, critic: referenceSchema }),
  appliedAt: z.iso.datetime(),
});

export interface WorkspaceModelProfileSelection {
  readonly modelProfiles: ModelProfileReferences;
  /** When the pair was applied, as an ISO timestamp. */
  readonly appliedAt: string;
}

/** The configured models of a workspace that a saved pair must still match. */
export interface ConfiguredModelPair {
  readonly author: { readonly company: string; readonly model: string };
  readonly critic: { readonly company: string; readonly model: string };
}

function selectionPath(root: string): string {
  return join(root, selectionDirectory, workspaceModelProfileSelectionFilename);
}

/** Missing file: no pair applied. Present but invalid: a CliUserError, never a silent fallback. */
export async function readWorkspaceModelProfileSelection(
  rootInput: string,
): Promise<WorkspaceModelProfileSelection | undefined> {
  let content: string;
  try {
    content = await readFile(selectionPath(resolve(rootInput)), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CliUserError(workspaceModelProfileSelectionInvalidMessage);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CliUserError(workspaceModelProfileSelectionInvalidMessage);
  }
  const result = selectionFileSchema.safeParse(parsed);
  if (!result.success) throw new CliUserError(workspaceModelProfileSelectionInvalidMessage);
  const { author, critic } = result.data.modelProfiles;
  return {
    modelProfiles: {
      author: { id: author.id, version: author.version },
      critic: { id: critic.id, version: critic.version },
    },
    appliedAt: result.data.appliedAt,
  };
}

/**
 * Why a pair no longer fits the workspace, or undefined when it does. A pair fits when both
 * profiles are registered for their roles and name the company and model the workspace configures.
 */
export function describeModelProfileSelectionMismatch(
  configured: ConfiguredModelPair,
  references: ModelProfileReferences,
  registry: ModelProfileRegistry = defaultModelProfileRegistry,
): string | undefined {
  for (const role of ["author", "critic"] as const) {
    const reference = references[role];
    let profile: ReturnType<ModelProfileRegistry["resolve"]>;
    try {
      profile = registry.resolve(reference.id, reference.version, role);
    } catch {
      return `the ${role} profile ${reference.id}@${reference.version} is not a registered ${role} profile`;
    }
    const model = configured[role];
    if (profile.provider !== model.company || profile.modelId !== model.model) {
      return `the ${role} profile ${reference.id}@${reference.version} is for ${profile.provider}/${profile.modelId} but the workspace ${role} is ${model.company}/${model.model}`;
    }
  }
  return undefined;
}

function referenceText(reference: { readonly id: string; readonly version: number }): string {
  return `${reference.id}@${reference.version}`;
}

/** Exact `author …; critic …` text for status lines. */
export function describeModelProfileReferences(references: ModelProfileReferences): string {
  return `author ${referenceText(references.author)}; critic ${referenceText(references.critic)}`;
}

/**
 * Applies a pair to an existing workspace, atomically. Refuses a pair the registry does not know
 * or one whose models differ from the workspace's configured author and critic.
 */
export async function saveWorkspaceModelProfileSelection(
  rootInput: string,
  references: ModelProfileReferences,
  options: { readonly registry?: ModelProfileRegistry; readonly now?: () => Date } = {},
): Promise<WorkspaceModelProfileSelection> {
  const root = resolve(rootInput);
  const config = await readWorkspace(root);
  const exact: ModelProfileReferences = {
    author: { id: references.author.id, version: references.author.version },
    critic: { id: references.critic.id, version: references.critic.version },
  };
  const mismatch = describeModelProfileSelectionMismatch(
    {
      author: { company: config.authorCompany, model: config.authorModel },
      critic: { company: config.criticCompany, model: config.criticModel },
    },
    exact,
    options.registry,
  );
  if (mismatch !== undefined) {
    throw new CliUserError(
      `The model profiles were not applied: ${mismatch}. Change the workspace models first or choose matching profiles.`,
    );
  }
  const appliedAt = (options.now ?? (() => new Date()))().toISOString();
  const text = `${JSON.stringify({ schemaVersion: 1, modelProfiles: exact, appliedAt }, null, 2)}\n`;
  if (!selectionFileSchema.safeParse(JSON.parse(text)).success) {
    throw new CliUserError("The model profiles were not applied: the references are invalid.");
  }
  const target = selectionPath(root);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(join(root, selectionDirectory), { recursive: true });
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, target);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new CliUserError("The model profile selection could not be saved.");
  }
  return { modelProfiles: exact, appliedAt };
}

/** Removes the applied pair; returns whether one was applied. */
export async function clearWorkspaceModelProfileSelection(rootInput: string): Promise<boolean> {
  const root = resolve(rootInput);
  await readWorkspace(root);
  const path = selectionPath(root);
  try {
    await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
  }
  try {
    await rm(path, { force: true });
  } catch {
    throw new CliUserError("The model profile selection could not be cleared.");
  }
  return true;
}

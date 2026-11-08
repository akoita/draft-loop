/**
 * The candidate's writing samples (#2513): up to three texts they wrote, such as an old letter or
 * a long email, kept as the `writing-samples.json` workspace setting. Drafted material copies
 * their sentence length, tone and words; a sample is style only, never a source of facts. As a
 * setting it lives with the record: archived with it and erased with it.
 */
import type { WorkspaceSettingsPort } from "@draft-loop/storage";
import { z } from "zod";

import { CliUserError } from "./cli-user-error.js";
import { workspaceSettings } from "./workspace-settings.js";

export const writingSamplesSetting = "writing-samples.json";
export const maximumWritingSamples = 3;
export const maximumWritingSampleCharacters = 4_000;
export const minimumWritingSampleCharacters = 80;

export const writingSampleTextSchema = z
  .string()
  .trim()
  .min(minimumWritingSampleCharacters)
  .max(maximumWritingSampleCharacters);

const documentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  samples: z.array(writingSampleTextSchema).max(maximumWritingSamples),
});

export interface WritingSamplesService {
  readonly read: (root: string) => Promise<readonly string[]>;
  /** Replaces every sample; an empty list removes them. Resolves with what was kept. */
  readonly replace: (root: string, samples: readonly string[]) => Promise<readonly string[]>;
}

export async function readWritingSamples(
  root: string,
  settings: WorkspaceSettingsPort = workspaceSettings(),
): Promise<readonly string[]> {
  const text = await settings.read(root, writingSamplesSetting);
  if (text === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliUserError("The writing samples setting is invalid.");
  }
  const result = documentSchema.safeParse(parsed);
  if (!result.success) throw new CliUserError("The writing samples setting is invalid.");
  return result.data.samples;
}

export async function replaceWritingSamples(
  root: string,
  samples: readonly string[],
  settings: WorkspaceSettingsPort = workspaceSettings(),
): Promise<readonly string[]> {
  const result = documentSchema.safeParse({ schemaVersion: 1, samples });
  if (!result.success) {
    throw new CliUserError(
      `Keep at most ${maximumWritingSamples} samples of ${minimumWritingSampleCharacters} to ${maximumWritingSampleCharacters} characters.`,
    );
  }
  if (result.data.samples.length === 0) {
    await settings.remove(root, writingSamplesSetting);
    return [];
  }
  await settings.write(root, writingSamplesSetting, `${JSON.stringify(result.data, null, 2)}\n`);
  return result.data.samples;
}

export function createWritingSamplesService(
  settings?: WorkspaceSettingsPort,
): WritingSamplesService {
  const port = () => settings ?? workspaceSettings();
  return {
    read: (root) => readWritingSamples(root, port()),
    replace: (root, samples) => replaceWritingSamples(root, samples, port()),
  };
}

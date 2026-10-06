import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { CliUserError } from "./cli-user-error.js";
import {
  defaultEmbeddingModelTier,
  type EmbeddingModelTier,
  embeddingModelTiers,
} from "./embedding-model-install.js";

/**
 * The workspace retrieval mode decides how candidate knowledge is searched. `lexical` (the
 * default) uses the existing keyword retrieval; `semantic` and `hybrid` additionally use the
 * local embedding model of the chosen tier. The setting lives beside `workspace.json` and is read
 * once when a run starts or resumes.
 */
export const retrievalModes = ["lexical", "semantic", "hybrid"] as const;
export type RetrievalMode = (typeof retrievalModes)[number];

export const defaultRetrievalMode: RetrievalMode = "lexical";

const retrievalModeFilename = "retrieval-mode.json";
const retrievalModeDirectory = ".draft-loop";

export const retrievalModeInvalidMessage =
  "The workspace retrieval mode file is invalid. Set it again with a retrieval mode of lexical, semantic, or hybrid.";

const retrievalModeFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(retrievalModes),
  modelTier: z.custom<EmbeddingModelTier>(
    (value) => embeddingModelTiers.includes(value as EmbeddingModelTier),
    "unknown embedding model tier",
  ),
  updatedAt: z.iso.datetime(),
});

export interface WorkspaceRetrievalModeRecord {
  readonly mode: RetrievalMode;
  readonly modelTier: EmbeddingModelTier;
  /** Absent while the defaults apply because no setting was ever saved. */
  readonly updatedAt?: string;
}

function retrievalModePath(root: string): string {
  return join(root, retrievalModeDirectory, retrievalModeFilename);
}

/** A missing file means the defaults; any unreadable or unrecognized content fails closed. */
export async function readWorkspaceRetrievalMode(
  root: string,
): Promise<WorkspaceRetrievalModeRecord> {
  let content: string;
  try {
    content = await readFile(retrievalModePath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { mode: defaultRetrievalMode, modelTier: defaultEmbeddingModelTier };
    }
    throw new CliUserError(retrievalModeInvalidMessage);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CliUserError(retrievalModeInvalidMessage);
  }
  const result = retrievalModeFileSchema.safeParse(parsed);
  if (!result.success) throw new CliUserError(retrievalModeInvalidMessage);
  return {
    mode: result.data.mode,
    modelTier: result.data.modelTier,
    updatedAt: result.data.updatedAt,
  };
}

export async function writeWorkspaceRetrievalMode(
  root: string,
  setting: { readonly mode: RetrievalMode; readonly modelTier?: EmbeddingModelTier },
  now: () => Date = () => new Date(),
): Promise<WorkspaceRetrievalModeRecord> {
  const mode = setting.mode;
  const modelTier = setting.modelTier ?? defaultEmbeddingModelTier;
  const updatedAt = now().toISOString();
  const path = retrievalModePath(root);
  await mkdir(join(root, retrievalModeDirectory), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ schemaVersion: 1, mode, modelTier, updatedAt }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, path);
  return { mode, modelTier, updatedAt };
}

export function parseRetrievalMode(value: string): RetrievalMode {
  const mode = retrievalModes.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw new CliUserError(`The retrieval mode must be one of: ${retrievalModes.join(", ")}.`);
  }
  return mode;
}

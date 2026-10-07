import { homedir as osHomedir } from "node:os";
import { join } from "node:path";

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The per-user DraftLoop data directory, shared by every local store that is not part of a
 * workspace: the embedding models and the default candidate knowledge store.
 */
export function defaultDraftLoopDataRoot(
  input: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly platform?: string;
    readonly homedir?: string;
  } = {},
): string {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const home = input.homedir ?? osHomedir();
  if (platform === "win32") {
    const base = nonEmpty(env.LOCALAPPDATA) ?? join(home, "AppData", "Local");
    return join(base, "DraftLoop");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "DraftLoop");
  }
  const base = nonEmpty(env.XDG_DATA_HOME) ?? join(home, ".local", "share");
  return join(base, "draft-loop");
}

/** Where the automatically created candidate knowledge store lives, unless the host overrides it. */
export function defaultCandidateKnowledgeStoreRoot(
  input: Parameters<typeof defaultDraftLoopDataRoot>[0] = {},
): string {
  return join(defaultDraftLoopDataRoot(input), "candidate-knowledge");
}

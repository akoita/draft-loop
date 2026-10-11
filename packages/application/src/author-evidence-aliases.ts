import type { JsonObject, JsonValue } from "@draft-loop/providers";

/**
 * Short request-local names for retrieved evidence chunk IDs.
 *
 * Chunk IDs are 64-character SHA-256 hex strings. An author proposal cites
 * them hundreds of times, and hex tokenizes poorly, so the full IDs alone can
 * spend a large share of the output-token cap. The author sees `E1`, `E2`, …
 * instead, and the proposal is mapped back to the real IDs before validation.
 */
export interface AuthorEvidenceAliases {
  readonly aliases: readonly string[];
  /** Replace every string equal to a known chunk ID, in values and keys. */
  readonly toModel: <T extends JsonValue>(value: T) => T;
  /** Map aliases in proposal `evidenceChunkIds` back to chunk IDs. */
  readonly fromModel: (proposal: JsonObject) => JsonObject;
}

export function createAuthorEvidenceAliases(
  evidenceChunkIds: readonly string[],
): AuthorEvidenceAliases {
  const aliasById = new Map<string, string>();
  const idByAlias = new Map<string, string>();
  // An ID that already looks like an alias could be confused with one, so keep real IDs then.
  const usable = !evidenceChunkIds.some((id) => /^E\d+$/u.test(id));
  for (const id of usable ? evidenceChunkIds : []) {
    if (aliasById.has(id)) continue;
    const alias = `E${aliasById.size + 1}`;
    aliasById.set(id, alias);
    idByAlias.set(alias, id);
  }

  const aliasString = (value: string): string => aliasById.get(value) ?? value;
  const toModel = (value: JsonValue): JsonValue => {
    if (typeof value === "string") return aliasString(value);
    if (Array.isArray(value)) return value.map(toModel);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, member]) => [
        aliasString(key),
        toModel(member),
      ]),
    );
  };

  const fromModel = (value: JsonValue, key?: string): JsonValue => {
    if (Array.isArray(value)) {
      return key === "evidenceChunkIds"
        ? value.map((member) =>
            typeof member === "string" ? (idByAlias.get(member) ?? member) : member,
          )
        : value.map((member) => fromModel(member));
    }
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([name, member]) => [name, fromModel(member, name)]),
    );
  };

  return {
    aliases: usable ? [...idByAlias.keys()] : [...new Set(evidenceChunkIds)],
    toModel: <T extends JsonValue>(value: T) => toModel(value) as T,
    fromModel: (proposal) => fromModel(proposal) as JsonObject,
  };
}

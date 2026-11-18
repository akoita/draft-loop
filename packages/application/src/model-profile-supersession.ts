import type { ModelProfileReference, ModelProfileReferences } from "./index.js";

/**
 * Profile versions that new runs no longer use, each mapped to the version that replaces it.
 * A saved workspace pair or an application's own pair keeps naming the version it was saved with,
 * so a fix shipped as a new version never reached it (#3017). Only a version that fails on every
 * use and has a same-model successor belongs here; a resumed run keeps the version recorded in its
 * own snapshot.
 */
interface Supersession {
  /** The version new runs use instead. */
  readonly version: number;
  /** The old version's own reasoning level: a saved choice of it is dropped, since it failed. */
  readonly failedEffort: string;
}

const supersededVersions: ReadonlyMap<string, Supersession> = new Map([
  // Haiku 5.5 at medium effort spent its whole output budget on adaptive thinking (max_tokens).
  ["economy-anthropic-author@2", { version: 5, failedEffort: "medium" }],
  ["economy-anthropic-author@4", { version: 5, failedEffort: "medium" }],
]);

function current(reference: ModelProfileReference): ModelProfileReference {
  const supersession = supersededVersions.get(`${reference.id}@${reference.version}`);
  if (supersession === undefined) return reference;
  // Another level a person chose stays; the level that failed gives way to the new default.
  const { effort } = reference;
  return effort === undefined || effort === supersession.failedEffort
    ? { id: reference.id, version: supersession.version }
    : { id: reference.id, version: supersession.version, effort };
}

/** The pair a new run uses: superseded versions are replaced, everything else is unchanged. */
export function currentModelProfileReferences(
  references: ModelProfileReferences,
): ModelProfileReferences {
  const author = current(references.author);
  const critic = current(references.critic);
  return author === references.author && critic === references.critic
    ? references
    : { ...references, author, critic };
}

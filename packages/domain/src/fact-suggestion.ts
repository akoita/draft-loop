/**
 * Fact suggestions (#3065, step 1): proposed changes to the career profile that wait for a person.
 * This is memory kind `fact-suggestion`.
 *
 * A run, a review, an agent or a career interview may notice that a profile fact is missing, wrong,
 * no longer true, used too widely, or worth confirming. It files a suggestion that quotes what was
 * said and who said it. Nothing changes the profile until a person accepts the suggestion, and
 * accepting it counts as reviewing that change.
 *
 * Suggestions point at a fact by id and by content. Ids change when a profile is derived again, so
 * the content key decides whether a suggestion still applies (`stale` otherwise) and whether a
 * rejected suggestion would be offered again (the dedupe key).
 */

import type {
  CanonicalCandidateProfileFact,
  CanonicalCandidateProfileFactCategory,
} from "./canonical-candidate-profile.js";
import { type FactUsageLevel, factUsageKey, fnv1a64, normalizedFactText } from "./fact-usage.js";

/**
 * What a suggestion proposes: a new fact, a corrected value, retiring a fact that no longer holds,
 * a usage level for a fact, or confirming a fact the person has not checked yet.
 */
export const factSuggestionKinds = ["add", "correct", "retire", "set-usage", "confirm"] as const;
export type FactSuggestionKind = (typeof factSuggestionKinds)[number];

/**
 * `pending` waits for a person. `accepted` applied it as filed, `edited` applied it after the person
 * changed it, `rejected` declined it, and `stale` means the fact it targets changed first.
 */
export const factSuggestionStatuses = [
  "pending",
  "accepted",
  "edited",
  "rejected",
  "stale",
] as const;
export type FactSuggestionStatus = (typeof factSuggestionStatuses)[number];

/** Where a suggestion was noticed. */
export const factSuggestionOriginKinds = [
  /** The person changed a cited fact while approving a draft. */
  "review-edit",
  /** The critic asked whether a claim is true. */
  "critic-question",
  /** A fact the profile holds but the person never confirmed. */
  "unconfirmed-fact",
  /** An agent connected through the agent channel. */
  "agent",
  /** A confirmed career interview topic. */
  "career-interview",
] as const;
export type FactSuggestionOriginKind = (typeof factSuggestionOriginKinds)[number];

/** Who said the quoted words. */
export const factSuggestionSpeakers = ["candidate", "coach", "agent", "system"] as const;
export type FactSuggestionSpeaker = (typeof factSuggestionSpeakers)[number];

/** Who may decide: only people, never an agent or the system. */
export const factSuggestionDeciderRoles = ["candidate", "coach"] as const;
export type FactSuggestionDeciderRole = (typeof factSuggestionDeciderRoles)[number];

/** Kinds that change one existing fact, so they name it. */
export const targetedFactSuggestionKinds = [
  "correct",
  "retire",
  "set-usage",
  "confirm",
] as const satisfies readonly FactSuggestionKind[];

export const factSuggestionLimits = Object.freeze({
  idMax: 120,
  quoteMin: 1,
  quoteMax: 1_000,
  fieldMax: 120,
  valueMax: 2_000,
  reasonMax: 400,
});

export const factSuggestionSchemaVersion = 1 as const;

/** `fsk1-`, the kind, `-` and 16 lowercase hex digits. */
export const factSuggestionDedupeKeyPattern = new RegExp(
  `^fsk1-(?:${factSuggestionKinds.join("|")})-[0-9a-f]{16}$`,
  "u",
);

/** The fact a targeted suggestion changes: its id in the base version and its content key. */
export interface FactSuggestionTarget {
  readonly factId: string;
  /** The fact's usage key when the suggestion was filed; see {@link factUsageKey}. */
  readonly factKey: string;
}

/** The proposed change. `add` carries a whole fact; `correct` a new value for the target. */
export type FactSuggestionChange =
  | {
      readonly kind: "add";
      readonly category: CanonicalCandidateProfileFactCategory;
      readonly subjectId?: string | undefined;
      readonly field: string;
      readonly value: string;
    }
  | { readonly kind: "correct"; readonly value: string }
  | { readonly kind: "retire" }
  | { readonly kind: "set-usage"; readonly usage: FactUsageLevel }
  | { readonly kind: "confirm" };

export interface FactSuggestionOrigin {
  readonly kind: FactSuggestionOriginKind;
  readonly applicationId?: string | undefined;
  readonly runId?: string | undefined;
  /** The review round, from 1. */
  readonly round?: number | undefined;
  /** The draft block the person edited or the critic questioned. */
  readonly blockId?: string | undefined;
  /** The agent client that filed it, for origin `agent`. */
  readonly agentClientId?: string | undefined;
  readonly careerInterviewId?: string | undefined;
}

export interface FactSuggestionDecision {
  readonly role: FactSuggestionDeciderRole;
  /** The deciding member's id. */
  readonly memberId: string;
  readonly decidedAt: string;
}

export interface FactSuggestion {
  readonly schemaVersion: typeof factSuggestionSchemaVersion;
  readonly id: string;
  readonly profileId: string;
  /** The profile version the suggestion was filed against. */
  readonly baseVersionId: string;
  readonly change: FactSuggestionChange;
  /** Present exactly when the kind is targeted. */
  readonly target?: FactSuggestionTarget | undefined;
  /** The words that support the change, as said; it becomes the candidate-statement source. */
  readonly quote: string;
  readonly speaker: FactSuggestionSpeaker;
  readonly origin: FactSuggestionOrigin;
  readonly dedupeKey: string;
  readonly status: FactSuggestionStatus;
  readonly createdAt: string;
  /** Present once a person decided, and absent for `pending` and `stale`. */
  readonly decision?: FactSuggestionDecision | undefined;
  /** For `edited`: the change as the person applied it. */
  readonly appliedChange?: FactSuggestionChange | undefined;
}

export function isTargetedFactSuggestionKind(
  kind: FactSuggestionKind,
): kind is (typeof targetedFactSuggestionKinds)[number] {
  return (targetedFactSuggestionKinds as readonly string[]).includes(kind);
}

/** The proposed content the dedupe key hashes, without ids or the quote. */
function changeContent(change: FactSuggestionChange): string {
  switch (change.kind) {
    case "add":
      return [
        change.category,
        normalizedFactText(change.field),
        normalizedFactText(change.value),
      ].join("\u0000");
    case "correct":
      return normalizedFactText(change.value);
    case "set-usage":
      return change.usage;
    case "retire":
    case "confirm":
      return "";
  }
}

/**
 * The key that stops the same suggestion from being offered twice, a rejected one included: the
 * kind, the target fact's content key and the proposed content. It holds no fact text, and it
 * survives a new derivation because it uses content, not fact ids.
 */
export function factSuggestionDedupeKey(
  change: FactSuggestionChange,
  target?: Pick<FactSuggestionTarget, "factKey"> | undefined,
): string {
  const hash = fnv1a64(`${target?.factKey ?? ""}\u0001${changeContent(change)}`);
  return `fsk1-${change.kind}-${hash}`;
}

/** The target to record for a fact of the base version. */
export function factSuggestionTarget(fact: CanonicalCandidateProfileFact): FactSuggestionTarget {
  return { factId: fact.id, factKey: factUsageKey(fact) };
}

/** Statuses a pending suggestion can move to; every other status is final. */
const transitions: Readonly<Record<FactSuggestionStatus, readonly FactSuggestionStatus[]>> = {
  pending: ["accepted", "edited", "rejected", "stale"],
  accepted: [],
  edited: [],
  rejected: [],
  stale: [],
};

export function canMoveFactSuggestion(
  from: FactSuggestionStatus,
  to: FactSuggestionStatus,
): boolean {
  return transitions[from].includes(to);
}

/**
 * Whether a pending suggestion no longer applies to the current profile facts. A targeted
 * suggestion is stale when no current fact has its target's content, under the same id or a new
 * one. An `add` is stale when a fact with the same category, field and value already exists.
 */
export function isFactSuggestionStale(
  suggestion: Pick<FactSuggestion, "change" | "target">,
  currentFacts: readonly CanonicalCandidateProfileFact[],
): boolean {
  const { change, target } = suggestion;
  if (change.kind === "add") {
    const key = factUsageKey(change);
    return currentFacts.some((fact) => factUsageKey(fact) === key);
  }
  if (target === undefined) return true;
  return !currentFacts.some((fact) => factUsageKey(fact) === target.factKey);
}

/**
 * The current fact a targeted suggestion applies to: the same id when its content is unchanged,
 * else the one fact with the target's content. Undefined when none or several match.
 */
export function findFactSuggestionTarget(
  target: FactSuggestionTarget,
  currentFacts: readonly CanonicalCandidateProfileFact[],
): CanonicalCandidateProfileFact | undefined {
  const sameId = currentFacts.find((fact) => fact.id === target.factId);
  if (sameId !== undefined && factUsageKey(sameId) === target.factKey) return sameId;
  const matches = currentFacts.filter((fact) => factUsageKey(fact) === target.factKey);
  return matches.length === 1 ? matches[0] : undefined;
}

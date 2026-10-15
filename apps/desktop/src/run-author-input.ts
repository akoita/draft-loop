/**
 * What the run's latest author step was sent, as the review screen shows it.
 *
 * The host reads the run's recorded `run.author-input` event and resolves each unmatched
 * requirement id to its text, falling back to the id, so only counts and requirement texts cross
 * the bridge. Runs that recorded no author input keep the review exactly as before.
 *
 * The runtime key list is bound to the interface, so adding a field to one without the other is
 * a compile error rather than a validator that silently rejects real payloads.
 */
import { maximumRevisionDirectionLength } from "./revision-direction.js";

export interface RunAuthorInputView {
  readonly sentChunkCount: number;
  readonly sentFactCount: number;
  /** Eligible chunks across the run's pinned sources; absent without a knowledge selection. */
  readonly knowledgeChunkCount?: number;
  /** Candidate facts of the run's pinned profile; absent when no profile is pinned. */
  readonly knowledgeFactCount?: number;
  /** Texts of the requirements that matched no sent item, at most 50. */
  readonly unmatchedRequirements: readonly string[];
  /** The candidate's own direction for this round's author, as they gave it. */
  readonly candidateDirection?: RunAuthorInputDirectionView;
}

/** What the candidate asked of the author for the round, and when. */
export interface RunAuthorInputDirectionView {
  readonly text: string;
  readonly createdAt: string;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const runAuthorInputKeys = exactKeys<RunAuthorInputView>()([
  "sentChunkCount",
  "sentFactCount",
  "knowledgeChunkCount",
  "knowledgeFactCount",
  "unmatchedRequirements",
  "candidateDirection",
]);

const maximumCount = 1_000_000;
/** The most unmatched requirements the host sends and the bridge accepts. */
export const maximumUnmatchedRequirements = 50;
const maximumRequirementLength = 2_000;

function directionView(value: unknown): RunAuthorInputDirectionView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => key === "text" || key === "createdAt")) return undefined;
  const { text, createdAt } = raw;
  return typeof text === "string" &&
    text.length > 0 &&
    text.length <= maximumRevisionDirectionLength &&
    typeof createdAt === "string" &&
    createdAt.length <= 64
    ? { text, createdAt }
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximumCount
    ? value
    : undefined;
}

function requirementTexts(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumUnmatchedRequirements) return undefined;
  return value.every(
    (text): text is string => typeof text === "string" && text.length <= maximumRequirementLength,
  )
    ? [...value]
    : undefined;
}

/** The view with only its known fields, or `undefined` when the value does not have its shape. */
export function normalizeRunAuthorInput(value: unknown): RunAuthorInputView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => (runAuthorInputKeys as readonly string[]).includes(key))) {
    return undefined;
  }
  const sentChunkCount = count(raw.sentChunkCount);
  const sentFactCount = count(raw.sentFactCount);
  const knowledgeChunkCount =
    raw.knowledgeChunkCount === undefined ? undefined : count(raw.knowledgeChunkCount);
  const knowledgeFactCount =
    raw.knowledgeFactCount === undefined ? undefined : count(raw.knowledgeFactCount);
  const unmatchedRequirements = requirementTexts(raw.unmatchedRequirements);
  const candidateDirection =
    raw.candidateDirection === undefined ? undefined : directionView(raw.candidateDirection);
  if (
    sentChunkCount === undefined ||
    sentFactCount === undefined ||
    (raw.knowledgeChunkCount !== undefined && knowledgeChunkCount === undefined) ||
    (raw.knowledgeFactCount !== undefined && knowledgeFactCount === undefined) ||
    (raw.candidateDirection !== undefined && candidateDirection === undefined) ||
    unmatchedRequirements === undefined
  ) {
    return undefined;
  }
  return {
    sentChunkCount,
    sentFactCount,
    ...(knowledgeChunkCount === undefined ? {} : { knowledgeChunkCount }),
    ...(knowledgeFactCount === undefined ? {} : { knowledgeFactCount }),
    unmatchedRequirements,
    ...(candidateDirection === undefined ? {} : { candidateDirection }),
  };
}

/**
 * The view the host sends for a recorded author input: unmatched ids resolved to requirement
 * text, falling back to the id, and capped at the bridge limit.
 */
export function runAuthorInputView(
  input: {
    readonly sentChunkCount: number;
    readonly sentFactCount: number;
    readonly knowledgeChunkCount?: number;
    readonly knowledgeFactCount?: number;
    readonly unmatchedRequirementIds: readonly string[];
    readonly candidateDirection?: RunAuthorInputDirectionView;
  },
  requirementTexts: ReadonlyMap<string, string>,
): RunAuthorInputView | undefined {
  return normalizeRunAuthorInput({
    sentChunkCount: input.sentChunkCount,
    sentFactCount: input.sentFactCount,
    ...(input.knowledgeChunkCount === undefined
      ? {}
      : { knowledgeChunkCount: input.knowledgeChunkCount }),
    ...(input.knowledgeFactCount === undefined
      ? {}
      : { knowledgeFactCount: input.knowledgeFactCount }),
    ...(input.candidateDirection === undefined
      ? {}
      : { candidateDirection: input.candidateDirection }),
    // Identical texts read as one requirement, and the renderer keys list items by text.
    unmatchedRequirements: [
      ...new Set(
        input.unmatchedRequirementIds.map((id) =>
          (requirementTexts.get(id) ?? id).slice(0, maximumRequirementLength),
        ),
      ),
    ].slice(0, maximumUnmatchedRequirements),
  });
}

export interface RunAuthorInputDisplay {
  /** Side-panel value, e.g. "15 items". */
  readonly value: string;
  /** Side-panel detail, e.g. "of 181 chunks and 40 facts". */
  readonly detail: string;
  /** Summary of the gap list, e.g. "No sent evidence for 2 requirements"; absent without a gap. */
  readonly gapSummary?: string;
  readonly unmatchedRequirements: readonly string[];
  /** The candidate's direction for the round, when they gave one. */
  readonly direction?: { readonly text: string; readonly createdAt: string };
}

function plural(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/** What the review's "Author input" fact shows; `undefined` hides the fact. */
export function runAuthorInputDisplay(
  input: RunAuthorInputView | null | undefined,
): RunAuthorInputDisplay | undefined {
  if (input === undefined || input === null) return undefined;
  const { knowledgeChunkCount, knowledgeFactCount, unmatchedRequirements } = input;
  const detail =
    knowledgeChunkCount === undefined
      ? `${plural(input.sentChunkCount, "chunk")} and ${plural(input.sentFactCount, "fact")}`
      : knowledgeFactCount === undefined
        ? `of ${plural(knowledgeChunkCount, "chunk")}`
        : `of ${plural(knowledgeChunkCount, "chunk")} and ${plural(knowledgeFactCount, "fact")}`;
  return {
    value: plural(input.sentChunkCount + input.sentFactCount, "item"),
    detail,
    ...(unmatchedRequirements.length === 0
      ? {}
      : {
          gapSummary: `No sent evidence for ${plural(unmatchedRequirements.length, "requirement")}`,
        }),
    unmatchedRequirements,
    ...(input.candidateDirection === undefined ? {} : { direction: input.candidateDirection }),
  };
}

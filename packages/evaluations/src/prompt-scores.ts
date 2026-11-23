/**
 * The prompt score gate (#2836): every prompt version and default model a new run uses must have
 * a recorded live evaluation score, or a dated waiver with a written reason, and a score that
 * fails more often than the previous one needs a written reason.
 *
 * The manifest (`packages/evaluations/prompt-scores.json`) holds only content-free numbers from
 * `pnpm eval:live` on the synthetic cohort cases. Nothing here calls a model.
 */

import { type LiveFailureMode, type LiveResult, liveFailureModes } from "./eval-live.js";

/** One role of the pair a score belongs to. */
export interface PromptScoreRole {
  readonly modelId: string;
  readonly promptTemplateVersion: string;
}

export interface PromptScorePair {
  readonly author: PromptScoreRole;
  readonly critic: PromptScoreRole;
}

/** A recorded live evaluation of a pair. */
export interface ScoredPromptEntry extends PromptScorePair {
  readonly status: "scored";
  readonly recordedAt: string;
  readonly label: string;
  readonly commit: string;
  readonly judge: { readonly version: string; readonly model: string } | null;
  readonly fixtureSet: { readonly cases: readonly string[]; readonly rounds: number };
  readonly costUsd: number;
  readonly costCapUsd: number;
  /** Share of rounds failing each mode: lower is better. */
  readonly failRates: Readonly<Partial<Record<LiveFailureMode, number>>>;
  /** Why a rise past the threshold is accepted. Required only when there is such a rise. */
  readonly reason?: string;
}

/** A pair accepted without a score until a date, for example while its paid run is pending. */
export interface WaivedPromptEntry extends PromptScorePair {
  readonly status: "waived";
  /** The day the waiver was written, YYYY-MM-DD. */
  readonly recordedAt: string;
  /** The last day the gate accepts the waiver, YYYY-MM-DD, at most 31 days after recordedAt. */
  readonly until: string;
  readonly reason: string;
}

export type PromptScoreEntry = ScoredPromptEntry | WaivedPromptEntry;

export interface PromptScoreManifest {
  readonly schemaVersion: 1;
  readonly entries: readonly PromptScoreEntry[];
}

/** A waiver may last at most this many days, so a pending run cannot be put off for good. */
export const promptScoreWaiverMaxDays = 31;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The command that turns a recorded `eval:live` result into a manifest entry. */
export const promptScoreRecordCommand = "pnpm eval:scores:record";

export function promptScorePairKey(pair: PromptScorePair): string {
  return [
    pair.author.modelId,
    pair.author.promptTemplateVersion,
    pair.critic.modelId,
    pair.critic.promptTemplateVersion,
  ].join("|");
}

function describePair(pair: PromptScorePair): string {
  return `author ${pair.author.promptTemplateVersion} on ${pair.author.modelId}, critic ${pair.critic.promptTemplateVersion} on ${pair.critic.modelId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRole(value: unknown): value is PromptScoreRole {
  return (
    isRecord(value) &&
    typeof value.modelId === "string" &&
    value.modelId !== "" &&
    typeof value.promptTemplateVersion === "string" &&
    value.promptTemplateVersion !== ""
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Reads a manifest, listing every shape problem instead of stopping at the first. */
export function parsePromptScoreManifest(value: unknown): {
  readonly manifest: PromptScoreManifest | null;
  readonly problems: readonly string[];
} {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    return { manifest: null, problems: ["the manifest needs schemaVersion 1 and an entries list"] };
  }
  const problems: string[] = [];
  value.entries.forEach((entry: unknown, index) => {
    const where = `entry ${index + 1}`;
    if (!isRecord(entry) || !isRole(entry.author) || !isRole(entry.critic)) {
      problems.push(
        `${where}: needs author and critic, each with modelId and promptTemplateVersion`,
      );
      return;
    }
    if (typeof entry.recordedAt !== "string" || !DATE.test(entry.recordedAt.slice(0, 10))) {
      problems.push(`${where}: recordedAt must start with a date such as 2026-11-22`);
    }
    if (entry.status === "waived") {
      if (!hasText(entry.reason)) problems.push(`${where}: a waiver needs a written reason`);
      if (typeof entry.until !== "string" || !DATE.test(entry.until)) {
        problems.push(`${where}: a waiver needs "until", a date such as 2026-12-07`);
      }
      return;
    }
    if (entry.status !== "scored") {
      problems.push(`${where}: status must be "scored" or "waived"`);
      return;
    }
    const fixtureSet = entry.fixtureSet;
    if (
      !isRecord(fixtureSet) ||
      !Array.isArray(fixtureSet.cases) ||
      fixtureSet.cases.length === 0 ||
      typeof fixtureSet.rounds !== "number" ||
      fixtureSet.rounds < 1
    ) {
      problems.push(`${where}: fixtureSet needs its cases and a round count`);
    }
    if (typeof entry.costUsd !== "number" || typeof entry.costCapUsd !== "number") {
      problems.push(`${where}: costUsd and costCapUsd must be numbers`);
    }
    if (!isRecord(entry.failRates)) problems.push(`${where}: failRates must be an object`);
    if (entry.reason !== undefined && !hasText(entry.reason)) {
      problems.push(`${where}: reason, when present, must not be empty`);
    }
  });
  return problems.length === 0
    ? { manifest: value as unknown as PromptScoreManifest, problems }
    : { manifest: null, problems };
}

export interface PromptScoreRise {
  readonly mode: LiveFailureMode;
  readonly before: number;
  readonly after: number;
}

function sameFixtures(left: ScoredPromptEntry, right: ScoredPromptEntry): boolean {
  const sorted = (cases: readonly string[]) => JSON.stringify([...cases].sort());
  return (
    JSON.stringify(left.judge) === JSON.stringify(right.judge) &&
    sorted(left.fixtureSet.cases) === sorted(right.fixtureSet.cases)
  );
}

/**
 * Modes whose fail rate rose past the threshold against the previous comparable entry: the last
 * earlier score with the same judge and cases. The threshold is one round's worth of the smaller
 * run, the noise `pnpm eval:live` also tolerates.
 */
export function promptScoreRises(
  entry: ScoredPromptEntry,
  earlier: readonly PromptScoreEntry[],
): { readonly previous: ScoredPromptEntry | null; readonly rises: readonly PromptScoreRise[] } {
  const previous =
    [...earlier]
      .reverse()
      .find(
        (candidate): candidate is ScoredPromptEntry =>
          candidate.status === "scored" && sameFixtures(candidate, entry),
      ) ?? null;
  if (previous === null) return { previous, rises: [] };
  const threshold = 1 / Math.max(1, Math.min(entry.fixtureSet.rounds, previous.fixtureSet.rounds));
  const rises = liveFailureModes.flatMap((mode) => {
    const before = previous.failRates[mode];
    const after = entry.failRates[mode];
    if (before === undefined || after === undefined) return [];
    return after - before > threshold + 1e-9 ? [{ mode, before, after }] : [];
  });
  return { previous, rises };
}

function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000
  );
}

export interface PromptScoreCheck {
  readonly ok: boolean;
  /** What fails the gate, each with what to do about it. */
  readonly problems: readonly string[];
  /** What passes, for the log: the entry that covers the current pair. */
  readonly notes: readonly string[];
}

/**
 * Checks the manifest against the pair a new run uses today. Fails when the pair has no score
 * and no live waiver, when a waiver is past its date, too long or has no reason, and when any
 * score rose past the threshold against the previous one without a written reason.
 */
export function checkPromptScores(input: {
  readonly manifest: unknown;
  readonly current: PromptScorePair;
  /** Today, YYYY-MM-DD. */
  readonly today: string;
}): PromptScoreCheck {
  const parsed = parsePromptScoreManifest(input.manifest);
  if (parsed.manifest === null) {
    return { ok: false, problems: parsed.problems, notes: [] };
  }
  const { entries } = parsed.manifest;
  const problems: string[] = [];
  const notes: string[] = [];

  entries.forEach((entry, index) => {
    if (entry.status === "waived") {
      if (daysBetween(entry.recordedAt, entry.until) > promptScoreWaiverMaxDays) {
        problems.push(
          `the waiver for ${describePair(entry)} runs past ${promptScoreWaiverMaxDays} days from ${entry.recordedAt.slice(0, 10)}; shorten "until"`,
        );
      }
      return;
    }
    const { previous, rises } = promptScoreRises(entry, entries.slice(0, index));
    if (previous === null || rises.length === 0 || entry.reason !== undefined) return;
    const listed = rises
      .map(({ mode, before, after }) => `${mode} ${percent(before)} -> ${percent(after)}`)
      .join(", ");
    problems.push(
      `the score "${entry.label}" for ${describePair(entry)} fails more often than "${previous.label}" (${listed}); fix the prompt, or add a written "reason" to that entry`,
    );
  });

  const key = promptScorePairKey(input.current);
  const matching = entries.filter((entry) => promptScorePairKey(entry) === key);
  const scored = matching.filter((entry) => entry.status === "scored");
  const waivers = matching.filter((entry): entry is WaivedPromptEntry => entry.status === "waived");
  const liveWaiver = waivers.find((waiver) => waiver.until >= input.today);
  const lastScore = scored.at(-1);
  if (lastScore !== undefined) {
    notes.push(
      `${describePair(input.current)}: scored "${lastScore.label}" on ${lastScore.recordedAt.slice(0, 10)}`,
    );
  } else if (liveWaiver !== undefined) {
    notes.push(
      `${describePair(input.current)}: waived until ${liveWaiver.until} (${liveWaiver.reason})`,
    );
  } else {
    const expired = waivers.at(-1);
    problems.push(
      [
        expired === undefined
          ? `no score for the pair a new run uses: ${describePair(input.current)}`
          : `the waiver for ${describePair(input.current)} ended on ${expired.until}`,
        "Record one: run `pnpm eval:live --out <private dir> --label <label> --total-cap-usd 1 --record`",
        `(paid and local, with the owner's go), then \`${promptScoreRecordCommand} --label <label>\`.`,
        'Until then, a "waived" entry with a reason and an "until" date at most',
        `${promptScoreWaiverMaxDays} days away lets the change through (docs/evaluation/prompt-score-gate.md).`,
      ].join("\n  "),
    );
  }
  return { ok: problems.length === 0, problems, notes };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The manifest entry for a recorded `eval:live` result. */
export function promptScoreEntryFromLiveResult(
  result: LiveResult,
  options: { readonly costCapUsd: number; readonly reason?: string },
): ScoredPromptEntry {
  return {
    status: "scored",
    author: { ...result.models.author },
    critic: { ...result.models.critic },
    recordedAt: result.recordedAt,
    label: result.label,
    commit: result.commit,
    judge: result.judge === null ? null : { ...result.judge },
    fixtureSet: { cases: [...result.cases], rounds: result.rounds },
    costUsd: result.costUsd,
    costCapUsd: options.costCapUsd,
    failRates: { ...result.failRates },
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
}

/**
 * Adds a score to the manifest. A waiver for the same pair is dropped, since the score replaces
 * it; recording the same result twice is refused.
 */
export function addPromptScore(
  manifest: PromptScoreManifest,
  entry: ScoredPromptEntry,
): PromptScoreManifest {
  const key = promptScorePairKey(entry);
  if (
    manifest.entries.some(
      (existing) =>
        existing.status === "scored" &&
        promptScorePairKey(existing) === key &&
        existing.recordedAt === entry.recordedAt,
    )
  ) {
    throw new Error(`"${entry.label}" (${entry.recordedAt}) is already in the manifest.`);
  }
  return {
    schemaVersion: 1,
    entries: [
      ...manifest.entries.filter(
        (existing) => existing.status !== "waived" || promptScorePairKey(existing) !== key,
      ),
      entry,
    ],
  };
}

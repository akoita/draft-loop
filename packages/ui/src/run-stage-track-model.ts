/**
 * Who works each step of a run, round by round, for the run header's stage track (#3214).
 *
 * Round 1 is the author's draft and the critic's critique. Each later round is the author's
 * revision and the critic's critique. Approval is the person's gate after the rounds, not an agent
 * step. The model is pure so the static-markup tests can check every state without layout.
 */
import type { CriticFallbackView, ReviewScreenState } from "./model.js";

export type StageActor = "author" | "critic" | "you";
export type StageKind = "draft" | "critique" | "revise";
export type StageStatus = "done" | "active" | "waiting";

export interface StageStep {
  readonly kind: StageKind;
  readonly actor: Exclude<StageActor, "you">;
  readonly status: StageStatus;
  /** The step's model when it differs from the cast line's, as before a critic fallback; else null. */
  readonly model: string | null;
}

export interface StageRound {
  readonly number: number;
  readonly steps: readonly [StageStep, StageStep];
  /** True for the round whose critic call switched to the fallback critic. */
  readonly criticChanged: boolean;
}

/** What happens now, for the one-line readout. */
export type StageNow =
  | { readonly kind: "collecting" }
  | { readonly kind: "working"; readonly actor: "author" | "critic"; readonly step: StageKind }
  | { readonly kind: "stalled"; readonly actor: "author" | "critic"; readonly step: StageKind }
  | { readonly kind: "deciding" }
  | { readonly kind: "approved" };

export interface StageTrack {
  /** Empty model ids mean the run recorded none for that role. */
  readonly cast: { readonly author: string; readonly critic: string };
  readonly rounds: readonly StageRound[];
  /** Leading rounds folded into one chip; the last two rounds always stay open. */
  readonly foldedRounds: number;
  readonly gate: StageStatus;
  readonly now: StageNow;
  /** The current round, at least 1. */
  readonly round: number;
}

/** Rounds kept open on the track; older ones fold. */
export const openRoundCount = 2;

type StageTrackInput = Pick<
  ReviewScreenState,
  "state" | "execution" | "round" | "reviewComplete"
> & {
  readonly criticFallback?: CriticFallbackView | null;
  /** The models the run recorded, or null when it recorded none. */
  readonly models: { readonly author: string; readonly critic: string } | null;
};

/**
 * Where the run sits in its current round: 0 the author's step, 1 the critique, 2 the person's
 * gate, 3 approved; -1 before the first draft.
 */
function position(input: StageTrackInput): number {
  switch (input.state) {
    case "collecting":
      return -1;
    case "drafting":
    case "revising":
      return 0;
    case "reviewing":
      return 1;
    case "awaiting-approval":
      return 2;
    case "approved":
    case "exported":
      return 3;
    default:
      if (input.execution.step === "author" || input.execution.step === "revision") return 0;
      if (input.execution.step === "critic") return 1;
      return input.reviewComplete ? 2 : 1;
  }
}

function statusAt(index: number, at: number): StageStatus {
  if (index < at) return "done";
  return index === at ? "active" : "waiting";
}

export function runStageTrack(input: StageTrackInput): StageTrack {
  const round = Math.max(1, input.round);
  const at = position(input);
  const fallback = input.criticFallback ?? null;
  const author = input.models?.author ?? "";
  // The cast names the critic working now; rounds before a fallback name their own critic.
  const critic = fallback?.toModel ?? input.models?.critic ?? "";
  const rounds: StageRound[] = [];
  for (let number = 1; number <= round; number += 1) {
    const current = number === round;
    const authorStatus = current ? statusAt(0, at) : "done";
    const criticStatus = current ? statusAt(1, at) : "done";
    rounds.push({
      number,
      steps: [
        {
          kind: number === 1 ? "draft" : "revise",
          actor: "author",
          status: authorStatus,
          model: null,
        },
        {
          kind: "critique",
          actor: "critic",
          status: criticStatus,
          model:
            fallback !== null && number < fallback.round && fallback.fromModel !== critic
              ? fallback.fromModel
              : null,
        },
      ],
      criticChanged: fallback?.round === number,
    });
  }
  return {
    cast: { author, critic },
    rounds,
    foldedRounds: Math.max(0, rounds.length - openRoundCount),
    gate: at < 2 ? "waiting" : at === 2 ? "active" : "done",
    now: stageNow(input, at, round),
    round,
  };
}

function stageNow(input: StageTrackInput, at: number, round: number): StageNow {
  if (at < 0) return { kind: "collecting" };
  if (at === 2) return { kind: "deciding" };
  if (at === 3) return { kind: "approved" };
  const actor = at === 0 ? "author" : "critic";
  const step: StageKind = at === 1 ? "critique" : round === 1 ? "draft" : "revise";
  const stalled =
    input.execution.status === "interrupted" ||
    input.state === "paused" ||
    input.state === "provider-error" ||
    input.state === "stopped" ||
    input.state === "budget-exhausted";
  return { kind: stalled ? "stalled" : "working", actor, step };
}

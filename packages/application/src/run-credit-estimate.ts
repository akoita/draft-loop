import type { AgentRole } from "@draft-loop/domain";
import type { ModelProfileEffort, ModelProfileTier } from "@draft-loop/domain/model-profile";
import type { ModelProfileReferences } from "./model-profile-selection.js";
import { defaultModelProfileRegistry, type ModelProfileRegistry } from "./model-profiles.js";

/**
 * Credit estimate rule v2 (ADR 0011 D13): v1 priced by tier alone; v2 also doubles the base for a
 * high reasoning level. A reservation records this number so it stays attributable to the rule
 * that priced it when the rule changes.
 */
export const runCreditEstimateVersion = 2;

/** The reasoning levels that cost as much as a premium model. */
const highReasoningEfforts: readonly ModelProfileEffort[] = ["high", "xhigh", "max"];

/** Rounds covered by the base price; every further block of this many rounds adds the base. */
const roundsPerBlock = 2;

export interface RunCreditEstimateInput {
  readonly authorTier: ModelProfileTier;
  readonly criticTier: ModelProfileTier;
  /** The level each role runs at, when known; a missing level counts as not high. */
  readonly authorEffort?: ModelProfileEffort | undefined;
  readonly criticEffort?: ModelProfileEffort | undefined;
  /** The run's round limit: a positive integer. */
  readonly maxRounds: number;
}

/** How the estimate was priced: numbers and flags only, never material or model identities. */
export interface RunCreditEstimateBasis {
  /**
   * 1 credit for an economy or standard pair, 2 when the author or critic is premium or runs at
   * a high, extra high or max reasoning level.
   */
  readonly base: number;
  readonly premium: boolean;
  readonly highReasoning: boolean;
  /** Blocks of up to two rounds the limit spans (rounds 1-2 are block 1). */
  readonly roundBlocks: number;
}

export interface RunCreditEstimate {
  /** The most credits the run can need, estimated before it starts. */
  readonly credits: number;
  readonly version: typeof runCreditEstimateVersion;
  readonly basis: RunCreditEstimateBasis;
}

export class RunCreditEstimateError extends Error {
  readonly code = "invalid-max-rounds";
  constructor() {
    super("The round limit must be a positive integer.");
    this.name = "RunCreditEstimateError";
  }
}

/**
 * Prices a run before it starts, assuming it uses every allowed round: base 1 credit for up to
 * two rounds, doubled when the author or critic is premium or runs at a high reasoning level, plus
 * the base again for each further block of two rounds. Throws `RunCreditEstimateError` for a round limit that is not a positive
 * safe integer.
 */
export function estimateRunCredits(input: RunCreditEstimateInput): RunCreditEstimate {
  const { authorTier, criticTier, maxRounds } = input;
  if (!Number.isSafeInteger(maxRounds) || maxRounds <= 0) throw new RunCreditEstimateError();
  const premium = authorTier === "premium" || criticTier === "premium";
  const highReasoning = [input.authorEffort, input.criticEffort].some(
    (effort) => effort !== undefined && highReasoningEfforts.includes(effort),
  );
  const base = premium || highReasoning ? 2 : 1;
  const roundBlocks = Math.ceil(maxRounds / roundsPerBlock);
  return {
    credits: base * roundBlocks,
    version: runCreditEstimateVersion,
    basis: { base, premium, highReasoning, roundBlocks },
  };
}

export type RunCreditTierUnknownReason =
  /** The named profile is not registered, or not registered for that role. */
  | "unknown-profile"
  /** No profile pair is named and the configured model matches no registered profile. */
  | "no-matching-profile"
  /** No profile pair is named and the configured model matches profiles of different tiers. */
  | "ambiguous-tier";

export type RunCreditTiers =
  | {
      readonly status: "known";
      readonly authorTier: ModelProfileTier;
      readonly criticTier: ModelProfileTier;
      /** A named profile's level: the chosen one, else its own; unknown without a named pair. */
      readonly authorEffort?: ModelProfileEffort;
      readonly criticEffort?: ModelProfileEffort;
    }
  | {
      readonly status: "unknown";
      /** The first role whose tier could not be determined. */
      readonly role: AgentRole;
      readonly reason: RunCreditTierUnknownReason;
    };

export interface RunCreditTierInput {
  /**
   * The pair that applies to the run: the begin request's override, else the application's pair,
   * else the workspace's applied pair. Takes precedence over `configured` for both roles.
   */
  readonly modelProfiles?: ModelProfileReferences;
  /** The workspace's configured author and critic, used when no pair is named. */
  readonly configured?: {
    readonly author: { readonly company: string; readonly model: string };
    readonly critic: { readonly company: string; readonly model: string };
  };
  readonly registry?: ModelProfileRegistry;
}

type RoleTier =
  | { readonly tier: ModelProfileTier; readonly effort?: ModelProfileEffort }
  | { readonly reason: RunCreditTierUnknownReason };

function resolveRoleTier(
  role: AgentRole,
  input: RunCreditTierInput,
  registry: ModelProfileRegistry,
): RoleTier {
  const reference = input.modelProfiles?.[role];
  if (reference !== undefined) {
    try {
      const profile = registry.resolve(reference.id, reference.version, role);
      return { tier: profile.tier, effort: reference.effort ?? profile.runtime.effort };
    } catch {
      return { reason: "unknown-profile" };
    }
  }
  const model = input.configured?.[role];
  const tiers = new Set(
    model === undefined
      ? []
      : registry
          .list()
          .filter(
            (profile) =>
              profile.roles.includes(role) &&
              profile.provider === model.company &&
              profile.modelId === model.model,
          )
          .map((profile) => profile.tier),
  );
  const [only] = tiers;
  if (only === undefined) return { reason: "no-matching-profile" };
  return tiers.size > 1 ? { reason: "ambiguous-tier" } : { tier: only };
}

/**
 * Reads the author and critic tiers through the model profile registry that backs the catalog
 * (it also holds profiles the presets do not list, such as premium ones a run may name). A named
 * pair is resolved exactly. Without one, a configured company and model count only when every
 * registered profile for that role and model has the same tier. Anything else is reported as
 * `unknown` with a reason and never guessed, so the caller can refuse the run (the hosted API
 * answers that the tier cannot be priced) instead of pricing it at an assumed tier.
 */
export function resolveRunCreditTiers(input: RunCreditTierInput): RunCreditTiers {
  const registry = input.registry ?? defaultModelProfileRegistry;
  const author = resolveRoleTier("author", input, registry);
  if ("reason" in author) return { status: "unknown", role: "author", reason: author.reason };
  const critic = resolveRoleTier("critic", input, registry);
  if ("reason" in critic) return { status: "unknown", role: "critic", reason: critic.reason };
  return {
    status: "known",
    authorTier: author.tier,
    criticTier: critic.tier,
    ...(author.effort === undefined ? {} : { authorEffort: author.effort }),
    ...(critic.effort === undefined ? {} : { criticEffort: critic.effort }),
  };
}

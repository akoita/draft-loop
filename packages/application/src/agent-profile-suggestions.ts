/**
 * The career profile as an agent sees it, and the suggestions an agent files on it (#3072). An
 * agent reads the latest reviewed profile without the facts the person marked never-say, and
 * files a change that waits for a person. Accepting and rejecting stay with people. Errors carry
 * codes and one sentence, never a quote or a fact.
 */

import type {
  CanonicalCandidateProfile,
  CanonicalCandidateProfileFactCategory,
} from "@draft-loop/domain";
import {
  type FactSuggestion,
  type FactSuggestionChange,
  factSuggestionDedupeKey,
  factSuggestionSchemaVersion,
  factSuggestionTarget,
  isTargetedFactSuggestionKind,
} from "@draft-loop/domain/fact-suggestion";
import {
  type FactUsageLevel,
  type FactUsageSettings,
  resolveFactUsage,
} from "@draft-loop/domain/fact-usage";
import { screenTextWithRules } from "@draft-loop/ingestion/content-screening-rules";
import { containsSecretLikeContent } from "@draft-loop/schemas/work-journal";
import type { FactSuggestionStore } from "@draft-loop/storage/fact-suggestions";

import { profileVersionId } from "./review-edit-suggestions.js";

export interface AgentProfileFact {
  readonly id: string;
  readonly category: CanonicalCandidateProfileFactCategory;
  readonly subjectId?: string;
  readonly field: string;
  readonly value: string;
  /** `cv` or `interview-only`; a never-say fact is left out. */
  readonly usage: Exclude<FactUsageLevel, "never-say">;
}

export interface AgentProfileView {
  readonly profileId: string;
  readonly version: number;
  readonly reviewedAt?: string;
  readonly facts: readonly AgentProfileFact[];
  /** How many facts were left out because the person marked them never-say. */
  readonly withheld: number;
}

/** The newest reviewed version across the workspace's profiles, or undefined. */
export function latestReviewedProfile(
  profiles: readonly CanonicalCandidateProfile[],
): CanonicalCandidateProfile | undefined {
  let latest: CanonicalCandidateProfile | undefined;
  for (const profile of profiles) {
    if (profile.status !== "reviewed") continue;
    const at = profile.reviewedAt ?? profile.updatedAt;
    const best = latest === undefined ? undefined : (latest.reviewedAt ?? latest.updatedAt);
    if (best === undefined || at > best) latest = profile;
  }
  return latest;
}

/** The reviewed facts an agent may read: every one the person did not mark never-say. */
export function agentProfileView(
  profile: CanonicalCandidateProfile,
  usage: FactUsageSettings,
): AgentProfileView {
  const facts: AgentProfileFact[] = [];
  let withheld = 0;
  for (const fact of profile.facts) {
    const level = resolveFactUsage(usage, fact);
    if (level === "never-say") {
      withheld += 1;
      continue;
    }
    facts.push({
      id: fact.id,
      category: fact.category,
      ...(fact.subjectId === undefined ? {} : { subjectId: fact.subjectId }),
      field: fact.field,
      value: fact.value,
      usage: level,
    });
  }
  return {
    profileId: profile.id,
    version: profile.version,
    ...(profile.reviewedAt === undefined ? {} : { reviewedAt: profile.reviewedAt }),
    facts,
    withheld,
  };
}

export type AgentProfileSuggestionErrorCode =
  | "no_reviewed_profile"
  | "fact_not_found"
  | "target_required"
  | "target_not_allowed"
  | "secret_like_content"
  | "flagged_content"
  | "rate_limited";

export class AgentProfileSuggestionError extends Error {
  override readonly name = "AgentProfileSuggestionError";
  readonly code: AgentProfileSuggestionErrorCode;

  constructor(code: AgentProfileSuggestionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface AgentProfileSuggestionInput {
  /** The fact the change targets, from the profile the agent read; absent for an add. */
  readonly factId?: string;
  readonly change: FactSuggestionChange;
  /** The words behind the change, as the agent read them or the candidate said them. */
  readonly quote: string;
  /** `agent` when the agent read it somewhere, `candidate` when the candidate stated it. */
  readonly speaker: "agent" | "candidate";
}

export interface AgentProfileSuggestionLimits {
  /** Suggestions one agent token files in an hour. */
  readonly perHour: number;
  /** Pending suggestions a profile holds before agents must wait for the person. */
  readonly pendingPerProfile: number;
}

export const defaultAgentProfileSuggestionLimits: AgentProfileSuggestionLimits = Object.freeze({
  perHour: 20,
  pendingPerProfile: 100,
});

export type AgentProfileSuggestionStatus = "pending" | "duplicate" | "previously_rejected";

export interface AgentProfileSuggestionResult {
  readonly suggestionId: string;
  readonly status: AgentProfileSuggestionStatus;
  readonly message: string;
}

const refusals: Readonly<Record<AgentProfileSuggestionErrorCode, string>> = {
  no_reviewed_profile: "The candidate has no reviewed career profile yet.",
  fact_not_found: "No fact with that id in the reviewed profile; read it again with get_profile.",
  target_required: "A correct, retire, set-usage or confirm suggestion names its factId.",
  target_not_allowed: "An add suggestion names no factId.",
  secret_like_content:
    "The suggestion looks like it holds a key, token or password; remove it and send it again.",
  flagged_content: "The suggestion reads like instructions to a model; send only career facts.",
  rate_limited: "Too many suggestions; wait for the candidate to review the ones filed.",
};

function refuse(code: AgentProfileSuggestionErrorCode): never {
  throw new AgentProfileSuggestionError(code, refusals[code]);
}

function randomSuggestionId(): string {
  return `fsg_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

/** The text a suggestion carries, for the secret and injection checks. */
function suggestionText(input: AgentProfileSuggestionInput): string {
  const { change } = input;
  const parts = [input.quote];
  if (change.kind === "add") parts.push(change.field, change.value);
  if (change.kind === "correct") parts.push(change.value);
  return parts.join("\n");
}

/**
 * Files an agent's suggestion on the reviewed profile, pending a person's decision. The same
 * change filed again answers `duplicate`, and one the person rejected `previously_rejected`.
 */
export async function fileAgentProfileSuggestion(options: {
  readonly store: Pick<FactSuggestionStore, "insert" | "list" | "holderOfKey" | "countPending">;
  readonly workspaceId: string;
  readonly profile: CanonicalCandidateProfile | undefined;
  readonly usage: FactUsageSettings;
  readonly agentTokenId: string;
  readonly input: AgentProfileSuggestionInput;
  readonly limits?: AgentProfileSuggestionLimits;
  readonly now?: () => Date;
  readonly newId?: () => string;
}): Promise<AgentProfileSuggestionResult> {
  const { store, workspaceId, profile, input, agentTokenId } = options;
  const limits = options.limits ?? defaultAgentProfileSuggestionLimits;
  const now = (options.now ?? (() => new Date()))();
  if (profile === undefined) refuse("no_reviewed_profile");

  const targeted = isTargetedFactSuggestionKind(input.change.kind);
  if (targeted && input.factId === undefined) refuse("target_required");
  if (!targeted && input.factId !== undefined) refuse("target_not_allowed");
  // A never-say fact is not shown to agents, so it cannot be targeted either.
  const fact =
    input.factId === undefined
      ? undefined
      : profile.facts.find(
          (candidate) =>
            candidate.id === input.factId &&
            resolveFactUsage(options.usage, candidate) !== "never-say",
        );
  if (targeted && fact === undefined) refuse("fact_not_found");

  const text = suggestionText(input);
  if (containsSecretLikeContent(text)) refuse("secret_like_content");
  if (screenTextWithRules(text).length > 0) refuse("flagged_content");

  const target = fact === undefined ? undefined : factSuggestionTarget(fact);
  const dedupeKey = factSuggestionDedupeKey(input.change, target);
  const holder = await store.holderOfKey(workspaceId, profile.id, dedupeKey);
  if (holder !== undefined) {
    return holder.status === "rejected"
      ? {
          suggestionId: holder.id,
          status: "previously_rejected",
          message: "The candidate rejected this change before; do not suggest it again.",
        }
      : {
          suggestionId: holder.id,
          status: "duplicate",
          message: "The same change was suggested already.",
        };
  }

  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const recent = await store.list(workspaceId, { limit: limits.perHour + 1 });
  const filedThisHour = recent.filter(
    (suggestion) =>
      suggestion.origin.kind === "agent" &&
      suggestion.origin.agentClientId === agentTokenId &&
      suggestion.createdAt >= hourAgo,
  ).length;
  if (filedThisHour >= limits.perHour) refuse("rate_limited");
  if ((await store.countPending(workspaceId, profile.id)) >= limits.pendingPerProfile) {
    refuse("rate_limited");
  }

  const suggestion: FactSuggestion = {
    schemaVersion: factSuggestionSchemaVersion,
    id: (options.newId ?? randomSuggestionId)(),
    profileId: profile.id,
    baseVersionId: profileVersionId(profile),
    change: input.change,
    ...(target === undefined ? {} : { target }),
    quote: input.quote,
    speaker: input.speaker,
    origin: { kind: "agent", agentClientId: agentTokenId },
    dedupeKey,
    status: "pending",
    createdAt: now.toISOString(),
  };
  await store.insert(workspaceId, suggestion);
  return {
    suggestionId: suggestion.id,
    status: "pending",
    message: "Filed. It waits for the candidate on the Career profile page.",
  };
}

/** What an agent sees of a suggestion it filed: the change and its status, not who decided. */
export interface AgentProfileSuggestionListItem {
  readonly id: string;
  readonly factId?: string;
  readonly change: FactSuggestionChange;
  readonly status: FactSuggestion["status"];
  readonly createdAt: string;
}

/** The suggestions one agent token filed, newest first. */
export async function listAgentProfileSuggestions(options: {
  readonly store: Pick<FactSuggestionStore, "list">;
  readonly workspaceId: string;
  readonly agentTokenId: string;
  readonly limit: number;
}): Promise<readonly AgentProfileSuggestionListItem[]> {
  // Read a wider page, since other origins share the list; an agent files few at a time.
  const all = await options.store.list(options.workspaceId, { limit: 500 });
  return all
    .filter(
      (suggestion) =>
        suggestion.origin.kind === "agent" &&
        suggestion.origin.agentClientId === options.agentTokenId,
    )
    .slice(0, options.limit)
    .map((suggestion) => ({
      id: suggestion.id,
      ...(suggestion.target === undefined ? {} : { factId: suggestion.target.factId }),
      change: suggestion.change,
      status: suggestion.status,
      createdAt: suggestion.createdAt,
    }));
}

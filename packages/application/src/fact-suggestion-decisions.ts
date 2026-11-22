import {
  type CanonicalCandidateProfileFact,
  type CanonicalCandidateProfileFactProvenanceReference,
  maximumCanonicalCandidateProfileProvenanceCount,
} from "@draft-loop/domain";
import {
  type FactSuggestion,
  type FactSuggestionChange,
  type FactSuggestionDeciderRole,
  type FactSuggestionDecision,
  findFactSuggestionTarget,
  isFactSuggestionStale,
  maximumFactSuggestionBatch,
} from "@draft-loop/domain/fact-suggestion";
import { type FactUsageLevel, factUsageKey, fnv1a64 } from "@draft-loop/domain/fact-usage";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";
import type { FactSuggestionStore } from "@draft-loop/storage/fact-suggestions";

import type { CanonicalCandidateProfilePatch } from "./candidate-profile-persistence.js";

/**
 * Deciding fact suggestions (#3068): accepting writes what was said as a dated candidate-statement
 * source and saves one new profile version whose new or changed facts cite it. No derivation and
 * no model call. Rejecting records the decision, and the dedupe key keeps the suggestion from
 * coming back. This is how memory kind `fact-suggestion` reaches `candidate-facts`.
 *
 * Accepting counts as review: when the base version was reviewed, the new version is saved
 * reviewed too, since only the accepted changes differ. A suggestion whose target fact changed
 * since it was filed becomes `stale` instead of being applied.
 */

export type FactSuggestionDecisionErrorCode =
  /** No pending suggestion of this profile with that id. */
  | "suggestion_not_found"
  /** The edited change is not the same kind as the suggestion, or names an unknown fact. */
  | "invalid_edit"
  /** The batch is empty, too large or names a suggestion twice. */
  | "invalid_batch"
  /** The profile has no version to change. */
  | "profile_not_found";

export class FactSuggestionDecisionError extends Error {
  readonly code: FactSuggestionDecisionErrorCode;

  constructor(code: FactSuggestionDecisionErrorCode, message: string) {
    super(message);
    this.name = "FactSuggestionDecisionError";
    this.code = code;
  }
}

/** Where the statement source was saved, which the changed facts cite. */
export type CandidateStatementReference = Omit<
  CanonicalCandidateProfileFactProvenanceReference,
  "kind" | "quote"
>;

export interface CandidateStatementInput {
  readonly displayName: string;
  readonly markdown: string;
}

export interface FactSuggestionDecisionDependencies {
  readonly store: FactSuggestionStore;
  /** The profile's latest version, edits and review, already bound to the workspace. */
  readonly profile: {
    readonly latest: (
      profileId: string,
    ) => Promise<CanonicalCandidateProfileVersionRecord | undefined>;
    readonly edit: (
      profileId: string,
      expectedVersion: number,
      patch: CanonicalCandidateProfilePatch,
    ) => Promise<CanonicalCandidateProfileVersionRecord>;
    readonly review: (
      profileId: string,
      expectedVersion: number,
    ) => Promise<CanonicalCandidateProfileVersionRecord>;
  };
  /** Saves the statement as a Markdown knowledge source and returns its version. */
  readonly publishStatement: (
    input: CandidateStatementInput,
  ) => Promise<CandidateStatementReference>;
  /** Sets a fact's usage level by its content key. */
  readonly setFactUsage: (factKey: string, level: FactUsageLevel) => Promise<void>;
  /** A content-free record of the decision: ids, role and counts only. */
  readonly audit?: (event: FactSuggestionDecisionAudit) => Promise<void>;
  readonly now?: () => string;
  /** A new fact's id; random by default. */
  readonly generateFactId?: () => string;
}

export interface FactSuggestionDecisionAudit {
  readonly action: "accepted" | "rejected";
  readonly profileId: string;
  readonly suggestionIds: readonly string[];
  readonly deciderRole: FactSuggestionDeciderRole;
  readonly applied: number;
  readonly stale: number;
  /** The profile version the accepted changes were saved as, when any changed it. */
  readonly profileVersion?: number;
}

export interface FactSuggestionDecider {
  readonly role: FactSuggestionDeciderRole;
  readonly memberId: string;
}

export interface AcceptFactSuggestionsCommand {
  readonly workspaceId: string;
  readonly profileId: string;
  /** Each suggestion to accept; `edit` applies a changed version of it instead. */
  readonly items: readonly {
    readonly suggestionId: string;
    readonly edit?: FactSuggestionChange;
  }[];
  readonly decider: FactSuggestionDecider;
}

export interface AcceptFactSuggestionsResult {
  readonly applied: readonly string[];
  readonly stale: readonly string[];
  /** The saved profile version, absent when no accepted change touched the profile's facts. */
  readonly profile?: CanonicalCandidateProfileVersionRecord;
}

export interface RejectFactSuggestionCommand {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly suggestionId: string;
  readonly decider: FactSuggestionDecider;
}

const speakerLabels: Readonly<Record<FactSuggestion["speaker"], string>> = {
  candidate: "Candidate",
  coach: "Coach",
  agent: "Agent",
  system: "Redakloop",
};

/** One line, so the provenance quote matches the source text exactly. */
function quoteLine(quote: string): string {
  return quote.replace(/\s+/gu, " ").trim();
}

/**
 * The statement source for a batch: dated, speaker-labelled, one quote per accepted suggestion.
 * The same batch always renders the same bytes.
 */
export function renderCandidateStatement(
  suggestions: readonly FactSuggestion[],
  decidedAt: string,
): CandidateStatementInput {
  const day = decidedAt.slice(0, 10);
  const ids = suggestions.map((suggestion) => suggestion.id);
  const lines = [
    `# Candidate statement ${day}`,
    "",
    "What was said when these profile changes were accepted, in the speaker's words.",
  ];
  for (const suggestion of suggestions) {
    lines.push(
      "",
      `## ${speakerLabels[suggestion.speaker]}, ${suggestion.id}`,
      "",
      `> ${quoteLine(suggestion.quote)}`,
    );
  }
  return {
    displayName: `candidate-statement-${day}-${fnv1a64(ids.join("\u0000"))}.md`,
    markdown: `${lines.join("\n")}\n`,
  };
}

function randomFactId(): string {
  return `fact-suggested-${globalThis.crypto.randomUUID()}`;
}

function needsStatement(change: FactSuggestionChange): boolean {
  return change.kind === "add" || change.kind === "correct" || change.kind === "confirm";
}

export function createFactSuggestionDecisions(dependencies: FactSuggestionDecisionDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const generateFactId = dependencies.generateFactId ?? randomFactId;
  const { store } = dependencies;

  const requirePending = async (workspaceId: string, profileId: string, id: string) => {
    const suggestion = await store.get(workspaceId, id);
    if (
      suggestion === undefined ||
      suggestion.profileId !== profileId ||
      suggestion.status !== "pending"
    ) {
      throw new FactSuggestionDecisionError("suggestion_not_found", "No such pending suggestion.");
    }
    return suggestion;
  };

  const decision = (decider: FactSuggestionDecider, decidedAt: string): FactSuggestionDecision => ({
    role: decider.role,
    memberId: decider.memberId,
    decidedAt,
  });

  const accept = async (
    command: AcceptFactSuggestionsCommand,
  ): Promise<AcceptFactSuggestionsResult> => {
    const { workspaceId, profileId, items, decider } = command;
    const ids = items.map((item) => item.suggestionId);
    if (
      ids.length === 0 ||
      ids.length > maximumFactSuggestionBatch ||
      new Set(ids).size !== ids.length
    ) {
      throw new FactSuggestionDecisionError(
        "invalid_batch",
        "Accept one to 50 different suggestions.",
      );
    }
    const chosen: { suggestion: FactSuggestion; change: FactSuggestionChange; edited: boolean }[] =
      [];
    for (const item of items) {
      const suggestion = await requirePending(workspaceId, profileId, item.suggestionId);
      if (item.edit !== undefined && item.edit.kind !== suggestion.change.kind) {
        throw new FactSuggestionDecisionError(
          "invalid_edit",
          "An edit keeps the suggestion's kind.",
        );
      }
      chosen.push({
        suggestion,
        change: item.edit ?? suggestion.change,
        edited: item.edit !== undefined,
      });
    }
    const latest = await dependencies.profile.latest(profileId);
    if (latest === undefined) {
      throw new FactSuggestionDecisionError("profile_not_found", "The profile has no version yet.");
    }
    const decidedAt = now();
    const facts: CanonicalCandidateProfileFact[] = [...latest.profile.facts];
    const stale = chosen.filter(({ suggestion }) => isFactSuggestionStale(suggestion, facts));
    const live = chosen.filter((entry) => !stale.includes(entry));

    const statementNeeded = live.filter(({ change }) => needsStatement(change));
    const statement =
      statementNeeded.length === 0
        ? undefined
        : await dependencies.publishStatement(
            renderCandidateStatement(
              statementNeeded.map(({ suggestion }) => suggestion),
              decidedAt,
            ),
          );
    const cite = (suggestion: FactSuggestion): CanonicalCandidateProfileFactProvenanceReference => {
      if (statement === undefined) throw new Error("The statement was not saved.");
      return { ...statement, kind: "candidate-provided", quote: quoteLine(suggestion.quote) };
    };

    const retired = new Set<string>();
    let factsChanged = false;
    for (const { suggestion, change } of live) {
      if (change.kind === "add") {
        facts.push({
          id: generateFactId(),
          category: change.category,
          ...(change.subjectId === undefined ? {} : { subjectId: change.subjectId }),
          field: change.field,
          value: change.value,
          provenance: [cite(suggestion)],
        } as CanonicalCandidateProfileFact);
        factsChanged = true;
        continue;
      }
      const target =
        suggestion.target === undefined
          ? undefined
          : findFactSuggestionTarget(suggestion.target, facts);
      if (target === undefined) {
        throw new FactSuggestionDecisionError(
          "invalid_edit",
          "The suggestion's fact is ambiguous.",
        );
      }
      const index = facts.indexOf(target);
      switch (change.kind) {
        case "correct":
          facts[index] = { ...target, value: change.value, provenance: [cite(suggestion)] };
          factsChanged = true;
          break;
        case "confirm":
          // The newest citations stay when the profile's provenance bound is reached.
          facts[index] = {
            ...target,
            provenance: [
              ...target.provenance.slice(-(maximumCanonicalCandidateProfileProvenanceCount - 1)),
              cite(suggestion),
            ],
          };
          factsChanged = true;
          break;
        case "retire":
          retired.add(target.id);
          factsChanged = true;
          break;
        case "set-usage":
          await dependencies.setFactUsage(factUsageKey(target), change.usage);
          break;
      }
    }

    let saved: CanonicalCandidateProfileVersionRecord | undefined;
    if (factsChanged) {
      const kept = facts.filter((fact) => !retired.has(fact.id));
      const touchesIssues = latest.profile.issues.some((issue) =>
        issue.factIds.some((id) => retired.has(id)),
      );
      const patch = {
        facts: kept,
        ...(touchesIssues
          ? {
              issues: latest.profile.issues.map((issue) => ({
                ...issue,
                factIds: issue.factIds.filter((id) => !retired.has(id)),
              })),
            }
          : {}),
      } as unknown as CanonicalCandidateProfilePatch;
      saved = await dependencies.profile.edit(profileId, latest.profile.version, patch);
      if (latest.profile.status === "reviewed") {
        saved = await dependencies.profile.review(profileId, saved.profile.version);
      }
    }

    for (const { suggestion } of stale) {
      await store.decide(workspaceId, { ...suggestion, status: "stale" });
    }
    for (const { suggestion, change, edited } of live) {
      await store.decide(workspaceId, {
        ...suggestion,
        status: edited ? "edited" : "accepted",
        decision: decision(decider, decidedAt),
        ...(edited ? { appliedChange: change } : {}),
      });
    }
    await dependencies.audit?.({
      action: "accepted",
      profileId,
      suggestionIds: ids,
      deciderRole: decider.role,
      applied: live.length,
      stale: stale.length,
      ...(saved === undefined ? {} : { profileVersion: saved.profile.version }),
    });
    return {
      applied: live.map(({ suggestion }) => suggestion.id),
      stale: stale.map(({ suggestion }) => suggestion.id),
      ...(saved === undefined ? {} : { profile: saved }),
    };
  };

  const reject = async (command: RejectFactSuggestionCommand): Promise<void> => {
    const suggestion = await requirePending(
      command.workspaceId,
      command.profileId,
      command.suggestionId,
    );
    await store.decide(command.workspaceId, {
      ...suggestion,
      status: "rejected",
      decision: decision(command.decider, now()),
    });
    await dependencies.audit?.({
      action: "rejected",
      profileId: command.profileId,
      suggestionIds: [suggestion.id],
      deciderRole: command.decider.role,
      applied: 0,
      stale: 0,
    });
  };

  return { accept, reject };
}

export type FactSuggestionDecisions = ReturnType<typeof createFactSuggestionDecisions>;

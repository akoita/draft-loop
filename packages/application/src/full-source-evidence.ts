import { randomUUID } from "node:crypto";

import type {
  CandidateKnowledgeLexicalHit,
  ContextSnapshot,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import type { SqliteStorage } from "@draft-loop/storage";

import type { CandidateKnowledgeRetrievalResult } from "./knowledge-base.js";
import { legacyEvidencePreflightLine } from "./legacy-evidence-migration.js";
import {
  type RetrievalModeDecision,
  retrievalModePreflightLine,
} from "./run-semantic-retrieval.js";
import type { EvidenceMode } from "./workspace-evidence-mode.js";

/**
 * Full-source evidence: every eligible chunk of the selected knowledge sources goes to the author
 * and the critic instead of the composed top excerpts. Eligibility (sensitivity filtering) is
 * decided before this module sees a chunk, and evidence identifiers are unchanged, so citation
 * rules and the validator do not change. When the chunks do not fit the budget, the run falls back
 * to ordinary retrieval and the decision records why.
 */

/** Rough characters per token used to turn a context window into a character budget. */
const charactersPerToken = 4;
/** Share of the smaller context window evidence may use; the rest holds the prompt and the draft. */
const contextWindowShare = 0.5;
/** Used when either model's context window is unknown. */
export const defaultFullSourceBudgetCharacters = 240_000;

export type FullSourceFallbackReason = "budget-exceeded" | "no-eligible-chunks";

export interface EvidenceModeDecision {
  readonly requestedMode: EvidenceMode;
  readonly effectiveMode: EvidenceMode;
  /** Eligible chunks counted for full-source; zero when retrieval was requested. */
  readonly chunkCount: number;
  /** Serialized size of those chunks, the quantity compared with the budget. */
  readonly serializedCharacterCount: number;
  readonly budgetCharacters: number;
  readonly fallbackReason?: FullSourceFallbackReason;
}

export const retrievalEvidenceModeDecision: EvidenceModeDecision = Object.freeze({
  requestedMode: "retrieval",
  effectiveMode: "retrieval",
  chunkCount: 0,
  serializedCharacterCount: 0,
  budgetCharacters: 0,
});

/** Half of the smaller known context window, at four characters a token, else the default. */
export function fullSourceBudgetCharacters(
  modelConfiguration: Pick<ContextSnapshot["modelConfiguration"], "author" | "critic">,
): number {
  const windows = [modelConfiguration.author, modelConfiguration.critic].map(
    (selection) => selection.profile?.knownLimits.contextWindowTokens,
  );
  if (windows.some((tokens) => tokens === undefined)) return defaultFullSourceBudgetCharacters;
  return Math.floor(Math.min(...(windows as number[])) * charactersPerToken * contextWindowShare);
}

/** Decide whether the eligible evidence fits the budget; the caller supplies the serialized form. */
export function decideFullSourceEvidence(
  evidence: readonly ScoredEvidenceChunk[],
  budgetCharacters: number,
): EvidenceModeDecision {
  const serializedCharacterCount = JSON.stringify(evidence).length;
  const base = {
    requestedMode: "full-source",
    chunkCount: evidence.length,
    serializedCharacterCount,
    budgetCharacters,
  } as const;
  if (evidence.length === 0) {
    return { ...base, effectiveMode: "retrieval", fallbackReason: "no-eligible-chunks" };
  }
  if (serializedCharacterCount > budgetCharacters) {
    return { ...base, effectiveMode: "retrieval", fallbackReason: "budget-exceeded" };
  }
  return { ...base, effectiveMode: "full-source" };
}

export function evidenceModePreflightLine(decision: EvidenceModeDecision): string {
  const size = `${decision.chunkCount} eligible chunks, ${decision.serializedCharacterCount} of ${decision.budgetCharacters} characters`;
  if (decision.effectiveMode === "full-source") {
    return `Evidence mode: full-source (${size})`;
  }
  return `Evidence mode: full-source requested, using retrieval because ${
    decision.fallbackReason === "no-eligible-chunks"
      ? "no eligible chunks were found"
      : "the eligible evidence exceeds the budget"
  } (${size})`;
}

export interface EvidenceModeRetrieval {
  readonly evidenceModeDecision: () => Promise<EvidenceModeDecision>;
  /** Present only when the workspace retrieval mode is semantic or hybrid. */
  readonly retrievalModeDecision?: () => Promise<RetrievalModeDecision | undefined>;
}

/**
 * Show the evidence mode in the transmission preflight and keep it in run history as an audit
 * event. Retrieval mode, the default, adds neither a line nor an event. A semantic or hybrid
 * retrieval mode adds its own line and `run.retrieval-mode` event, whether or not it could be used.
 */
export async function announceRunEvidenceMode(
  storage: Pick<SqliteStorage, "appendAuditEvent">,
  retrieval: EvidenceModeRetrieval | undefined,
  workspaceId: string,
  runId: string,
  write: (line: string) => void,
): Promise<void> {
  if (retrieval === undefined) {
    write(legacyEvidencePreflightLine);
    return;
  }
  const decision = await retrieval.evidenceModeDecision();
  if (decision.requestedMode === "full-source") {
    await announceEvidenceMode(storage, decision, workspaceId, runId, write);
  }
  const retrievalMode = await retrieval.retrievalModeDecision?.();
  if (retrievalMode === undefined || retrievalMode.requestedMode === "lexical") return;
  write(retrievalModePreflightLine(retrievalMode));
  await storage.appendAuditEvent({
    id: `retrieval-mode:${runId}:${randomUUID()}`,
    workspaceId,
    eventType: "run.retrieval-mode",
    entityType: "run",
    entityId: runId,
    payload: {
      requestedMode: retrievalMode.requestedMode,
      effectiveMode: retrievalMode.effectiveMode,
      tier: retrievalMode.tier,
      embeddedChunkCount: retrievalMode.embeddedChunkCount,
      ...(retrievalMode.reason === undefined ? {} : { reason: retrievalMode.reason }),
      ...(retrievalMode.modelId === undefined ? {} : { modelId: retrievalMode.modelId }),
      ...(retrievalMode.revision === undefined ? {} : { revision: retrievalMode.revision }),
    },
    createdAt: new Date().toISOString(),
  });
}

async function announceEvidenceMode(
  storage: Pick<SqliteStorage, "appendAuditEvent">,
  decision: EvidenceModeDecision,
  workspaceId: string,
  runId: string,
  write: (line: string) => void,
): Promise<void> {
  write(evidenceModePreflightLine(decision));
  await storage.appendAuditEvent({
    id: `evidence-mode:${runId}:${randomUUID()}`,
    workspaceId,
    eventType: "run.evidence-mode",
    entityType: "run",
    entityId: runId,
    payload: {
      requestedMode: decision.requestedMode,
      effectiveMode: decision.effectiveMode,
      chunkCount: decision.chunkCount,
      serializedCharacterCount: decision.serializedCharacterCount,
      budgetCharacters: decision.budgetCharacters,
      ...(decision.fallbackReason === undefined ? {} : { fallbackReason: decision.fallbackReason }),
    },
    createdAt: new Date().toISOString(),
  });
}

/** The run's retrieval summary line for a full-source run; no query ran, so there are no traces. */
export function fullSourceInspectionResult(
  hits: readonly CandidateKnowledgeLexicalHit[],
): CandidateKnowledgeRetrievalResult {
  return Object.freeze({
    status: "matched",
    indexedChunkCount: hits.length,
    selectedChunkCount: hits.length,
    selectedSourceCount: new Set(hits.map((hit) => JSON.stringify(hit.metadata.provenance))).size,
    hits: Object.freeze([...hits]),
    diagnostics: Object.freeze([]),
  });
}

import { resolve } from "node:path";

import type { ContextSnapshot, IndependentReviewRecord } from "@draft-loop/domain";
import { createStorageRunStore, type RunSnapshot, reviewFindingId } from "@draft-loop/orchestrator";
import { contextSnapshotSchema, type DraftArtifact } from "@draft-loop/schemas";
import type { DecisionRecord } from "@draft-loop/storage";

import type { FindingDecision } from "./index.js";
import { readWorkspace } from "./local.js";
import { storageFactory } from "./local-storage-factory.js";
import { runRequirementTexts } from "./run-context-read.js";

export interface RunReviewCommand {
  readonly root: string;
  readonly runId: string;
}

export interface RunReviewBlock {
  readonly id: string;
  readonly type: string;
  /** The candidate's latest edit of the block when there is one, else the author's text. */
  readonly text: string;
  readonly edited: boolean;
  readonly claimIds: readonly string[];
}

export interface RunReviewSection {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly blocks: readonly RunReviewBlock[];
}

export interface RunReviewClaim {
  readonly id: string;
  readonly text: string;
  readonly status: string;
  readonly substantive: boolean;
  readonly evidence: readonly {
    readonly sourcePath: string;
    readonly locator?: string;
    readonly excerpt: string;
  }[];
}

export interface RunReviewDraft {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly sections: readonly RunReviewSection[];
  readonly claims: readonly RunReviewClaim[];
}

export interface RunReviewFinding {
  /** The id a finding decision names; scoped to the reviewed draft. */
  readonly id: string;
  readonly code: string;
  readonly category: string;
  readonly severity: string;
  readonly message: string;
  /** The candidate's latest decision; `pending` until they make one. */
  readonly decision: FindingDecision;
  readonly claimId?: string;
  readonly sectionId?: string;
  readonly requirement?: { readonly id: string; readonly text?: string };
}

export interface RunReviewReadiness {
  readonly status: string;
  readonly ready: boolean;
  readonly stopReason: string;
  readonly scores: readonly {
    readonly dimension: string;
    readonly score: number;
    readonly threshold: number;
    readonly meets: boolean;
  }[];
}

/** What the last approval attempt found: the final CV checks that block approving as it stands. */
export interface RunReviewApprovalCheck {
  readonly applicationReady: boolean;
  readonly blockers: readonly string[];
}

/** Everything a person needs to review a run, as the desktop's review screen shows it. */
export interface RunReview {
  readonly snapshot: RunSnapshot;
  readonly draft: RunReviewDraft | null;
  readonly findings: readonly RunReviewFinding[];
  readonly independentReview: IndependentReviewRecord | null;
  readonly readiness: RunReviewReadiness | null;
  readonly approvalCheck: RunReviewApprovalCheck | null;
  readonly candidateDirection: string | null;
}

const findingDecisions: ReadonlySet<string> = new Set([
  "pending",
  "accepted",
  "rejected",
  "deferred",
  "overridden",
]);

interface RecordedReviewChoices {
  readonly decisions: ReadonlyMap<string, FindingDecision>;
  readonly edits: ReadonlyMap<string, string>;
}

/** The candidate's latest decision per finding and edit per block, from the run's decisions. */
function recordedChoices(records: readonly DecisionRecord[]): RecordedReviewChoices {
  const decisions = new Map<string, FindingDecision>();
  const edits = new Map<string, string>();
  const ordered = [...records].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const { payload } of ordered) {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
    const { action, findingId, decision, blockId, replacementText } = payload as Readonly<
      Record<string, unknown>
    >;
    if (
      action === "finding-decision" &&
      typeof findingId === "string" &&
      typeof decision === "string" &&
      findingDecisions.has(decision)
    ) {
      decisions.set(findingId, decision as FindingDecision);
    }
    if (
      action === "edit-block" &&
      typeof blockId === "string" &&
      typeof replacementText === "string"
    )
      edits.set(blockId, replacementText);
  }
  return { decisions, edits };
}

function reviewDraft(artifact: DraftArtifact, edits: ReadonlyMap<string, string>): RunReviewDraft {
  return {
    id: artifact.id,
    version: artifact.version,
    createdAt: artifact.createdAt,
    sections: [...artifact.sections]
      .sort((left, right) => left.order - right.order)
      .map((section) => ({
        id: section.id,
        title: section.title,
        kind: section.kind,
        blocks: section.blocks.map((block) => {
          const edit = edits.get(block.id);
          return {
            id: block.id,
            type: block.type,
            text: edit ?? block.text,
            edited: edit !== undefined,
            claimIds: [...block.claimIds],
          };
        }),
      })),
    claims: artifact.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      status: claim.status,
      substantive: claim.substantive,
      evidence: claim.evidence.map(({ sourcePath, locator, excerpt }) => ({
        sourcePath,
        ...(locator === undefined ? {} : { locator }),
        excerpt,
      })),
    })),
  };
}

function reviewReadiness(snapshot: RunSnapshot): RunReviewReadiness | null {
  const evaluation = snapshot.latestEvaluation;
  if (evaluation === null) return null;
  return {
    status: evaluation.status,
    ready: evaluation.ready,
    stopReason: evaluation.stopReason,
    scores: evaluation.thresholdResults.map(({ dimension, score, threshold, meets }) => ({
      dimension,
      score,
      threshold,
      meets,
    })),
  };
}

/**
 * The review of one run: its draft with the candidate's edits, its findings with their decisions,
 * and what readiness and independence it recorded. Resolves to `undefined` for an unknown run.
 * Reads only; it never drives the run.
 */
export async function readRunReview(command: RunReviewCommand): Promise<RunReview | undefined> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const storage = await storageFactory().open(root);
  try {
    const snapshot = await createStorageRunStore(storage).loadRun(command.runId);
    if (snapshot === undefined || snapshot.workspaceId !== config.id) return undefined;
    const contextRecord = await storage.getContextSnapshot(snapshot.contextSnapshotId);
    const context =
      contextRecord === undefined
        ? undefined
        : (contextSnapshotSchema.parse(contextRecord.payload) as unknown as ContextSnapshot);
    const requirementTexts = new Map(
      context === undefined ? [] : runRequirementTexts(context).map(({ id, text }) => [id, text]),
    );
    const { decisions, edits } = recordedChoices(await storage.listDecisions(snapshot.runId));
    const findings = snapshot.findings.map((finding, index): RunReviewFinding => {
      const id = reviewFindingId(snapshot, snapshot.artifact, index, finding.code);
      const requirementText =
        finding.requirementId === undefined
          ? undefined
          : requirementTexts.get(finding.requirementId);
      return {
        id,
        code: finding.code,
        category: finding.category ?? "quality",
        severity: finding.severity,
        message: finding.message,
        decision: decisions.get(id) ?? "pending",
        ...(finding.claimId === undefined ? {} : { claimId: finding.claimId }),
        ...(finding.sectionId === undefined ? {} : { sectionId: finding.sectionId }),
        ...(finding.requirementId === undefined
          ? {}
          : {
              requirement: {
                id: finding.requirementId,
                ...(requirementText === undefined ? {} : { text: requirementText }),
              },
            }),
      };
    });
    const readinessDecision = snapshot.readinessDecision ?? null;
    return {
      snapshot,
      draft: snapshot.artifact === null ? null : reviewDraft(snapshot.artifact, edits),
      findings,
      independentReview: context?.modelConfiguration.independentReview ?? null,
      readiness: reviewReadiness(snapshot),
      approvalCheck:
        readinessDecision === null
          ? null
          : {
              applicationReady: readinessDecision.applicationReady,
              blockers: readinessDecision.blockers.map(({ code }) => code),
            },
      candidateDirection: snapshot.candidateDirection?.text ?? null,
    };
  } finally {
    await storage.close();
  }
}

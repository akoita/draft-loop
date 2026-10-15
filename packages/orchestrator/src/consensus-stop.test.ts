import type { ReadinessEvaluation } from "@draft-loop/evaluations";
import type { ClassifiedFinding, DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  assessConsensus,
  blockingFindingIdentities,
  type ConsensusInput,
  findingDecisionsFromPayloads,
  reviewFindingId,
} from "./consensus-stop.js";

const artifact = {
  id: "artifact-2",
  version: 2,
  sections: [
    {
      id: "section-summary",
      kind: "summary",
      blocks: [{ id: "block-1", type: "paragraph", text: "A", claimIds: ["claim-1"] }],
    },
  ],
  claims: [{ id: "claim-1", blockId: "block-1" }],
} as unknown as DraftArtifact;

const claimFinding = (code: string, severity: "error" | "warning" = "error") => ({
  code,
  severity,
  message: "A finding.",
  claimId: "claim-1",
});

function evaluation(
  overrides: Partial<ReadinessEvaluation> & { readonly round: number },
): ReadinessEvaluation {
  const findings = overrides.findings ?? [];
  const blocked = findings.some(({ severity }) => severity === "error");
  return {
    findings,
    ready: !blocked,
    stopReason: blocked ? "blocked-findings" : "ready",
    ...overrides,
  } as ReadinessEvaluation;
}

function classification(findings: readonly Partial<ClassifiedFinding>[]) {
  return {
    schemaVersion: 1,
    reviewedArtifact: { id: "artifact-2", version: 2 },
    findings: findings.map((finding, index) => ({
      findingId: `finding-${index}`,
      severity: "error",
      ...finding,
    })),
    summary: { resolved: 0, persisting: 0, new: 0 },
  } as never;
}

const consensus = (
  current: ReadinessEvaluation,
  input: Omit<ConsensusInput, "runId" | "findings"> &
    Partial<Pick<ConsensusInput, "runId" | "findings">>,
) => assessConsensus(current, { runId: "run-1", findings: current.findings, ...input });

describe("assessConsensus", () => {
  const identity = "weak-claim|claim|summary#0/b0";

  it("names blocking identities by code, target kind and block position", () => {
    expect(
      blockingFindingIdentities(
        evaluation({
          round: 2,
          findings: [claimFinding("Weak_Claim"), claimFinding("warning-only", "warning")],
        }),
        artifact,
      ),
    ).toEqual([identity]);
  });

  it("pauses on an exact identity that blocked the previous round", () => {
    const previous = evaluation({ round: 1, blockingFindingIdentities: [identity] });
    const result = consensus(evaluation({ round: 2, findings: [claimFinding("weak-claim")] }), {
      artifact,
      previousEvaluation: previous,
    });

    expect(result.persisting).toEqual([identity]);
    expect(result.evaluation).toMatchObject({
      stopReason: "persisting-findings",
      persistingFindingIdentities: [identity],
    });
  });

  it("does not pause on a near-miss, such as a block that moved", () => {
    const previous = evaluation({
      round: 1,
      blockingFindingIdentities: ["weak-claim|claim|summary#0/b1"],
    });
    const result = consensus(evaluation({ round: 2, findings: [claimFinding("weak-claim")] }), {
      artifact,
      previousEvaluation: previous,
    });

    expect(result.persisting).toEqual([]);
    expect(result.evaluation.stopReason).toBe("blocked-findings");
  });

  it("ignores a previous evaluation that is not the round before", () => {
    const previous = evaluation({ round: 1, blockingFindingIdentities: [identity] });
    const result = consensus(evaluation({ round: 3, findings: [claimFinding("weak-claim")] }), {
      artifact,
      previousEvaluation: previous,
    });

    expect(result.persisting).toEqual([]);
  });

  it("counts only accepted persisting findings once the round was adjudicated", () => {
    const previous = evaluation({ round: 1, blockingFindingIdentities: [identity] });
    const current = evaluation({ round: 2, findings: [claimFinding("weak-claim")] });

    // The candidate rejected the finding, so its recurrence is a preserved disagreement.
    expect(
      consensus(current, {
        artifact,
        previousEvaluation: previous,
        classification: classification([]),
      }).persisting,
    ).toEqual([]);
    expect(
      consensus(current, {
        artifact,
        previousEvaluation: previous,
        classification: classification([{ status: "persisting", findingIdentity: identity }]),
      }),
    ).toMatchObject({ persisting: [identity], evaluation: { stopReason: "persisting-findings" } });
  });

  it("stops with consensus-ready when a ready draft resolved the previous blocking findings", () => {
    const previous = evaluation({ round: 1, blockingFindingIdentities: [identity] });

    expect(
      consensus(evaluation({ round: 2 }), { artifact, previousEvaluation: previous }).evaluation
        .stopReason,
    ).toBe("consensus-ready");
    expect(
      consensus(evaluation({ round: 2 }), {
        artifact,
        previousEvaluation: previous,
        classification: classification([{ status: "resolved", findingIdentity: identity }]),
      }).evaluation.stopReason,
    ).toBe("consensus-ready");
  });

  it("keeps ready when no blocking finding was resolved, and never overrides other reasons", () => {
    expect(
      consensus(evaluation({ round: 1 }), { artifact, previousEvaluation: null }).evaluation
        .stopReason,
    ).toBe("ready");
    expect(
      consensus(evaluation({ round: 2, stopReason: "stable-convergence", ready: false }), {
        artifact,
        previousEvaluation: evaluation({ round: 1, blockingFindingIdentities: [identity] }),
      }).evaluation.stopReason,
    ).toBe("stable-convergence");
  });
  describe("the candidate's decision sticks", () => {
    const previousFindingId = "run-1:finding:scope:0:weak-claim";
    const previous = evaluation({
      round: 1,
      blockingFindingIdentities: [identity],
      blockingFindingRefs: [{ identity, findingId: previousFindingId }],
    });
    const current = (round: number) =>
      evaluation({ round, findings: [claimFinding("weak-claim")] });

    it.each(["rejected", "overridden", "deferred"])(
      "does not pause on a %s finding that recurs",
      (decision) => {
        const result = consensus(current(2), {
          artifact,
          previousEvaluation: previous,
          decisions: [{ findingId: previousFindingId, decision }],
        });

        expect(result.persisting).toEqual([]);
        expect(result.evaluation).toMatchObject({
          stopReason: "blocked-findings",
          settledFindingIdentities: [identity],
        });
      },
    );

    it("keeps the decision for the rounds after it", () => {
      const settled = consensus(current(2), {
        artifact,
        previousEvaluation: previous,
        decisions: [{ findingId: previousFindingId, decision: "overridden" }],
      }).evaluation;

      // No new decision in round 3: the identity stays settled.
      expect(consensus(current(3), { artifact, previousEvaluation: settled }).persisting).toEqual(
        [],
      );
    });

    it("pauses on an accepted finding that persists, and on an undecided one", () => {
      for (const decisions of [
        [{ findingId: previousFindingId, decision: "accepted" }],
        [{ findingId: previousFindingId, decision: "pending" }],
        [],
      ]) {
        expect(
          consensus(current(2), { artifact, previousEvaluation: previous, decisions }).persisting,
        ).toEqual([identity]);
      }
    });

    it("lets the latest decision win, so accepting an overridden finding counts again", () => {
      const settled = consensus(current(2), {
        artifact,
        previousEvaluation: previous,
        decisions: [{ findingId: previousFindingId, decision: "overridden" }],
      }).evaluation;
      const refs = settled.blockingFindingRefs ?? [];
      const reAccepted = consensus(current(3), {
        artifact,
        previousEvaluation: settled,
        decisions: [
          { findingId: previousFindingId, decision: "overridden" },
          ...refs.map(({ findingId }) => ({ findingId, decision: "accepted" })),
        ],
      });

      expect(reAccepted.persisting).toEqual([identity]);
    });
  });
});

describe("finding decision ids", () => {
  it("scopes the review's finding id to the reviewed artifact", () => {
    const run = { runId: "run-1", round: 2 };
    const id = reviewFindingId(run, { id: "artifact-2" }, 3, "weak-claim");

    expect(id).toMatch(/^run-1:finding:[0-9a-f]{16}:3:weak-claim$/u);
    expect(reviewFindingId(run, { id: "artifact-3" }, 3, "weak-claim")).not.toBe(id);
    expect(reviewFindingId(run, null, 3, "weak-claim")).toMatch(/^run-1:finding:[0-9a-f]{16}:3:/u);
  });

  it("reads finding decisions out of stored decision payloads and skips the rest", () => {
    expect(
      findingDecisionsFromPayloads([
        { action: "finding-decision", findingId: "f-1", decision: "overridden" },
        { action: "edit-block", blockId: "b-1", replacementText: "x" },
        { action: "finding-decision", findingId: 7, decision: "accepted" },
        null,
      ]),
    ).toEqual([{ findingId: "f-1", decision: "overridden" }]);
  });
});

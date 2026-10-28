import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CANDIDATE_EDIT_VERSION_SUFFIX } from "@draft-loop/orchestrator";
import type { DecisionRecord } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { createLocalApplicationDriver } from "./local.js";
import { recordedReviewEdits } from "./recorded-review-choices.js";

const silent = { write: () => undefined };

function editRecord(
  artifactId: string,
  blockId: string,
  replacementText: string,
  createdAt: string,
): DecisionRecord {
  return {
    id: `decision-${createdAt}`,
    workspaceId: "workspace-1",
    runId: "run-1",
    roundId: "run-1:round:1",
    artifactId,
    type: "edit",
    rationale: "Candidate edited an artifact block in the desktop review.",
    actor: "user:desktop",
    createdAt,
    payload: { action: "edit-block", blockId, replacementText },
    checksum: "a".repeat(64),
  };
}

describe("recorded review edits", () => {
  it("takes the latest edit per block of the artifact under review only", () => {
    const records = [
      editRecord("artifact-2", "block-1", "Second wording.", "2026-10-28T10:00:02.000Z"),
      editRecord("artifact-2", "block-1", "First wording.", "2026-10-28T10:00:01.000Z"),
      editRecord("artifact-1", "block-2", "From an earlier version.", "2026-10-28T09:00:00.000Z"),
    ];

    expect(recordedReviewEdits(records, "artifact-2")).toEqual([
      { blockId: "block-1", text: "Second wording." },
    ]);
  });
});

describe("approval with review edits", () => {
  it("approves the version carrying the candidate's edit", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-approval-edits-"));
    try {
      await mkdir(join(root, "evidence"));
      await writeFile(join(root, "job.md"), "TypeScript engineer");
      await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.");
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true, maxRounds: 3 },
        silent,
      );
      const started = await driver.start({ root, allowProviderData: false }, silent);
      expect(started.state).toBe("awaiting-approval");
      const reviewed = started.artifact;
      const block = reviewed?.sections[0]?.blocks[0];
      if (reviewed === null || reviewed === undefined || block === undefined)
        throw new Error("The fixture run has no draft.");
      const replacementText = `${block.text} Edited by the candidate.`;

      await driver.recordReviewDecision({
        root,
        runId: started.runId,
        kind: "edit",
        targetId: block.id,
        replacementText,
      });
      const approved = await driver.lifecycle(
        {
          root,
          runId: started.runId,
          action: "approve",
          readinessOverrideRationale: "Synthetic fixture draft.",
        },
        silent,
      );

      expect(approved.state).toBe("approved");
      expect(approved.artifact).toMatchObject({
        id: `${reviewed.id}${CANDIDATE_EDIT_VERSION_SUFFIX}`,
        version: reviewed.version + 1,
        parentVersionId: reviewed.id,
      });
      expect(approved.artifact?.sections[0]?.blocks[0]?.text).toBe(replacementText);
      expect(approved.approvedArtifact?.id).toBe(approved.artifact?.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

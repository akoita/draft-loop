import { describe, expect, it } from "vitest";

import { evidenceUsageLines } from "./evidence-usage-lines.js";

describe("evidenceUsageLines", () => {
  it("words each call's counts and uncited ranks without any content", () => {
    expect(
      evidenceUsageLines({
        runId: "run-1",
        calls: [
          {
            executionId: "run-1:round:1:author:attempt:1",
            round: 1,
            step: "author",
            sent: 12,
            cited: 7,
            uncitedRanks: [3, 8, 9, 10, 11],
            claimsOutsideRetrieval: 2,
            claimsWithoutEvidence: 0,
          },
          {
            executionId: "run-1:round:2:revision:attempt:1",
            round: 2,
            step: "revision",
            sent: 1,
            cited: 1,
            uncitedRanks: [],
            claimsOutsideRetrieval: 1,
            claimsWithoutEvidence: 1,
          },
        ],
      }),
    ).toEqual([
      "Run run-1: evidence usage",
      "round 1 author: 12 chunks sent, 7 cited; uncited ranks 3, 8, 9, 10, 11; 2 claims outside the retrieved evidence, 0 without evidence",
      "round 2 revision: 1 chunk sent, 1 cited; 1 claim outside the retrieved evidence, 1 without evidence",
    ]);
  });

  it("says when nothing was recorded", () => {
    expect(evidenceUsageLines(undefined)).toEqual(["No run recorded."]);
    expect(evidenceUsageLines({ runId: "run-0", calls: [] })).toEqual([
      "Run run-0: no author call recorded the evidence it was sent (a run before this recording, or one without retrieval).",
    ]);
  });
});

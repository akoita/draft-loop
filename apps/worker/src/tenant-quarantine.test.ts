import type { RunJob } from "@draft-loop/run-queue";
import type { ContentScreeningStatus } from "@draft-loop/storage/content-screening";
import { describe, expect, it } from "vitest";

import { tenantRunQuarantine } from "./tenant-quarantine.js";

const job = {
  tenantId: "org-north",
  workspaceId: "record-1",
  runId: "run-1",
} as unknown as RunJob;

const posting = { kind: "job-source", workspaceId: "history-1", briefId: "brief-1" } as const;

const flagged: ContentScreeningStatus = {
  id: "screening-1",
  subject: { ...posting, sourceId: "posting" },
  result: {
    verdict: "flagged",
    signals: ["instruction-override"],
    screeners: [{ id: "rules", version: "1" }],
    screenedAt: "2026-10-24T10:00:00.000Z",
  },
  recordedAt: "2026-10-24T10:00:00.000Z",
  quarantined: true,
};

/** A run on a brief with two sources; `results` are the statuses the store holds for it. */
function check(options: {
  readonly requireScreening: boolean;
  readonly results: readonly ContentScreeningStatus[];
}) {
  const storage = {
    contentScreening: {
      quarantined: async () => options.results.filter(({ quarantined }) => quarantined),
      listForRecord: async () => options.results,
      listForKnowledgeBase: async () => [],
    },
  };
  return tenantRunQuarantine({
    tenancy: { forTenant: () => storage as never },
    serviceFor: () =>
      ({
        readRunInputs: async () => ({ brief: { briefId: "brief-1", version: 1 } }),
        getOpportunity: async () => ({
          workspaceId: "history-1",
          brief: { id: "brief-1", sources: [{ id: "posting" }, { id: "notes" }] },
        }),
        readWorkspace: async () => ({}),
      }) as never,
    workspaceRoot: () => "root",
    requireScreening: options.requireScreening,
  })(job);
}

describe("a job's quarantined run material", () => {
  it("holds a source with no stored result while screening is on, by kind and code only", async () => {
    const held = await check({
      requireScreening: true,
      results: [
        { ...flagged, quarantined: false, result: { ...flagged.result, verdict: "clear" } },
      ],
    });

    expect(held).toEqual([{ kind: "job-source", signals: ["unscreened"] }]);
  });

  it("does not hold a source with no stored result while screening is off", async () => {
    expect(await check({ requireScreening: false, results: [] })).toEqual([]);
  });

  it("lists quarantined results before unscreened material, and holds a flagged one in any mode", async () => {
    const results = [flagged];
    const withScreening = await check({ requireScreening: true, results });

    expect(withScreening).toEqual([
      { kind: "job-source", resultId: "screening-1", signals: ["instruction-override"] },
      { kind: "job-source", signals: ["unscreened"] },
    ]);
    expect(await check({ requireScreening: false, results })).toEqual([withScreening[0]]);
  });
});

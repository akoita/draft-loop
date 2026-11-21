import type { QualityInsightRow } from "@draft-loop/storage-postgres";
import { describe, expect, it, vi } from "vitest";

import { sweepQualityDigest } from "./quality-digest-sweep.js";

const now = new Date("2026-11-17T06:10:00.000Z");

describe("the daily quality digest sweep (#2916)", () => {
  it("builds yesterday's digest across active organisations, stores it and logs it", async () => {
    const save = vi.fn(async () => undefined);
    const spansBetween = vi.fn(async (organisationId: string) => [
      {
        runId: `${organisationId}-run`,
        name: "invoke_agent" as const,
        status: "error" as const,
        attributes: { "draftloop.step": "author", "error.type": "provider-error" },
      },
    ]);
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    const saved: QualityInsightRow[] = [];

    const digest = await sweepQualityDigest(
      {
        claimDay: async () => true,
        save,
        digestsBetween: async () => [],
        organisationsActiveSince: async () => ["org-a", "org-b"],
        spansBetween,
        listInsights: async () => saved,
        saveInsights: async (insights) => {
          saved.push(...insights);
        },
        log: (message, fields) => lines.push({ message, fields }),
      },
      { now },
    );

    const from = new Date("2026-11-16T00:00:00.000Z");
    const to = new Date("2026-11-17T00:00:00.000Z");
    expect(spansBetween).toHaveBeenCalledWith("org-a", from, to);
    expect(spansBetween).toHaveBeenCalledWith("org-b", from, to);
    expect(digest).toMatchObject({ day: "2026-11-16", organisations: 2, runs: 2 });
    expect(digest?.failures[0]).toMatchObject({ errorType: "provider-error", count: 2 });
    expect(save).toHaveBeenCalledWith("2026-11-16", digest);
    const insightKey = "failure:author:unknown:provider-error:none";
    expect(lines).toEqual([
      {
        message: "quality digest",
        fields: { ...digest, trend: { through: "2026-11-16", pairs: [] } },
      },
      {
        message: "quality insights",
        fields: {
          day: "2026-11-16",
          changes: [{ key: insightKey, from: null, to: "new" }],
          open: [expect.objectContaining({ key: insightKey, status: "new", occurrences: 2 })],
        },
      },
    ]);
  });

  it("does nothing when another start already claimed the day", async () => {
    const organisationsActiveSince = vi.fn(async () => []);
    const log = vi.fn();
    await expect(
      sweepQualityDigest(
        {
          claimDay: async () => false,
          save: async () => undefined,
          digestsBetween: async () => [],
          organisationsActiveSince,
          spansBetween: async () => [],
          listInsights: async () => [],
          saveInsights: async () => undefined,
          log,
        },
        { now },
      ),
    ).resolves.toBeUndefined();
    expect(organisationsActiveSince).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("reports a week whose drafts fell against the week before, as an insight (#3240)", async () => {
    const pair = (ready: number) => ({
      authorModel: "claude-haiku-5-5",
      criticModel: "gpt-terra",
      runs: 10,
      ready,
      readinessSum: 8,
      readinessRuns: 10,
      uncoveredSum: 0,
      errorFindingsSum: 0,
      estimatedUsd: 1,
    });
    const quality = (ready: number) => ({
      runs: 10,
      ready,
      estimatedUsd: 1,
      costPerReadyDraft: null,
      pairs: [pair(ready)],
    });
    const digestsBetween = vi.fn(async () => [
      { day: "2026-11-05", digest: { quality: quality(9) } },
      { day: "2026-11-12", digest: { quality: quality(4) } },
      { day: "2026-11-01", digest: {} },
    ]);
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    await sweepQualityDigest(
      {
        claimDay: async () => true,
        save: async () => undefined,
        digestsBetween,
        organisationsActiveSince: async () => [],
        spansBetween: async () => [],
        listInsights: async () => [],
        saveInsights: async () => undefined,
        log: (message, fields) => lines.push({ message, fields }),
      },
      { now },
    );
    expect(digestsBetween).toHaveBeenCalledWith("2026-11-03", "2026-11-16");
    expect(lines[0]?.fields.trend).toMatchObject({
      pairs: [
        {
          current: { runs: 10, readyRate: 0.4 },
          previous: { runs: 10, readyRate: 0.9 },
          drops: ["ready-rate"],
        },
      ],
    });
    expect(lines[1]?.fields.changes).toEqual([
      { key: "quality-drop:ready-rate:claude-haiku-5-5:gpt-terra", from: null, to: "new" },
    ]);
  });
});

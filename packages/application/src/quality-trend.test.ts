import { describe, expect, it } from "vitest";

import { digestQuality, minimumTrendRuns, qualityTrend } from "./quality-trend.js";

const evaluated = (attributes: Record<string, string | number | boolean>) => ({
  name: "evaluate_run" as const,
  attributes: {
    "draftloop.quality.author_model": "claude-haiku-5-5",
    "gen_ai.request.model": "gpt-terra",
    ...attributes,
  },
});

describe("digestQuality", () => {
  it("sums one day's evaluated runs by model pair and prices a ready draft", () => {
    const quality = digestQuality([
      evaluated({
        "draftloop.quality.ready": true,
        "draftloop.quality.readiness": 0.8,
        "draftloop.quality.uncovered": 1,
        "draftloop.quality.error_findings": 0,
        "draftloop.estimated_usd": 0.3,
      }),
      evaluated({ "draftloop.quality.ready": false, "draftloop.estimated_usd": 0.1 }),
      evaluated({ "gen_ai.request.model": "claude-sonnet-5-5", "draftloop.quality.ready": true }),
      { name: "invoke_agent" as const, attributes: { "draftloop.estimated_usd": 5 } },
    ]);
    expect(quality).toEqual({
      runs: 3,
      ready: 2,
      estimatedUsd: 0.4,
      costPerReadyDraft: 0.2,
      pairs: [
        {
          authorModel: "claude-haiku-5-5",
          criticModel: "gpt-terra",
          runs: 2,
          ready: 1,
          readinessSum: 0.8,
          readinessRuns: 1,
          uncoveredSum: 1,
          errorFindingsSum: 0,
          estimatedUsd: 0.4,
        },
        {
          authorModel: "claude-haiku-5-5",
          criticModel: "claude-sonnet-5-5",
          runs: 1,
          ready: 1,
          readinessSum: 0,
          readinessRuns: 0,
          uncoveredSum: 0,
          errorFindingsSum: 0,
          estimatedUsd: 0,
        },
      ],
    });
  });

  it("is empty on a day with no evaluated run", () => {
    expect(digestQuality([])).toEqual({
      runs: 0,
      ready: 0,
      estimatedUsd: 0,
      costPerReadyDraft: null,
      pairs: [],
    });
  });
});

describe("qualityTrend", () => {
  const day = (date: string, runs: number, ready: number, readiness: number) => ({
    day: date,
    quality: digestQuality(
      Array.from({ length: runs }, (_, index) =>
        evaluated({
          "draftloop.quality.ready": index < ready,
          "draftloop.quality.readiness": readiness,
        }),
      ),
    ),
  });

  it("flags a pair whose ready rate and readiness fell more than 5% week over week", () => {
    const trend = qualityTrend("2026-11-16", [
      day("2026-11-03", 10, 9, 0.8),
      day("2026-11-10", 10, 5, 0.7),
      day("2026-11-16", 2, 1, 0.7),
      day("2026-10-30", 50, 0, 0),
    ]);
    expect(trend.pairs).toEqual([
      expect.objectContaining({
        current: expect.objectContaining({ runs: 12, readyRate: 0.5, readiness: 0.7 }),
        previous: expect.objectContaining({ runs: 10, readyRate: 0.9, readiness: 0.8 }),
        drops: ["ready-rate", "readiness"],
      }),
    ]);
  });

  it("stays quiet with too few runs, a small change or old digests without quality", () => {
    const few = minimumTrendRuns - 1;
    expect(
      qualityTrend("2026-11-16", [day("2026-11-03", few, few, 0.9), day("2026-11-10", few, 0, 0.1)])
        .pairs[0]?.drops,
    ).toEqual([]);
    expect(
      qualityTrend("2026-11-16", [day("2026-11-03", 10, 9, 0.8), day("2026-11-10", 10, 9, 0.78)])
        .pairs[0]?.drops,
    ).toEqual([]);
    expect(
      qualityTrend("2026-11-16", [
        { day: "2026-11-10" },
        { day: "2026-11-11", quality: { pairs: "corrupt" } as never },
      ]).pairs,
    ).toEqual([]);
  });
});

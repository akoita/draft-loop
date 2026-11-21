import { describe, expect, it } from "vitest";

import {
  type DigestLatency,
  digestLatency,
  latencyTrend,
  maximumDigestLatencies,
} from "./latency-trend.js";
import { buildQualityDigest } from "./quality-digest.js";
import { insightObservations } from "./quality-insights.js";

const agent = (model: string, durationMs: number | null, step = "author") => ({
  runId: "run-1",
  name: "invoke_agent" as const,
  status: "ok" as const,
  attributes: { "draftloop.step": step, "gen_ai.request.model": model },
  durationMs,
});

describe("digestLatency", () => {
  it("reports p50 and p95 per operation, step and model", () => {
    const spans = [
      ...Array.from({ length: 20 }, (_, index) => agent("claude-haiku-5-5", (index + 1) * 100)),
      agent("gpt-terra", 900, "critic"),
      agent("gpt-terra", null, "critic"),
      { ...agent("x", 5), name: "evaluate_run" as const },
      {
        runId: "run-1",
        name: "retrieve_evidence" as const,
        status: "ok" as const,
        attributes: {},
        durationMs: 40,
      },
    ];
    expect(digestLatency(spans)).toEqual([
      {
        operation: "invoke_agent",
        step: "author",
        model: "claude-haiku-5-5",
        spans: 20,
        p50Ms: 1000,
        p95Ms: 1900,
      },
      {
        operation: "invoke_agent",
        step: "critic",
        model: "gpt-terra",
        spans: 1,
        p50Ms: 900,
        p95Ms: 900,
      },
      {
        operation: "retrieve_evidence",
        step: "none",
        model: "none",
        spans: 1,
        p50Ms: 40,
        p95Ms: 40,
      },
    ]);
  });

  it("caps the rows it lists", () => {
    const spans = Array.from({ length: maximumDigestLatencies + 3 }, (_, index) =>
      agent(`model-${index}`, 10),
    );
    expect(digestLatency(spans)).toHaveLength(maximumDigestLatencies);
  });

  it("is part of the daily digest", () => {
    const digest = buildQualityDigest({
      day: "2026-11-21",
      organisations: 1,
      spans: [agent("claude-haiku-5-5", 1200)],
    });
    expect(digest.latency).toEqual([
      expect.objectContaining({ model: "claude-haiku-5-5", p95Ms: 1200 }),
    ]);
  });
});

describe("latencyTrend", () => {
  const row = (p95Ms: number, spans = 5): DigestLatency => ({
    operation: "invoke_agent",
    step: "author",
    model: "claude-haiku-5-5",
    spans,
    p50Ms: p95Ms / 2,
    p95Ms,
  });
  const days = (current: number, previous: number) => [
    ...["2026-11-21", "2026-11-20"].map((day) => ({ day, latency: [row(current)] })),
    ...["2026-11-13", "2026-11-12"].map((day) => ({ day, latency: [row(previous)] })),
    { day: "2026-11-11" },
  ];

  it("flags a weekly p95 rise above the threshold and logs it as a pattern", () => {
    const trend = latencyTrend("2026-11-21", days(13_000, 10_000));
    expect(trend.rows).toEqual([
      expect.objectContaining({
        current: { spans: 10, p95Ms: 13_000 },
        previous: { spans: 10, p95Ms: 10_000 },
        rose: true,
      }),
    ]);
    const digest = buildQualityDigest({ day: "2026-11-21", organisations: 0, spans: [] });
    expect(insightObservations(digest, undefined, trend)).toContainEqual({
      key: "latency-rise:invoke_agent:author:claude-haiku-5-5",
      occurrences: 10,
      runIds: [],
    });
  });

  it("ignores a small rise, too few spans and days outside the two weeks", () => {
    expect(latencyTrend("2026-11-21", days(12_000, 10_000)).rows[0]?.rose).toBe(false);
    const few = [
      { day: "2026-11-21", latency: [row(20_000, 3)] },
      { day: "2026-11-13", latency: [row(10_000, 3)] },
    ];
    expect(latencyTrend("2026-11-21", few).rows[0]?.rose).toBe(false);
    expect(latencyTrend("2026-11-21", [{ day: "2026-11-01", latency: [row(1)] }]).rows).toEqual([]);
  });
});

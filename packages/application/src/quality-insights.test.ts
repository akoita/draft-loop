import { describe, expect, it } from "vitest";

import { buildQualityDigest } from "./quality-digest.js";
import {
  insightObservations,
  nextQualityInsights,
  type QualityInsight,
} from "./quality-insights.js";

const outputLimit = insightObservations(
  buildQualityDigest({
    day: "2026-11-16",
    organisations: 1,
    spans: [
      {
        runId: "run-1",
        name: "invoke_agent",
        status: "error",
        attributes: {
          "draftloop.step": "author",
          "gen_ai.request.model": "economy-author",
          "error.type": "invalid-response",
          "draftloop.failure_reason": "max_tokens",
        },
      },
    ],
  }),
);
const key = "failure:author:economy-author:invalid-response:max_tokens";

const insight = (overrides: Partial<QualityInsight>): QualityInsight => ({
  key,
  firstSeen: "2026-11-10",
  lastSeen: "2026-11-10",
  daysSeen: 1,
  occurrences: 1,
  runIds: [],
  status: "new",
  issue: null,
  ...overrides,
});

describe("the quality insight ledger (#2917)", () => {
  it("keys a failure by its mechanism", () => {
    expect(outputLimit).toEqual([{ key, occurrences: 1, runIds: ["run-1"] }]);
  });

  it("records a first sighting as new and a later one as recurring", () => {
    const first = nextQualityInsights({
      day: "2026-11-16",
      existing: [],
      observations: outputLimit,
      dismissals: [],
    });
    expect(first.changes).toEqual([{ key, from: null, to: "new" }]);
    expect(first.insights[0]).toMatchObject({
      firstSeen: "2026-11-16",
      daysSeen: 1,
      runIds: ["run-1"],
    });

    const second = nextQualityInsights({
      day: "2026-11-17",
      existing: first.insights,
      observations: outputLimit,
      dismissals: [],
    });
    expect(second.changes).toEqual([{ key, from: "new", to: "recurring" }]);
    expect(second.insights[0]).toMatchObject({
      firstSeen: "2026-11-16",
      daysSeen: 2,
      occurrences: 2,
    });
  });

  it("resolves a pattern unseen for 14 days and reopens it as recurring", () => {
    const quiet = nextQualityInsights({
      day: "2026-11-24",
      existing: [insight({ status: "recurring" })],
      observations: [],
      dismissals: [],
    });
    expect(quiet.changes).toEqual([{ key, from: "recurring", to: "resolved" }]);

    const back = nextQualityInsights({
      day: "2026-11-25",
      existing: quiet.insights,
      observations: outputLimit,
      dismissals: [],
    });
    expect(back.changes).toEqual([{ key, from: "resolved", to: "recurring" }]);
  });

  it("leaves a recent pattern alone on a quiet day", () => {
    const quiet = nextQualityInsights({
      day: "2026-11-20",
      existing: [insight({ status: "recurring" })],
      observations: [],
      dismissals: [],
    });
    expect(quiet).toEqual({ insights: [], changes: [] });
  });

  it("keeps a dismissed pattern dismissed and links its issue", () => {
    const dismissed = nextQualityInsights({
      day: "2026-11-16",
      existing: [insight({ status: "recurring" })],
      observations: outputLimit,
      dismissals: [{ key, reason: "Tracked by an issue.", issue: 2873 }],
    });
    expect(dismissed.changes).toEqual([{ key, from: "recurring", to: "dismissed" }]);
    expect(dismissed.insights[0]).toMatchObject({ status: "dismissed", issue: 2873 });
  });
});

import { noCoverLetterUse } from "@draft-loop/application/quality-digest";
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
        outcomesBetween: async () => ({ events: [], runPairs: [] }),
        feedbackNotesBetween: async () => 0,
        coverLetterUseBetween: async () => noCoverLetterUse,
        coverLetterChecksBetween: async () => 0,
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
        fields: {
          ...digest,
          trend: {
            through: "2026-11-16",
            pairs: [],
            feedbackNotes: { current: 0, previous: 0 },
          },
          latencyTrend: { through: "2026-11-16", rows: [] },
        },
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
          outcomesBetween: async () => ({ events: [], runPairs: [] }),
          feedbackNotesBetween: async () => 0,
          coverLetterUseBetween: async () => noCoverLetterUse,
          coverLetterChecksBetween: async () => 0,
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
        outcomesBetween: async () => ({ events: [], runPairs: [] }),
        feedbackNotesBetween: async () => 0,
        coverLetterUseBetween: async () => noCoverLetterUse,
        coverLetterChecksBetween: async () => 0,
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

  it("counts what members did with their drafts by model pair, next to the ready rate (#3245)", async () => {
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    const outcomesBetween = vi.fn(async (organisationId: string) => ({
      events: [
        { runId: `${organisationId}-run`, kind: "finding-accepted" as const },
        { runId: `${organisationId}-run`, kind: "finding-rejected" as const },
        { runId: `${organisationId}-run`, kind: "exported" as const },
        { runId: "run-without-evaluation", kind: "stopped" as const },
      ],
      runPairs: [
        {
          runId: `${organisationId}-run`,
          authorModel: "claude-haiku-5-5",
          criticModel: "gpt-terra",
        },
      ],
    }));
    const digest = await sweepQualityDigest(
      {
        claimDay: async () => true,
        save: async () => undefined,
        digestsBetween: async () => [
          // A day stored before outcomes counts as a day without any.
          { day: "2026-11-15", digest: {} },
          {
            day: "2026-11-08",
            digest: {
              outcomes: {
                feedbackNotes: 2,
                pairs: [
                  {
                    authorModel: "claude-haiku-5-5",
                    criticModel: "gpt-terra",
                    findingsAccepted: 1,
                    findingsRejected: 3,
                    exported: 0,
                    refunded: 1,
                    stopped: 0,
                  },
                ],
              },
            },
          },
        ],
        organisationsActiveSince: async () => ["org-a", "org-b"],
        spansBetween: async () => [],
        outcomesBetween,
        feedbackNotesBetween: async () => 3,
        coverLetterUseBetween: async () => noCoverLetterUse,
        coverLetterChecksBetween: async () => 0,
        listInsights: async () => [],
        saveInsights: async () => undefined,
        log: (message, fields) => lines.push({ message, fields }),
      },
      { now },
    );

    expect(outcomesBetween).toHaveBeenCalledWith(
      "org-b",
      new Date("2026-11-16T00:00:00.000Z"),
      new Date("2026-11-17T00:00:00.000Z"),
    );
    expect(digest?.outcomes).toEqual({
      feedbackNotes: 3,
      pairs: [
        {
          authorModel: "claude-haiku-5-5",
          criticModel: "gpt-terra",
          findingsAccepted: 2,
          findingsRejected: 2,
          exported: 2,
          refunded: 0,
          stopped: 0,
        },
        {
          authorModel: "unknown",
          criticModel: "unknown",
          findingsAccepted: 0,
          findingsRejected: 0,
          exported: 0,
          refunded: 0,
          stopped: 2,
        },
      ],
    });
    // Counts only: no run id reaches the digest's outcomes or its log line.
    expect(JSON.stringify(digest?.outcomes)).not.toContain("run");
    const trend = lines[0]?.fields.trend as {
      pairs: { authorModel: string; outcomes: unknown }[];
      feedbackNotes: unknown;
    };
    expect(trend.feedbackNotes).toEqual({ current: 3, previous: 2 });
    expect(trend.pairs.find((pair) => pair.authorModel === "claude-haiku-5-5")?.outcomes).toEqual({
      current: {
        findingsAccepted: 2,
        findingsRejected: 2,
        exported: 2,
        refunded: 0,
        stopped: 0,
        acceptRate: 0.5,
      },
      previous: {
        findingsAccepted: 1,
        findingsRejected: 3,
        exported: 0,
        refunded: 1,
        stopped: 0,
        acceptRate: 0.25,
      },
    });
  });

  it("adds up cover letter help across organisations, with the edited share (#3282)", async () => {
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    const coverLetterUseBetween = vi.fn(async (organisationId: string) =>
      organisationId === "org-a"
        ? { kits: 2, fullDrafts: 1, letters: 3, editedLetters: 2 }
        : { kits: 1, fullDrafts: 0, letters: 1, editedLetters: 0 },
    );
    const coverLetterChecksBetween = vi.fn(async () => 5);
    const digest = await sweepQualityDigest(
      {
        claimDay: async () => true,
        save: async () => undefined,
        digestsBetween: async () => [],
        organisationsActiveSince: async () => ["org-a", "org-b"],
        spansBetween: async () => [],
        outcomesBetween: async () => ({ events: [], runPairs: [] }),
        feedbackNotesBetween: async () => 0,
        coverLetterUseBetween,
        coverLetterChecksBetween,
        listInsights: async () => [],
        saveInsights: async () => undefined,
        log: (message, fields) => lines.push({ message, fields }),
      },
      { now },
    );

    const from = new Date("2026-11-16T00:00:00.000Z");
    const to = new Date("2026-11-17T00:00:00.000Z");
    expect(coverLetterUseBetween).toHaveBeenCalledWith("org-b", from, to);
    expect(coverLetterChecksBetween).toHaveBeenCalledWith(from, to);
    const expected = {
      kits: 3,
      fullDrafts: 1,
      letters: 4,
      editedLetters: 2,
      checks: 5,
      editedShare: 0.5,
    };
    expect(digest?.coverLetters).toEqual(expected);
    expect(lines[0]?.fields.coverLetters).toEqual(expected);
  });
});

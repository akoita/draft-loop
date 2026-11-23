import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { LiveResult } from "./eval-live.js";
import {
  addPromptScore,
  checkPromptScores,
  type PromptScoreEntry,
  type PromptScorePair,
  parsePromptScoreManifest,
  promptScoreEntryFromLiveResult,
  type ScoredPromptEntry,
} from "./prompt-scores.js";

const pair = (author: string, critic = "cli-critic-v12"): PromptScorePair => ({
  author: { modelId: "claude-haiku-5-5", promptTemplateVersion: author },
  critic: { modelId: "gpt-6-luna", promptTemplateVersion: critic },
});

const scored = (
  author: string,
  failRates: ScoredPromptEntry["failRates"],
  extra: Partial<ScoredPromptEntry> = {},
): ScoredPromptEntry => ({
  status: "scored",
  ...pair(author),
  recordedAt: "2026-11-22T06:00:00.000Z",
  label: author,
  commit: "abc12345",
  judge: { version: "cohort-judge-v1", model: "gpt-6-luna" },
  fixtureSet: { cases: ["case-nurse", "case-sales"], rounds: 8 },
  costUsd: 0.39,
  costCapUsd: 1,
  failRates,
  ...extra,
});

const manifest = (...entries: PromptScoreEntry[]) => ({ schemaVersion: 1, entries });
const today = "2026-11-23";

describe("prompt score gate", () => {
  const v21 = scored("cli-author-v21", { "placeholder-left": 0.25, "unsupported-claim": 0 });

  it("fails a prompt version bump that has no score entry, and says how to record one", () => {
    const check = checkPromptScores({
      manifest: manifest(v21),
      current: pair("cli-author-v22"),
      today,
    });
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toContain("no score for the pair a new run uses");
    expect(check.problems[0]).toContain("cli-author-v22");
    expect(check.problems[0]).toContain("pnpm eval:scores:record");
  });

  it("fails a default model change that has no score entry", () => {
    const current = { ...pair("cli-author-v21"), critic: { ...v21.critic, modelId: "gpt-7" } };
    expect(checkPromptScores({ manifest: manifest(v21), current, today }).ok).toBe(false);
  });

  it("passes a prompt version bump with a score entry", () => {
    const v22 = scored("cli-author-v22", { "placeholder-left": 0, "unsupported-claim": 0 });
    const check = checkPromptScores({
      manifest: manifest(v21, v22),
      current: pair("cli-author-v22"),
      today,
    });
    expect(check).toMatchObject({ ok: true, problems: [] });
    expect(check.notes[0]).toContain('scored "cli-author-v22"');
  });

  it("fails a fail-rate rise past one round's worth without a written reason", () => {
    const worse = scored("cli-author-v22", { "placeholder-left": 0.5, "unsupported-claim": 0 });
    const check = checkPromptScores({
      manifest: manifest(v21, worse),
      current: pair("cli-author-v22"),
      today,
    });
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toContain("placeholder-left 25% -> 50%");
    expect(check.problems[0]).toContain('"reason"');
  });

  it("passes the same rise with a written reason, and a one-round rise without one", () => {
    const explained = scored(
      "cli-author-v22",
      { "placeholder-left": 0.5 },
      { reason: "The new placeholders are a judge false alarm, read by hand." },
    );
    expect(
      checkPromptScores({
        manifest: manifest(v21, explained),
        current: pair("cli-author-v22"),
        today,
      }).ok,
    ).toBe(true);
    const noise = scored("cli-author-v22", { "placeholder-left": 0.375 });
    expect(
      checkPromptScores({ manifest: manifest(v21, noise), current: pair("cli-author-v22"), today })
        .ok,
    ).toBe(true);
  });

  it("compares only with an earlier score on the same judge and cases", () => {
    const otherCases = scored(
      "cli-author-v22",
      { "placeholder-left": 1 },
      { fixtureSet: { cases: ["case-teacher"], rounds: 4 } },
    );
    expect(
      checkPromptScores({
        manifest: manifest(v21, otherCases),
        current: pair("cli-author-v22"),
        today,
      }).ok,
    ).toBe(true);
  });

  describe("waivers", () => {
    const waiver = (until: string, reason = "Paid run pending."): PromptScoreEntry => ({
      status: "waived",
      ...pair("cli-author-v22"),
      recordedAt: "2026-11-23",
      until,
      reason,
    });

    it("accepts a waiver with a reason until its date", () => {
      const check = checkPromptScores({
        manifest: manifest(v21, waiver("2026-12-07")),
        current: pair("cli-author-v22"),
        today: "2026-12-07",
      });
      expect(check.ok).toBe(true);
      expect(check.notes[0]).toContain("waived until 2026-12-07");
    });

    it("fails a waiver past its date", () => {
      const check = checkPromptScores({
        manifest: manifest(v21, waiver("2026-12-07")),
        current: pair("cli-author-v22"),
        today: "2026-12-08",
      });
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toContain("ended on 2026-12-07");
    });

    it("fails a waiver without a reason or running past 31 days", () => {
      expect(
        checkPromptScores({
          manifest: manifest(v21, waiver("2026-12-07", " ")),
          current: pair("cli-author-v22"),
          today,
        }).problems,
      ).toEqual(["entry 2: a waiver needs a written reason"]);
      expect(
        checkPromptScores({
          manifest: manifest(v21, waiver("2027-01-31")),
          current: pair("cli-author-v22"),
          today,
        }).problems[0],
      ).toContain("past 31 days");
    });

    it("is replaced when the pair's score is recorded", () => {
      const v22 = scored("cli-author-v22", { "placeholder-left": 0 });
      const parsed = parsePromptScoreManifest(manifest(v21, waiver("2026-12-07")));
      if (parsed.manifest === null) throw new Error("fixture manifest is invalid");
      const updated = addPromptScore(parsed.manifest, v22);
      expect(updated.entries.map((entry) => entry.status)).toEqual(["scored", "scored"]);
      expect(() => addPromptScore(updated, v22)).toThrow("already in the manifest");
    });
  });

  it("rejects a malformed manifest", () => {
    expect(checkPromptScores({ manifest: { entries: [] }, current: pair("v"), today }).ok).toBe(
      false,
    );
    expect(
      parsePromptScoreManifest(manifest({ ...v21, status: "maybe" } as never)).problems,
    ).toEqual(['entry 1: status must be "scored" or "waived"']);
  });

  it("builds an entry from an eval:live result", () => {
    const result: LiveResult = {
      recordedAt: "2026-11-24T10:00:00.000Z",
      label: "v22-after",
      commit: "def67890",
      models: pair("cli-author-v22"),
      judge: { version: "cohort-judge-v1", model: "gpt-6-luna" },
      cases: ["case-nurse"],
      rounds: 2,
      costUsd: 0.1,
      costCapUsd: 1,
      failRates: { "no-draft": 0 },
    };
    expect(promptScoreEntryFromLiveResult(result, { costCapUsd: 1 })).toMatchObject({
      status: "scored",
      author: { promptTemplateVersion: "cli-author-v22" },
      fixtureSet: { cases: ["case-nurse"], rounds: 2 },
      costUsd: 0.1,
      costCapUsd: 1,
    });
  });

  it("keeps the recorded manifest valid and its scores without an unexplained rise", () => {
    const recorded = JSON.parse(
      readFileSync(new URL("../prompt-scores.json", import.meta.url), "utf8"),
    ) as { entries: PromptScoreEntry[] };
    const scoredPair = recorded.entries.find((entry) => entry.status === "scored");
    if (scoredPair === undefined) throw new Error("the manifest holds no score");
    // Checked against a scored pair so the test does not depend on today's date or waivers.
    const check = checkPromptScores({ manifest: recorded, current: scoredPair, today });
    expect(check.problems).toEqual([]);
  });
});

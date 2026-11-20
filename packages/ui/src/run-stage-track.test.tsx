import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createFixtureReviewState, type ReviewScreenState } from "./model.js";
import { RunStageTrack } from "./run-stage-track.js";
import { runStageTrack } from "./run-stage-track-model.js";

const fixture = createFixtureReviewState();
const models = { author: "claude-haiku-5-5", critic: "gpt-6-luna" };
const idle = { ...fixture.execution, status: "idle" as const, step: null };

function track(overrides: Partial<ReviewScreenState>) {
  const state = { ...fixture, execution: idle, ...overrides };
  return runStageTrack({ ...state, models });
}

describe("runStageTrack", () => {
  it("gives round 1 to the author's draft and the critic's critique", () => {
    const result = track({ state: "drafting", round: 1 });
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.steps.map((step) => [step.kind, step.actor, step.status])).toEqual([
      ["draft", "author", "active"],
      ["critique", "critic", "waiting"],
    ]);
    expect(result.gate).toBe("waiting");
    expect(result.now).toEqual({ kind: "working", actor: "author", step: "draft" });
  });

  it("makes each later round the author's revision then a critique", () => {
    const result = track({ state: "revising", round: 2 });
    expect(result.rounds.map((round) => round.steps.map((step) => step.status))).toEqual([
      ["done", "done"],
      ["active", "waiting"],
    ]);
    expect(result.rounds[1]?.steps[0]?.kind).toBe("revise");
    expect(result.now).toEqual({ kind: "working", actor: "author", step: "revise" });
  });

  it("hands the gate to the person once the critique is done", () => {
    const result = track({ state: "awaiting-approval", round: 2 });
    expect(result.rounds[1]?.steps.map((step) => step.status)).toEqual(["done", "done"]);
    expect(result.gate).toBe("active");
    expect(result.now).toEqual({ kind: "deciding" });
    expect(track({ state: "approved", round: 2 }).gate).toBe("done");
  });

  it("folds every round but the last two", () => {
    expect(track({ state: "reviewing", round: 2 }).foldedRounds).toBe(0);
    expect(track({ state: "reviewing", round: 4 }).foldedRounds).toBe(2);
  });

  it("names the earlier critic on rounds before a fallback", () => {
    const result = track({
      state: "awaiting-approval",
      round: 4,
      criticFallback: {
        fromProvider: "openai",
        fromModel: "gpt-6-luna",
        toProvider: "anthropic",
        toModel: "claude-sonnet-5-5",
        errorClass: "quota-exhausted",
        round: 3,
        sameCompanyAsAuthor: true,
      },
    });
    expect(result.cast.critic).toBe("claude-sonnet-5-5");
    expect(result.rounds.map((round) => round.steps[1]?.model ?? null)).toEqual([
      "gpt-6-luna",
      "gpt-6-luna",
      null,
      null,
    ]);
    expect(result.rounds.map((round) => round.criticChanged)).toEqual([false, false, true, false]);
  });

  it("reads a paused critique as stalled, not working", () => {
    const result = track({
      state: "paused",
      round: 1,
      execution: { ...idle, status: "interrupted", step: "critic" },
    });
    expect(result.now).toEqual({ kind: "stalled", actor: "critic", step: "critique" });
  });
});

describe("RunStageTrack", () => {
  const revising: ReviewScreenState = {
    ...fixture,
    state: "revising",
    round: 2,
    execution: { ...idle, status: "running", step: "revision" },
    applicationRuns: [
      {
        runId: fixture.runId,
        startedAt: "2026-11-20T10:00:00.000Z",
        authorModel: "claude-haiku-5-5",
        criticModel: "gpt-6-luna",
        round: 2,
        state: "revising",
        latest: true,
      },
    ],
  };

  it("tags every step with its actor and marks the running one", () => {
    const html = renderToStaticMarkup(<RunStageTrack state={revising} />);
    expect(html).toContain("is revising the draft · round 2");
    expect(html).toContain(
      'class="stage-step stage-step-author stage-step-active" aria-current="step"',
    );
    expect(html).toContain("stage-step stage-step-critic stage-step-waiting");
    expect(html).toContain("Your gate");
    expect(html).toContain("GPT-6 Luna");
  });

  it("names roles without models when the run recorded none", () => {
    const html = renderToStaticMarkup(
      <RunStageTrack state={{ ...revising, applicationRuns: null }} />,
    );
    expect(html).toContain("Author is revising the draft · round 2");
  });
});

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

describe("RunStageTrack with many rounds", () => {
  const many: ReviewScreenState = {
    ...fixture,
    state: "awaiting-approval",
    round: 18,
    execution: idle,
  };

  it("keeps the folded chip and the phone bar the same size however many rounds there are", () => {
    const html = renderToStaticMarkup(<RunStageTrack state={many} />);
    expect(html).toContain("Rounds 1–16");
    expect(html.match(/stage-dot stage-dot-author/g)).toHaveLength(1);
    expect(html.match(/stage-bar-earlier/g)).toHaveLength(1);
    expect(html.match(/class="stage-bar-round"/g)).toHaveLength(2);
  });
});

describe("RunStageTrack phone list with many rounds", () => {
  it("folds the older rounds of the phone list too", () => {
    const html = renderToStaticMarkup(
      <RunStageTrack state={{ ...fixture, state: "reviewing", round: 12, execution: idle }} />,
    );
    expect(html).toContain('class="stage-timeline-folded"');
    expect(html.match(/Rounds 1–10/g)).toHaveLength(2);
  });
});

describe("revision on request", () => {
  const open = [{ decision: "pending" }, { decision: "rejected" }];
  const atGate = (
    overrides: Parameters<typeof runStageTrack>[0] extends infer I ? Partial<I> : never,
  ) =>
    runStageTrack({
      ...fixture,
      execution: idle,
      state: "awaiting-approval",
      round: 2,
      models,
      findings: open,
      maxRounds: 3,
      ...overrides,
    });

  it("shows the author's revision after the gate while findings stay open", () => {
    expect(atGate({}).revisionOnRequest).toBe(true);
  });

  it("hides it at the round limit, with no open finding, or before the gate", () => {
    expect(atGate({ maxRounds: 2 }).revisionOnRequest).toBe(false);
    expect(atGate({ findings: [{ decision: "rejected" }] }).revisionOnRequest).toBe(false);
    expect(atGate({ state: "reviewing" }).revisionOnRequest).toBe(false);
  });

  it("draws it faded after the gate", () => {
    const html = renderToStaticMarkup(
      <RunStageTrack
        state={{
          ...fixture,
          state: "awaiting-approval",
          round: 1,
          execution: idle,
          providerTransmissionPreflight: {
            ...fixture.providerTransmissionPreflight,
            budget: { ...fixture.providerTransmissionPreflight.budget, maxRounds: 3 },
          },
          findings: fixture.findings.map((finding) => ({ ...finding, decision: "pending" })),
        }}
      />,
    );
    expect(html).toContain("stage-round stage-round-optional");
    expect(html).toContain("if you request it");
  });
});

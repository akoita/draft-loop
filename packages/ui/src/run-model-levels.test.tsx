import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApplicationRunRowView } from "./application-run-list.js";
import { normalizeApplicationRuns } from "./application-run-list.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ModelProfileBudget } from "./model-profile-budget.js";
import { RunDetailsDrawer } from "./run-details.js";
import { type StartReviewAction, startConfirmationSummary } from "./start-confirmation.js";

const fixture = createFixtureReviewState();
const start: StartReviewAction = { type: "start" };

/** Balanced: the writer's own level is medium and the reviewer's is low. */
const balanced: ModelProfileReferences = {
  author: { id: "economy-anthropic-author", version: 1 },
  critic: { id: "balanced-openai-critic", version: 1 },
};
const raised: ModelProfileReferences = {
  ...balanced,
  author: { ...balanced.author, effort: "high" },
};
const lowered: ModelProfileReferences = {
  ...balanced,
  author: { ...balanced.author, effort: "low" },
};

function row(overrides: Partial<ApplicationRunRowView>): ApplicationRunRowView {
  return {
    runId: fixture.runId,
    startedAt: "2026-10-28T10:00:00.000Z",
    authorModel: "claude-sonnet-5-5",
    criticModel: "gpt-6.1-terra",
    round: 1,
    state: "awaiting-approval",
    latest: true,
    ...overrides,
  };
}

function renderDrawer(state: DesktopReviewState): string {
  return renderToStaticMarkup(
    <RunDetailsDrawer
      id="run-details"
      open
      onClose={() => undefined}
      returnFocusRef={createRef<HTMLElement>()}
      state={state}
      describeState={(value) => value}
      start={{ disabled: false, pending: false, blockedReason: null, onStart: () => undefined }}
      autopilot={null}
    />,
  );
}

describe("reasoning levels before and after a run", () => {
  it("names each role's level in the start confirmation, default, raised or lowered", () => {
    const summary = (modelProfiles: ModelProfileReferences) =>
      startConfirmationSummary(fixture, { action: start, modelProfiles });

    expect(summary(balanced).preset).toBe("Balanced");
    expect(summary(balanced).models.map(({ reasoning }) => reasoning)).toEqual([
      "Medium reasoning (default)",
      "Low reasoning (default)",
    ]);
    expect(summary(raised).preset).toBe("Balanced · writer high");
    expect(summary(raised).models[0].reasoning).toBe("High reasoning");
    expect(summary(lowered).preset).toBe("Balanced · writer low");
    expect(summary(lowered).models[0].reasoning).toBe("Low reasoning");
    expect(startConfirmationSummary(fixture, { action: start }).models[0].reasoning).toBeNull();
  });

  it("shows the level the run recorded in its details", () => {
    const html = renderDrawer({
      ...fixture,
      applicationRuns: [row({ authorEffort: "high", criticEffort: "low" })],
    });
    expect(html).toContain("High reasoning");
    expect(html).toContain("Low reasoning");
    expect(renderDrawer({ ...fixture, applicationRuns: [row({})] })).not.toContain("reasoning<");
  });

  it("carries a recorded level across the bridge and refuses an unknown one", () => {
    expect(normalizeApplicationRuns([row({ authorEffort: "xhigh" })])?.[0]?.authorEffort).toBe(
      "xhigh",
    );
    expect(normalizeApplicationRuns([row({ authorEffort: "extreme" as never })])).toBeUndefined();
  });

  it("notes a raised level in the cost scenario, but not a default or lowered one", () => {
    const note = "reasoning level is above its default";
    expect(renderToStaticMarkup(<ModelProfileBudget references={raised} />)).toContain(
      `The writer&#x27;s ${note}`,
    );
    expect(renderToStaticMarkup(<ModelProfileBudget references={balanced} />)).not.toContain(note);
    expect(renderToStaticMarkup(<ModelProfileBudget references={lowered} />)).not.toContain(note);
  });
});

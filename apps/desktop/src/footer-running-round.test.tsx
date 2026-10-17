import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  type FooterRunningRoundInput,
  footerRunningRound,
  sentRevisionDirection,
} from "./footer-running-round.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const fixture = createFixtureReviewState();
const reviewed: DesktopReviewState = {
  ...fixture,
  state: "awaiting-approval",
  round: 1,
  findings: [],
  execution: { ...fixture.execution, status: "idle", step: null },
};
const revising: DesktopReviewState = {
  ...reviewed,
  state: "revising",
  round: 2,
  execution: {
    ...reviewed.execution,
    status: "running",
    step: "revision",
    provider: "mistral",
    model: "mistral-large-4",
    attempt: 1,
    elapsedMs: 113_400,
    timeoutRemainingMs: null,
  },
};
const noop = () => undefined;

function input(
  state: DesktopReviewState,
  overrides: Partial<FooterRunningRoundInput> = {},
): FooterRunningRoundInput {
  return {
    state,
    sentDirection: null,
    busy: false,
    stopping: false,
    transmissionReady: true,
    onStop: noop,
    onResume: noop,
    onShowProgress: noop,
    ...overrides,
  };
}

describe("footerRunningRound", () => {
  it("leaves the gate's buttons in place while the run waits on the reviewer", () => {
    expect(footerRunningRound(input(reviewed))).toBeNull();
  });

  it("reports the running round with Stop, and quotes the directions sent for it", () => {
    const sent = sentRevisionDirection(reviewed, "  lead with tokenisation ");
    expect(sent).toEqual({ runId: reviewed.runId, round: 2, text: "lead with tokenisation" });
    const round = footerRunningRound(input(revising, { sentDirection: sent }));
    expect(round).toMatchObject({
      activity: `The author is revising version ${revising.artifact.version} for round 2.`,
      execution: "revision · mistral/mistral-large-4 · attempt 1 · elapsed 113s · no run limit",
      direction: "lead with tokenisation",
    });
    expect(round?.actions.map((action) => action.label)).toEqual(["Stop review"]);
  });

  it("drops the directions once a later round runs", () => {
    const sent = sentRevisionDirection(reviewed, "lead with tokenisation");
    const later = { ...revising, round: 3 };
    expect(footerRunningRound(input(later, { sentDirection: sent }))?.direction).toBeNull();
  });

  it("sends no directions record for blank text", () => {
    expect(sentRevisionDirection(reviewed, "   ")).toBeNull();
  });

  it("offers Resume for a paused run and both choices for an interrupted one", () => {
    const paused = footerRunningRound(input({ ...reviewed, state: "paused" }));
    expect(paused?.actions.map((action) => action.label)).toEqual(["Resume review"]);
    expect(paused?.activity).toBeNull();
    const interrupted = footerRunningRound(
      input({ ...revising, execution: { ...revising.execution, status: "interrupted" } }),
    );
    expect(interrupted?.actions.map((action) => action.label)).toEqual([
      "Resume interrupted review",
      "Stop review",
    ]);
  });

  it("disables Resume until provider transmission is acknowledged", () => {
    const paused = footerRunningRound(
      input({ ...reviewed, state: "paused" }, { transmissionReady: false }),
    );
    expect(paused?.actions[0]?.disabled).toBe(true);
  });
});

describe("the review footer while a round runs", () => {
  it("shows the round and Stop where Request revision was, and hides the gate's buttons", () => {
    const html = renderToStaticMarkup(<ReviewWorkspace state={revising} onAction={noop} />);
    const footer = html.slice(html.indexOf('aria-label="approval and export"'));
    expect(footer).toContain('aria-label="current round"');
    expect(footer).toContain(
      `The author is revising version ${revising.artifact.version} for round 2.`,
    );
    expect(footer).toContain(">Stop review</button>");
    expect(footer).toContain(">Show run progress</button>");
    expect(footer).toContain('aria-label="approval actions" hidden="">');
  });

  it("keeps the gate's buttons once the round has been reviewed", () => {
    const html = renderToStaticMarkup(<ReviewWorkspace state={reviewed} onAction={noop} />);
    expect(html).not.toContain('aria-label="current round"');
    expect(html).toContain('aria-label="approval actions">');
  });
});

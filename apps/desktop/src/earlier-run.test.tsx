import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationRunRowView } from "./application-run-list.js";
import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import { earlierRunAllowsAction, normalizeEarlierRun } from "./earlier-run.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";
import { ReviewWorkspace } from "./review.js";

const latest: ApplicationRunRowView = {
  runId: "run-b",
  startedAt: "2026-10-14T09:30:00.000Z",
  authorModel: "claude-opus-4-1",
  criticModel: "gpt-5",
  round: 2,
  state: "awaiting-approval",
  latest: true,
};
const earlier: ApplicationRunRowView = {
  runId: "run-a",
  startedAt: "2026-10-13T08:00:00.000Z",
  authorModel: "claude-opus-4-1",
  criticModel: "gpt-5",
  round: 1,
  state: "stopped",
  latest: false,
};

describe("the earlier-run marker", () => {
  it("keeps a well-formed marker and rejects anything else", () => {
    expect(normalizeEarlierRun({ latestRunId: "run-b" })).toEqual({ latestRunId: "run-b" });
    for (const value of [
      null,
      [],
      "run-b",
      {},
      { latestRunId: "" },
      { latestRunId: 4 },
      { latestRunId: "x".repeat(201) },
      { latestRunId: "run-b", extra: true },
    ]) {
      expect(normalizeEarlierRun(value)).toBeUndefined();
    }
  });

  it("allows only the actions that change no run", () => {
    expect(earlierRunAllowsAction("start")).toBe(true);
    expect(earlierRunAllowsAction("set-autopilot")).toBe(true);
    expect(earlierRunAllowsAction("acknowledge-provider-transmission")).toBe(true);
    for (const type of [
      "finding-decision",
      "edit-block",
      "approve",
      "export",
      "resume",
      "stop",
      "request-revision",
      "recover-to-review",
      "recover-round-limit",
    ] as const) {
      expect(earlierRunAllowsAction(type)).toBe(false);
    }
  });
});

function loadReview(value: unknown) {
  const bridge: NativeBridge = {
    capabilities: ["review.load"],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge).execute({ type: "review.load", input: {} });
}

/*
 * Drift proof: a real payload goes through the real review-state validator, so a field added to
 * the interface but not to the runtime allowlist fails here instead of in the app.
 */
describe("the earlier-run marker over the bridge", () => {
  it("accepts a real payload unchanged", async () => {
    for (const earlierRun of [{ latestRunId: "run-b" }, null]) {
      const state = { ...createFixtureReviewState(), earlierRun };
      await expect(loadReview(state)).resolves.toEqual({ ok: true, value: state });
    }
  });

  it("rejects a malformed marker", async () => {
    for (const earlierRun of [{ latestRunId: "" }, "run-b", { latestRunId: "run-b", x: 1 }]) {
      await expect(
        loadReview({ ...createFixtureReviewState(), earlierRun }),
      ).resolves.toMatchObject({ ok: false });
    }
  });
});

function portWith() {
  const state = createFixtureReviewState();
  const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
    if (command.type === "review.load" || command.type === "review.dispatch") {
      return { ok: true, value: state };
    }
    return { ok: false, error: { code: "capability-unavailable", message: command.type } };
  });
  const port = createBridgeReviewPort(
    createNativeCapabilityPort({ capabilities: bridgeCapabilities as never, invoke }),
  );
  return { port, invoke, state };
}

describe("opening a run through the review port", () => {
  it("loads the chosen run until the latest run is opened again", async () => {
    const { port, invoke } = portWith();
    if (port.openRun === undefined || port.selectApplication === undefined) {
      throw new Error("Expected the application capabilities");
    }
    port.selectApplication("app-1");
    await port.openRun("run-a");
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1", runId: "run-a" },
    });
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1", runId: "run-a" },
    });
    await port.openRun(null);
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1" },
    });
  });

  it("returns to the latest run when the application changes or a review starts", async () => {
    const { port, invoke, state } = portWith();
    if (port.openRun === undefined || port.selectApplication === undefined) {
      throw new Error("Expected the application capabilities");
    }
    port.selectApplication("app-1");
    await port.openRun("run-a");
    port.selectApplication("app-2");
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-2" },
    });

    await port.openRun("run-c");
    await port.dispatch(state, { type: "start" });
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-2" },
    });
  });

  it("drops a run the host refuses to open", async () => {
    const { port, invoke } = portWith();
    if (port.openRun === undefined || port.selectApplication === undefined) {
      throw new Error("Expected the application capabilities");
    }
    port.selectApplication("app-1");
    invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: "not-found", message: "That run does not belong to this application." },
    });
    await expect(port.openRun("run-foreign")).rejects.toThrow("does not belong");
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1" },
    });
  });
});

function render(extra: Partial<DesktopReviewState>, onOpenRun?: (runId: string | null) => void) {
  const state: DesktopReviewState = { ...createFixtureReviewState(), ...extra };
  return renderToStaticMarkup(
    <ReviewWorkspace
      state={state}
      onAction={() => undefined}
      {...(onOpenRun === undefined ? {} : { onOpenRun })}
    />,
  );
}

const decisionButton = /<button[^>]*>(?:Accept|Reject|Defer|Override)<\/button>/gu;

describe("an earlier run in the review", () => {
  const onOpenRun = () => undefined;
  const viewingEarlier = (state: DesktopReviewState) => ({
    runId: state.runId,
    applicationRuns: [{ ...latest }, { ...earlier, runId: state.runId }],
    earlierRun: { latestRunId: latest.runId },
  });

  it("says it is an earlier run and leads back to the latest run", () => {
    const html = render(viewingEarlier(createFixtureReviewState()), onOpenRun);
    expect(html).toContain('aria-label="earlier run"');
    expect(html).toContain("Viewing an earlier run.</strong> Changes are made on the latest run.");
    expect(html).toContain(">Back to latest run</button>");
  });

  it("hides or disables every control that would change the run", () => {
    const fixture = createFixtureReviewState();
    const latestHtml = render({ applicationRuns: [{ ...latest, runId: fixture.runId }] });
    const html = render(viewingEarlier(fixture), onOpenRun);

    // The latest run's review offers the changes this test expects to see locked.
    expect(latestHtml).toContain('class="block-open" type="button" aria-label="Edit');
    expect(latestHtml.match(decisionButton)).toHaveLength(8);
    expect(latestHtml).toContain(">Resume review</button>");
    // The fixture is paused, so the footer offers Resume in place of the approval actions.
    expect(latestHtml).toContain('aria-label="current round"');

    expect(html.match(/<button class="block-open"[^>]*>/gu)).toEqual([
      expect.stringContaining('hidden=""'),
      expect.stringContaining('hidden=""'),
    ]);
    expect(html).toContain('aria-label="approval actions" hidden="">');
    // Every Accept, Reject, Defer and Override, in the margin and in the queue, is disabled.
    const decisionButtons = html.match(decisionButton) ?? [];
    expect(decisionButtons).toHaveLength(8);
    for (const button of decisionButtons) expect(button).toContain('disabled=""');
    expect(latestHtml).toContain("redline · editable</span>");
    expect(html).toContain("redline · read-only</span>");
    expect(html).toContain("This run is read-only.");
    expect(html).not.toContain(">Start a new review</button>");
    expect(html).not.toContain(">Resume review</button>");
    expect(html).not.toContain('aria-label="current round"');
    expect(html).not.toContain("Stop review</button>");
  });

  it("leaves the latest run's review unchanged", () => {
    const before = render({});
    expect(render({ earlierRun: null })).toBe(before);
    expect(before).not.toContain("Viewing an earlier run");
  });

  it("marks the earlier run in the header's run switcher", () => {
    const fixture = createFixtureReviewState();
    const html = render(viewingEarlier(fixture), onOpenRun);
    expect(html).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(html).toContain('aria-label="Run 1 of 2"');
    const checked = html.match(
      /role="menuitemradio" aria-checked="true"[^>]*>.*?<strong>Run \d<\/strong>/u,
    );
    expect(checked?.[0]).toContain("<strong>Run 1</strong>");
    // The side panel no longer lists the runs.
    expect(html).not.toContain('aria-label="application runs"');
  });
});

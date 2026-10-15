import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { normalizeApplicationSummary } from "./application-contract.js";
import { type ApplicationRunRowView, normalizeApplicationRuns } from "./application-run-list.js";
import type { NativeBridge } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import { chosenRunAllowsAction, normalizeEarlierRun } from "./earlier-run.js";
import { EarlierRunNotice } from "./earlier-run-view.js";
import { applicationChosenRunText, applicationRunToOpen } from "./home-model.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";
import { RunComparisonView } from "./run-comparison.js";
import { runComparisonReducer } from "./run-comparison-model.js";
import { RunDraftChoice, runDraftChoiceOffered } from "./run-draft-choice.js";
import { RunSwitcher } from "./run-switcher.js";

const fixture = createFixtureReviewState();

function row(runId: string, extra: Partial<ApplicationRunRowView> = {}): ApplicationRunRowView {
  return {
    runId,
    startedAt: "2026-10-12T07:00:00.000Z",
    authorModel: "claude-opus-4-1",
    criticModel: "gpt-5",
    round: 1,
    state: "awaiting-approval",
    latest: false,
    ...extra,
  };
}

function comparisonOf(state: DesktopReviewState, otherRunId: string) {
  const chosen = runComparisonReducer(null, {
    type: "choose",
    workspaceId: state.workspaceId,
    openRunId: state.runId,
    otherRunId,
  });
  const loaded = runComparisonReducer(chosen, {
    type: "loaded",
    state: { ...state, runId: otherRunId },
  });
  if (loaded === null) throw new Error("Expected a comparison.");
  return loaded;
}

describe("Use this run's draft", () => {
  it("is offered for an earlier run, and for the latest only while another run is chosen", () => {
    const plain = [row(fixture.runId, { latest: true }), row("run-earlier")];
    expect(runDraftChoiceOffered({ latest: false, chosen: false }, plain)).toBe(true);
    expect(runDraftChoiceOffered({ latest: true, chosen: false }, plain)).toBe(false);
    const chosen = [row(fixture.runId, { latest: true }), row("run-earlier", { chosen: true })];
    expect(runDraftChoiceOffered({ latest: false, chosen: true }, chosen)).toBe(false);
    expect(runDraftChoiceOffered({ latest: true, chosen: false }, chosen)).toBe(true);
  });

  it("shows the button on the earlier side of the comparison only", () => {
    const state: DesktopReviewState = {
      ...fixture,
      applicationRuns: [row(fixture.runId, { latest: true }), row("run-earlier")],
    };
    const html = renderToStaticMarkup(
      <RunComparisonView
        comparison={comparisonOf(state, "run-earlier")}
        state={state}
        onSwap={() => undefined}
        onClose={() => undefined}
        onChooseRun={vi.fn(async () => undefined)}
      />,
    );
    expect(html.match(/Use this run&#x27;s draft/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="Use Run 1&#x27;s draft"');

    const without = renderToStaticMarkup(
      <RunComparisonView
        comparison={comparisonOf(state, "run-earlier")}
        state={state}
        onSwap={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(without).not.toContain("Use this run");
  });

  it("marks the chosen side and offers the latest run back", () => {
    const state: DesktopReviewState = {
      ...fixture,
      applicationRuns: [row(fixture.runId, { latest: true }), row("run-earlier", { chosen: true })],
    };
    const html = renderToStaticMarkup(
      <RunComparisonView
        comparison={comparisonOf(state, "run-earlier")}
        state={state}
        onSwap={() => undefined}
        onClose={() => undefined}
        onChooseRun={vi.fn(async () => undefined)}
      />,
    );
    expect(html).toContain('<span class="run-switcher-chosen">chosen</span>');
    expect(html).toContain('aria-label="Use Run 2&#x27;s draft"');
    expect(html).not.toContain('aria-label="Use Run 1&#x27;s draft"');
  });

  it("confirms with an optional, bounded reason", () => {
    const html = renderToStaticMarkup(
      <RunDraftChoice
        runId="run-earlier"
        label="Run 1"
        onChoose={vi.fn(async () => undefined)}
        initiallyConfirming
      />,
    );
    expect(html).toContain(
      '<form class="use-run-draft-confirm" aria-label="Use Run 1&#x27;s draft"',
    );
    expect(html).toContain("No run is deleted");
    expect(html).toContain("Reason (optional)");
    expect(html).toContain('maxLength="500"');
    expect(html).toContain(">Use Run 1&#x27;s draft</button>");
    expect(html).toContain(">Cancel</button>");
  });
});

describe("opening the chosen run", () => {
  function portWith() {
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "review.load") return { ok: true, value: fixture };
      if (command.type === "application.choose-run") {
        return {
          ok: true,
          value: {
            workspaceId: "workspace-1",
            application: {
              id: "app-1",
              name: "Acme",
              jobSourceKind: "pasted-text",
              status: "in-review",
              isDefault: false,
              createdAt: "2026-10-08T10:00:00.000Z",
              updatedAt: "2026-10-08T10:00:00.000Z",
              runCount: 2,
              briefCount: 0,
              exportCount: 0,
              latestRunId: "run-2",
              archivedAt: null,
              modelProfiles: null,
              nameChosen: true,
              suggestedName: null,
              chosenRun: { runId: "run-1", runNumber: 1 },
            },
          },
        };
      }
      return { ok: false, error: { code: "capability-unavailable", message: command.type } };
    });
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: bridgeCapabilities as never, invoke }),
    );
    return { port, invoke };
  }

  it("opens an application on its chosen run when that is not the latest", async () => {
    expect(applicationRunToOpen({ latestRunId: "run-2" })).toBeUndefined();
    expect(
      applicationRunToOpen({ latestRunId: "run-2", chosenRun: { runId: "run-2", runNumber: 2 } }),
    ).toBeUndefined();
    const chosen = { latestRunId: "run-2", chosenRun: { runId: "run-1", runNumber: 1 } };
    expect(applicationRunToOpen(chosen)).toBe("run-1");

    const { port, invoke } = portWith();
    if (port.selectApplication === undefined || port.openRun === undefined) {
      throw new Error("Expected the application capabilities");
    }
    port.selectApplication("app-1", applicationRunToOpen(chosen));
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1", runId: "run-1" },
    });
    // The run switcher still reaches the latest run.
    await port.openRun(null);
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1" },
    });
    port.selectApplication("app-1");
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1" },
    });
  });

  it("records the choice and then opens the chosen run", async () => {
    const { port, invoke } = portWith();
    if (port.selectApplication === undefined || port.chooseRun === undefined) {
      throw new Error("Expected the choose-run capability");
    }
    port.selectApplication("app-1");
    await port.chooseRun("workspace-1", "run-1", "Tighter summary");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      {
        type: "application.choose-run",
        input: {
          workspaceId: "workspace-1",
          applicationId: "app-1",
          runId: "run-1",
          reason: "Tighter summary",
        },
      },
      { type: "review.load", input: { applicationId: "app-1", runId: "run-1" } },
    ]);
  });
});

describe("the chosen run's marks", () => {
  it("says chosen in the run switcher", () => {
    const html = renderToStaticMarkup(
      <RunSwitcher
        runs={[row(fixture.runId, { latest: true }), row("run-earlier", { chosen: true })]}
        viewedRunId={fixture.runId}
        onOpenRun={() => undefined}
        initiallyOpen
      />,
    );
    expect(html.match(/run-switcher-chosen">chosen</gu)).toHaveLength(1);
  });

  it("says which run Home uses, only when it is not the latest", () => {
    expect(applicationChosenRunText({ latestRunId: "run-3" })).toBeNull();
    expect(
      applicationChosenRunText({
        latestRunId: "run-3",
        chosenRun: { runId: "run-3", runNumber: 3 },
      }),
    ).toBeNull();
    expect(
      applicationChosenRunText({
        latestRunId: "run-3",
        chosenRun: { runId: "run-2", runNumber: 2 },
      }),
    ).toBe("Using Run 2");
  });

  it("tells the chosen earlier run apart in the review notice", () => {
    const html = renderToStaticMarkup(
      <EarlierRunNotice
        earlierRun={{ latestRunId: "run-3", chosen: true }}
        onBackToLatest={() => undefined}
      />,
    );
    expect(html).toContain("Using this earlier run&#x27;s draft.");
    expect(html).toContain("Approve and export it here");
  });

  it("crosses the bridge with the chosen marks and refuses malformed ones", () => {
    expect(normalizeEarlierRun({ latestRunId: "run-3", chosen: true })).toEqual({
      latestRunId: "run-3",
      chosen: true,
    });
    expect(normalizeEarlierRun({ latestRunId: "run-3", chosen: false })).toEqual({
      latestRunId: "run-3",
    });
    expect(normalizeEarlierRun({ latestRunId: "run-3", chosen: "yes" })).toBeUndefined();
    expect(normalizeApplicationRuns([row("run-a", { chosen: true })])).toEqual([
      row("run-a", { chosen: true }),
    ]);
    expect(
      normalizeApplicationRuns([row("run-a", { chosen: true }), row("run-b", { chosen: true })]),
    ).toBeUndefined();
    const summary = {
      id: "default",
      name: "Default",
      jobSourceKind: "local-file",
      status: "in-review",
      isDefault: true,
      createdAt: "2026-10-08T10:00:00.000Z",
      updatedAt: "2026-10-08T10:00:00.000Z",
      runCount: 2,
      briefCount: 0,
      exportCount: 0,
      latestRunId: "run-2",
      archivedAt: null,
      modelProfiles: null,
      nameChosen: true,
      suggestedName: null,
    };
    expect(normalizeApplicationSummary(summary)).not.toHaveProperty("chosenRun");
    expect(
      normalizeApplicationSummary({ ...summary, chosenRun: { runId: "run-1", runNumber: 1 } }),
    ).toMatchObject({ chosenRun: { runId: "run-1", runNumber: 1 } });
    for (const chosenRun of [null, { runId: "run-1" }, { runId: "run-1", runNumber: 0 }]) {
      expect(normalizeApplicationSummary({ ...summary, chosenRun })).toBeUndefined();
    }
  });

  it("lets the chosen run take approval, export and finding decisions only", () => {
    for (const type of ["approve", "export", "finding-decision", "start"] as const) {
      expect(chosenRunAllowsAction(type)).toBe(true);
    }
    for (const type of ["request-revision", "edit-block", "resume", "pause", "stop"] as const) {
      expect(chosenRunAllowsAction(type)).toBe(false);
    }
  });
});

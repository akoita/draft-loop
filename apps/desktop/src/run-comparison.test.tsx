import type { ApplicationRunRowView } from "@draft-loop/ui/application-run-list";
import type { NativeBridge } from "@draft-loop/ui/bridge";
import { bridgeCapabilities } from "@draft-loop/ui/bridge-capabilities";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  type ReviewArtifact,
} from "@draft-loop/ui/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";
import { ReviewWorkspace } from "./review.js";
import { RunComparisonView } from "./run-comparison.js";
import {
  comparedRunFacts,
  comparingRunsNotice,
  comparisonSides,
  type RunComparisonState,
  runComparisonActive,
  runComparisonReducer,
} from "./run-comparison-model.js";
import { comparisonCandidates, RunSwitcher } from "./run-switcher.js";

const fixture = createFixtureReviewState();

function row(runId: string, extra: Partial<ApplicationRunRowView> = {}): ApplicationRunRowView {
  return {
    runId,
    startedAt: "2026-10-12T07:00:00.000Z",
    authorModel: "claude-opus-4-1",
    criticModel: "gpt-5",
    round: 1,
    state: "stopped",
    latest: false,
    ...extra,
  };
}

// Newest first, as the host sends them; the open run is the latest.
const runs: readonly ApplicationRunRowView[] = [
  row(fixture.runId, { round: 2, state: "awaiting-approval", latest: true }),
  row("run-earlier", { criticModel: "gpt-5-mini" }),
  row("run-first", { authorModel: "", criticModel: "" }),
];

const openState: DesktopReviewState = { ...fixture, applicationRuns: runs };

/** The other run's draft: the open run's draft with its first line rewritten. */
function otherArtifact(): ReviewArtifact {
  const [first, ...rest] = fixture.artifact.sections;
  if (first === undefined) throw new Error("Expected a section in the fixture.");
  const [block, ...blocks] = first.blocks;
  if (block === undefined) throw new Error("Expected a line in the fixture.");
  return {
    ...fixture.artifact,
    id: "artifact-earlier",
    version: 1,
    sections: [
      { ...first, blocks: [{ ...block, text: "An earlier opening line." }, ...blocks] },
      ...rest,
    ],
  };
}

const chosen = runComparisonReducer(null, {
  type: "choose",
  workspaceId: fixture.workspaceId,
  openRunId: fixture.runId,
  otherRunId: "run-earlier",
});
if (chosen === null) throw new Error("Expected a comparison.");
const loaded = runComparisonReducer(chosen, {
  type: "loaded",
  state: { ...fixture, runId: "run-earlier", artifact: otherArtifact() },
});
if (loaded === null) throw new Error("Expected a comparison.");

describe("choosing the run to compare with", () => {
  it("lists every run except the one shown", () => {
    expect(comparisonCandidates(runs, fixture.runId).map((candidate) => candidate.number)).toEqual([
      2, 1,
    ]);
    expect(comparisonCandidates(runs.slice(0, 1), fixture.runId)).toEqual([]);
  });

  it("offers Compare with… in the run switcher only when runs can be read for comparison", () => {
    const withCompare = renderToStaticMarkup(
      <RunSwitcher
        runs={runs}
        viewedRunId={fixture.runId}
        onOpenRun={() => undefined}
        onCompareRun={() => undefined}
        initiallyOpen
      />,
    );
    expect(withCompare).toContain('<hr class="run-switcher-separator"/>');
    expect(withCompare).toMatch(/role="menuitem"[^>]*>.*Compare with…/u);
    const without = renderToStaticMarkup(
      <RunSwitcher
        runs={runs}
        viewedRunId={fixture.runId}
        onOpenRun={() => undefined}
        initiallyOpen
      />,
    );
    expect(without).not.toContain("Compare with…");
  });

  it("lists the other runs once Compare with… is chosen", () => {
    const html = renderToStaticMarkup(
      <RunSwitcher
        runs={runs}
        viewedRunId={fixture.runId}
        onCompareRun={() => undefined}
        initiallyOpen
        initialMenu="compare"
      />,
    );
    expect(html).toContain("Compare Run 3 with…");
    expect(html.match(/role="menuitem"/gu)).toHaveLength(2);
    expect(html).not.toContain('role="menuitemradio"');
    expect(html).toContain("<strong>Run 2</strong>");
    expect(html).toContain("<strong>Run 1</strong>");
    expect(html).not.toContain("<strong>Run 3</strong>");
  });

  it("puts the chosen run on the left and the open run on the right", () => {
    expect(chosen).toMatchObject({ openRunId: fixture.runId, otherRunId: "run-earlier" });
    const sides = comparisonSides(chosen, openState);
    expect(sides.left.facts.label).toBe("Run 2");
    expect(sides.left.draft).toEqual({ status: "loading" });
    expect(sides.right.facts.label).toBe("Run 3");
    expect(sides.right.open).toBe(true);
    expect(sides.right.draft).toEqual({ status: "loaded", artifact: fixture.artifact });
  });

  it("keeps the read of the chosen run and ignores a stale one", () => {
    expect(loaded.other).toEqual({ status: "loaded", artifact: otherArtifact() });
    const stale = runComparisonReducer(chosen, {
      type: "loaded",
      state: { ...fixture, runId: "run-first" },
    });
    expect(stale).toBe(chosen);
    const otherWorkspace = runComparisonReducer(chosen, {
      type: "loaded",
      state: { ...fixture, workspaceId: "workspace-other", runId: "run-earlier" },
    });
    expect(otherWorkspace).toBe(chosen);
    expect(
      runComparisonReducer(chosen, { type: "failed", runId: "run-earlier", message: "gone" })
        ?.other,
    ).toEqual({ status: "failed", message: "gone" });
  });

  it("swaps the sides and back", () => {
    const swapped = runComparisonReducer(loaded, { type: "swap" });
    if (swapped === null) throw new Error("Expected a comparison.");
    const sides = comparisonSides(swapped, openState);
    expect(sides.left.facts.label).toBe("Run 3");
    expect(sides.right.facts.label).toBe("Run 2");
    expect(runComparisonReducer(swapped, { type: "swap" })?.otherSide).toBe("left");
  });

  it("reads each side's recorded models, round and status", () => {
    expect(comparedRunFacts(runs, "run-earlier")).toEqual({
      runId: "run-earlier",
      label: "Run 2",
      models: "claude-opus-4-1 → gpt-5-mini",
      round: "round 1",
      status: "stopped",
      latest: false,
      chosen: false,
    });
    expect(comparedRunFacts(runs, "run-first").models).toBe("models not recorded");
    expect(comparedRunFacts(runs, fixture.runId).status).toBe("awaiting approval");
  });
});

describe("the comparison view", () => {
  const html = renderToStaticMarkup(
    <RunComparisonView
      comparison={loaded}
      state={openState}
      onSwap={() => undefined}
      onClose={() => undefined}
    />,
  );

  it("is a labelled region with named swap and close buttons", () => {
    expect(html).toContain('aria-label="Run comparison"');
    expect(html).toContain('aria-label="Swap sides: show Run 3 on the left"');
    expect(html).toMatch(/<button[^>]*aria-keyshortcuts="Escape"[^>]*>Close comparison<\/button>/u);
  });

  it("heads each side with its run, models, round and status", () => {
    expect(html).toContain("<strong>Run 2</strong>");
    expect(html).toContain("claude-opus-4-1 → gpt-5-mini");
    expect(html).toContain("<strong>Run 3</strong>");
    expect(html).toContain("open run");
    expect(html).toContain("awaiting approval");
  });

  it("marks the right draft against the left with struck and underlined text", () => {
    expect(html).toContain('<del class="redline-del">An earlier opening line.</del>');
    expect(html).toContain('<ins class="redline-ins">');
    expect(html).toContain("struck text is only in Run 2, underlined text only in Run 3");
  });

  it("is read-only: no edit, decision, approval or export control", () => {
    expect(html).not.toMatch(/<(textarea|input|select)\b/u);
    expect(html.match(/<button\b/gu)).toHaveLength(2);
    expect(html).not.toMatch(/Approve|Export|Accept|Reject|Edit/u);
  });

  it("says the other draft is being read until it arrives", () => {
    const loading = renderToStaticMarkup(
      <RunComparisonView
        comparison={chosen}
        state={openState}
        onSwap={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(loading).toContain("Reading the draft of Run 2…");
  });
});

describe("the review while comparing", () => {
  const render = (comparison: RunComparisonState | null, state = openState) =>
    renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        onOpenRun={() => undefined}
        onLoadRunForComparison={async () => state}
        initialRunComparison={comparison}
      />,
    );

  it("shows the comparison instead of the draft desk and holds the gate read-only", () => {
    const html = render(loaded);
    expect(html).toContain('aria-label="Run comparison"');
    expect(html).toMatch(/<section hidden=""[^>]*class="review-column"/u);
    expect(html).toContain(comparingRunsNotice);
    expect(html).toMatch(/<fieldset class="gate-actions" aria-label="approval actions" hidden=""/u);
  });

  it("hides the side panel and the open run's banners, keeping the footer", () => {
    const html = render(loaded);
    expect(html).toMatch(/<main class="app-shell app-shell-resizable app-shell-comparing"/u);
    expect(html).toContain('<div class="side-scroll" hidden="">');
    expect(html).toMatch(/<section hidden=""[^>]*class="validation-banner/u);
    expect(html).toContain('aria-label="approval and export"');
    expect(html).not.toContain('aria-label="earlier run"');
  });

  it("keeps the earlier-run notice when comparing from an earlier run", () => {
    const earlierOpen: DesktopReviewState = {
      ...openState,
      earlierRun: { latestRunId: "run-latest" },
    };
    expect(render(loaded, earlierOpen)).toContain('aria-label="earlier run"');
  });

  it("returns to the open run when the comparison is left", () => {
    const left = runComparisonReducer(loaded, { type: "close" });
    expect(left).toBeNull();
    const html = render(left);
    expect(html).not.toContain('aria-label="Run comparison"');
    expect(html).not.toContain(comparingRunsNotice);
    expect(html).not.toMatch(/<section hidden=""[^>]*class="review-column"/u);
    expect(html).toMatch(/<main class="app-shell app-shell-resizable"/u);
    expect(html).toContain('<div class="side-scroll">');
    expect(html).toMatch(/<section class="validation-banner/u);
  });

  it("is left when another run is opened", () => {
    const another = { ...openState, runId: "run-earlier" };
    expect(runComparisonActive(loaded, another)).toBe(false);
    expect(render(loaded, another)).not.toContain('aria-label="Run comparison"');
  });
});

describe("reading a run for comparison through the review port", () => {
  it("reads the run without moving the review off the open run", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) =>
      command.type === "review.load"
        ? { ok: true, value: fixture }
        : { ok: false, error: { code: "capability-unavailable", message: command.type } },
    );
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: bridgeCapabilities as never, invoke }),
    );
    if (port.loadRunForComparison === undefined || port.selectApplication === undefined) {
      throw new Error("Expected the application capabilities");
    }
    port.selectApplication("app-1");
    await port.loadRunForComparison("run-earlier");
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1", runId: "run-earlier" },
    });
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1" },
    });
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationRunRowView } from "./application-run-list.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  RunSwitcher,
  runStartedLabel,
  runSwitcherChoice,
  runSwitcherKeyTarget,
  runSwitcherOpenTarget,
  runSwitcherPosition,
} from "./run-switcher.js";

function row(
  runId: string,
  startedAt: string,
  extra: Partial<ApplicationRunRowView> = {},
): ApplicationRunRowView {
  return {
    runId,
    startedAt,
    authorModel: "claude-opus-4-1",
    criticModel: "gpt-5",
    round: 1,
    state: "stopped",
    latest: false,
    ...extra,
  };
}

// Newest first, as the host sends them.
const runs: readonly ApplicationRunRowView[] = [
  row("run-c", "2026-10-14T09:30:00.000Z", {
    round: 2,
    state: "awaiting-approval",
    score: 0.72,
    latest: true,
  }),
  row("run-b", "2026-10-13T08:00:00.000Z", { criticModel: "gpt-5-mini", score: 0.5 }),
  row("run-a", "2026-10-12T07:00:00.000Z", { authorModel: "", criticModel: "" }),
];

function items(html: string): string[] {
  return html.match(/<div class="run-switcher-item[^"]*" role="menuitemradio".*?<\/div>/gu) ?? [];
}

describe("the run switcher's position", () => {
  it("numbers the runs oldest first and points at the run shown", () => {
    expect(runSwitcherPosition(runs, "run-c")).toEqual({ index: 0, number: 3, total: 3 });
    expect(runSwitcherPosition(runs, "run-a")).toEqual({ index: 2, number: 1, total: 3 });
  });

  it("falls back to the latest run when the run shown is not listed", () => {
    const latestSecond = [runs[1], runs[0]].filter((run) => run !== undefined);
    expect(runSwitcherPosition(latestSecond, "run-gone")).toEqual({
      index: 1,
      number: 1,
      total: 2,
    });
    expect(runSwitcherPosition(runs, undefined)?.number).toBe(3);
  });

  it("has nothing to switch with fewer than two runs", () => {
    expect(runSwitcherPosition(undefined, "run-c")).toBeNull();
    expect(runSwitcherPosition(null, "run-c")).toBeNull();
    expect(runSwitcherPosition([], "run-c")).toBeNull();
    expect(runSwitcherPosition(runs.slice(0, 1), "run-c")).toBeNull();
  });
});

describe("choosing a run", () => {
  const [latest, middle] = runs;
  if (latest === undefined || middle === undefined) throw new Error("Expected two runs.");

  it("returns to the live run for the latest run and opens any other run read-only", () => {
    expect(runSwitcherChoice(latest, "run-a")).toEqual({ openRunId: null });
    expect(runSwitcherChoice(middle, "run-c")).toEqual({ openRunId: "run-b" });
  });

  it("does nothing for the run already shown", () => {
    expect(runSwitcherChoice(latest, "run-c")).toBeNull();
    expect(runSwitcherChoice(middle, "run-b")).toBeNull();
  });
});

describe("the run switcher's keyboard", () => {
  it("moves focus with the arrow keys, wrapping, and with Home and End", () => {
    expect(runSwitcherKeyTarget("ArrowDown", 0, 3)).toBe(1);
    expect(runSwitcherKeyTarget("ArrowDown", 2, 3)).toBe(0);
    expect(runSwitcherKeyTarget("ArrowUp", 1, 3)).toBe(0);
    expect(runSwitcherKeyTarget("ArrowUp", 0, 3)).toBe(2);
    expect(runSwitcherKeyTarget("Home", 2, 3)).toBe(0);
    expect(runSwitcherKeyTarget("End", 0, 3)).toBe(2);
  });

  it("leaves other keys to choosing, closing and the page", () => {
    for (const key of ["Enter", " ", "Escape", "Tab", "a"]) {
      expect(runSwitcherKeyTarget(key, 1, 3)).toBeUndefined();
    }
    expect(runSwitcherKeyTarget("ArrowDown", 0, 0)).toBeUndefined();
  });

  it("opens from the button at the run shown, or at the oldest run with Arrow Up", () => {
    expect(runSwitcherOpenTarget("Enter", 1, 3)).toBe(1);
    expect(runSwitcherOpenTarget(" ", 1, 3)).toBe(1);
    expect(runSwitcherOpenTarget("ArrowDown", 1, 3)).toBe(1);
    expect(runSwitcherOpenTarget("ArrowUp", 1, 3)).toBe(2);
    expect(runSwitcherOpenTarget("Escape", 1, 3)).toBeUndefined();
  });
});

describe("the run switcher's markup", () => {
  it("is a menu button named by the run shown, with the menu closed", () => {
    const html = renderToStaticMarkup(
      <RunSwitcher runs={runs} viewedRunId="run-b" onOpenRun={() => undefined} />,
    );
    const button = /<button class="run-switcher-button"[^>]*>/u.exec(html)?.[0] ?? "";
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-label="Run 2 of 3"');
    const buttonId = /id="([^"]+)"/u.exec(button)?.[1];
    const controls = /aria-controls="([^"]+)"/u.exec(button)?.[1];
    expect(buttonId).toBeDefined();
    expect(html).toContain(
      `<div class="run-switcher-menu" role="menu" id="${controls}" aria-labelledby="${buttonId}" hidden="">`,
    );
    // The visible label, and its short form for a tight header; both hidden from the name.
    expect(html).toContain('<span class="run-switcher-label-full" aria-hidden="true">Run 2 of 3');
    expect(html).toContain('<span class="run-switcher-label-short" aria-hidden="true">Run 2/3');
    expect(html).toContain('<span class="run-switcher-caret" aria-hidden="true">▾</span>');
  });

  it("lists every run newest first with its facts, the latest marked in text", () => {
    const html = renderToStaticMarkup(
      <RunSwitcher runs={runs} viewedRunId="run-c" onOpenRun={() => undefined} initiallyOpen />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('hidden=""');
    const [first, second, third] = items(html);
    expect(items(html)).toHaveLength(3);
    expect(first).toContain(
      '<span class="run-switcher-item-head"><strong>Run 3</strong>' +
        '<time dateTime="2026-10-14T09:30:00.000Z">2026-10-14 09:30 UTC</time>' +
        '<span class="run-switcher-latest">latest</span></span>' +
        '<span class="run-switcher-item-facts">' +
        '<span class="run-switcher-models">claude-opus-4-1 → gpt-5</span>' +
        "<span>round 2</span>" +
        '<span class="run-switcher-state">awaiting approval</span>' +
        '<span class="numeric" title="Mean of the latest evaluation&#x27;s readiness dimensions">' +
        "mean score 0.72</span></span>",
    );
    expect(second).toContain("<strong>Run 2</strong>");
    expect(second).toContain("claude-opus-4-1 → gpt-5-mini");
    expect(second).not.toContain("run-switcher-latest");
    expect(third).toContain("<strong>Run 1</strong>");
    expect(third).toContain("models not recorded");
    expect(third).not.toContain("mean score");
  });

  it("checks only the run shown and keeps every item out of the tab order", () => {
    const html = renderToStaticMarkup(
      <RunSwitcher runs={runs} viewedRunId="run-b" onOpenRun={() => undefined} initiallyOpen />,
    );
    const rows = items(html);
    expect(rows.map((item) => /aria-checked="(true|false)"/u.exec(item)?.[1])).toEqual([
      "false",
      "true",
      "false",
    ]);
    for (const item of rows) {
      expect(item).toContain('tabindex="-1"');
      expect(item).not.toContain("aria-disabled");
    }
    expect(rows[1]).toContain('<span class="run-switcher-check" aria-hidden="true">✓</span>');
  });

  it("only lists the runs when there is no way to open one", () => {
    const html = renderToStaticMarkup(<RunSwitcher runs={runs} viewedRunId="run-c" />);
    for (const item of items(html)) expect(item).toContain('aria-disabled="true"');
  });

  it("renders nothing with one run or none", () => {
    for (const value of [undefined, null, [], runs.slice(0, 1)]) {
      expect(renderToStaticMarkup(<RunSwitcher runs={value} viewedRunId="run-c" />)).toBe("");
    }
  });

  it("keeps an unreadable start time as recorded", () => {
    expect(runStartedLabel("not a date")).toBe("not a date");
  });
});

/** The review with these runs, the latest one being the fixture's run on screen. */
function render(applicationRuns?: readonly ApplicationRunRowView[] | null): string {
  const fixture = createFixtureReviewState();
  const listed = applicationRuns?.map((run) =>
    run.latest ? { ...run, runId: fixture.runId } : run,
  );
  const state: DesktopReviewState = {
    ...fixture,
    ...(applicationRuns === undefined ? {} : { applicationRuns: listed ?? null }),
  };
  return renderToStaticMarkup(
    <ReviewWorkspace state={state} onAction={() => undefined} onOpenRun={() => undefined} />,
  );
}

describe("the run switcher in the review", () => {
  it("sits in the header beside the version chips, and the side panel lists no runs", () => {
    const html = render(runs);
    const header = /<header class="spine">.*?<\/header>/u.exec(html)?.[0] ?? "";
    expect(header).toContain(
      '<div class="spine-meta"><div class="run-switcher"><button class="run-switcher-button"',
    );
    expect(header.indexOf("run-switcher")).toBeLessThan(header.indexOf("spine-versions"));
    expect(header).toContain('aria-label="Run 3 of 3"');
    expect(html).not.toContain('aria-label="application runs"');
    expect(html).not.toContain("application-run-");
  });

  it("leaves the header exactly as before with one run or none", () => {
    const before = render();
    expect(render(null)).toBe(before);
    expect(render([])).toBe(before);
    // A run that recorded models names them in Run details, so compare one that recorded none.
    const [only] = runs;
    if (only === undefined) throw new Error("Expected a run.");
    expect(render([{ ...only, authorModel: "", criticModel: "" }])).toBe(before);
    expect(render([only])).not.toContain("run-switcher");
    expect(before).not.toContain("run-switcher");
  });
});

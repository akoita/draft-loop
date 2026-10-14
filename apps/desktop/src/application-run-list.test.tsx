import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  type ApplicationRunInput,
  type ApplicationRunRowView,
  meanReadinessScore,
  normalizeApplicationRuns,
  orderApplicationRuns,
} from "./application-run-list.js";
import { ApplicationRunList, runStartedLabel } from "./application-run-list-view.js";
import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

function run(runId: string, startedAt: string, extra: Partial<ApplicationRunInput> = {}) {
  return {
    runId,
    startedAt,
    authorModel: "claude-opus-4-1",
    criticModel: "gpt-5",
    round: 1,
    state: "awaiting-approval",
    ...extra,
  } satisfies ApplicationRunInput;
}

const latest: ApplicationRunRowView = {
  ...run("run-b", "2026-10-14T09:30:00.000Z", { round: 2, score: 0.72 }),
  latest: true,
};
const earlier: ApplicationRunRowView = {
  ...run("run-a", "2026-10-13T08:00:00.000Z", { state: "stopped" }),
  latest: false,
};

describe("ordering an application's runs", () => {
  it("lists the newest start first and marks exactly one row latest", () => {
    const rows = orderApplicationRuns([
      run("run-a", "2026-10-13T08:00:00.000Z"),
      run("run-c", "2026-10-14T09:30:00.000Z"),
      run("run-b", "2026-10-12T07:00:00.000Z"),
    ]);
    expect(rows.map((row) => row.runId)).toEqual(["run-c", "run-a", "run-b"]);
    expect(rows.filter((row) => row.latest).map((row) => row.runId)).toEqual(["run-c"]);
  });

  it("breaks equal start times by run id, descending, with the chosen latest run first", () => {
    const tied = [
      run("run-a", "2026-10-14T09:30:00.000Z"),
      run("run-c", "2026-10-14T09:30:00.000Z"),
      run("run-b", "2026-10-14T09:30:00.000Z"),
    ];
    expect(orderApplicationRuns(tied).map((row) => row.runId)).toEqual(["run-c", "run-b", "run-a"]);
    const chosen = orderApplicationRuns(tied, "run-a");
    expect(chosen.map((row) => row.runId)).toEqual(["run-a", "run-c", "run-b"]);
    expect(chosen.filter((row) => row.latest).map((row) => row.runId)).toEqual(["run-a"]);
    // An unknown latest id falls back to the first row.
    expect(orderApplicationRuns(tied, "run-gone").find((row) => row.latest)?.runId).toBe("run-c");
  });

  it("keeps rows without a score and puts unreadable start times last", () => {
    const rows = orderApplicationRuns([
      run("run-x", "not a date"),
      run("run-a", "2026-10-13T08:00:00.000Z", { score: 0.5 }),
    ]);
    expect(rows.map((row) => row.runId)).toEqual(["run-a", "run-x"]);
    expect(rows[1]).not.toHaveProperty("score");
    expect(orderApplicationRuns([])).toEqual([]);
  });

  it("caps the list at fifty rows", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      run(
        `run-${String(index).padStart(2, "0")}`,
        new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      ),
    );
    const rows = orderApplicationRuns(many);
    expect(rows).toHaveLength(50);
    expect(rows[0]?.runId).toBe("run-59");
  });

  it("averages the dimension scores of the latest evaluation", () => {
    expect(meanReadinessScore({ relevance: 0.8, evidence: 0.4 })).toBeCloseTo(0.6);
    expect(meanReadinessScore({})).toBeUndefined();
    expect(meanReadinessScore(undefined)).toBeUndefined();
    expect(meanReadinessScore({ relevance: Number.NaN })).toBeUndefined();
  });
});

describe("normalizing the run list", () => {
  it("accepts rows with and without a score", () => {
    expect(normalizeApplicationRuns([latest, earlier])).toEqual([latest, earlier]);
    expect(normalizeApplicationRuns([])).toEqual([]);
  });

  it("rejects malformed rows, oversized lists and two latest rows", () => {
    for (const value of [
      [{ ...latest, extra: 1 }],
      [{ ...latest, round: -1 }],
      [{ ...latest, round: 1.5 }],
      [{ ...latest, round: 1_000_001 }],
      [{ ...latest, score: 1.2 }],
      [{ ...latest, score: Number.POSITIVE_INFINITY }],
      [{ ...latest, runId: "" }],
      [{ ...latest, authorModel: "x".repeat(201) }],
      [{ ...latest, latest: "yes" }],
      [latest, { ...earlier, latest: true }],
      Array.from({ length: 51 }, () => earlier),
      latest,
    ]) {
      expect(normalizeApplicationRuns(value)).toBeUndefined();
    }
  });
});

function loadReview(value: unknown) {
  const fixture = createFixtureReviewState();
  const bridge: NativeBridge = {
    capabilities: ["review.load"],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge).execute({
    type: "review.load",
    input: { workspaceId: fixture.workspaceId },
  });
}

/*
 * Drift proof: a real payload goes through the real review-state validator, so a field added to
 * the interface but not to the runtime allowlist fails here instead of in the app.
 */
describe("the run list over the bridge", () => {
  it("accepts a real payload unchanged", async () => {
    for (const applicationRuns of [[latest, earlier], [latest], [], null]) {
      const state = { ...createFixtureReviewState(), applicationRuns };
      await expect(loadReview(state)).resolves.toEqual({ ok: true, value: state });
    }
  });

  it("rejects a malformed run list", async () => {
    const fixture = createFixtureReviewState();
    for (const applicationRuns of [[{ ...latest, round: "2" }], "2 runs", [latest, latest]]) {
      await expect(loadReview({ ...fixture, applicationRuns })).resolves.toMatchObject({
        ok: false,
      });
    }
  });
});

function render(applicationRuns?: readonly ApplicationRunRowView[] | null): string {
  const state: DesktopReviewState = {
    ...createFixtureReviewState(),
    ...(applicationRuns === undefined ? {} : { applicationRuns }),
  };
  return renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
}

describe("the run list in the review", () => {
  it("lists two runs newest first with models, round, status, score and the latest badge", () => {
    const html = renderToStaticMarkup(<ApplicationRunList runs={[latest, earlier]} />);
    expect(html).toContain("<h2>Runs (2)</h2>");
    expect(html).toContain(
      '<li class="application-run-row" aria-current="true">' +
        '<time dateTime="2026-10-14T09:30:00.000Z">2026-10-14 09:30 UTC</time>' +
        '<span class="application-run-models">claude-opus-4-1 → gpt-5</span>' +
        "<span>round 2</span>" +
        '<span class="application-run-state">awaiting approval</span>' +
        '<span class="numeric" title="Mean of the latest evaluation&#x27;s readiness dimensions">' +
        "mean score 0.72</span>" +
        '<span class="application-run-latest">latest</span></li>',
    );
    expect(html).toContain(
      '<li class="application-run-row">' +
        '<time dateTime="2026-10-13T08:00:00.000Z">2026-10-13 08:00 UTC</time>' +
        '<span class="application-run-models">claude-opus-4-1 → gpt-5</span>' +
        "<span>round 1</span>" +
        '<span class="application-run-state">stopped</span></li>',
    );
    expect(html.indexOf('run-row" aria-current')).toBeLessThan(html.indexOf("2026-10-13"));
    expect(render([latest, earlier])).toContain('aria-label="application runs"');
  });

  it("shows one run as a single compact line", () => {
    const html = renderToStaticMarkup(<ApplicationRunList runs={[latest]} />);
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("<h2");
    expect(html).toContain('<p class="application-run-row"><span class="label">Runs (1)</span>');
    expect(html).toContain('<span class="application-run-latest">latest</span></p>');
  });

  it("says when a run recorded no models", () => {
    const html = renderToStaticMarkup(
      <ApplicationRunList runs={[{ ...latest, authorModel: "", criticModel: "" }]} />,
    );
    expect(html).toContain("models not recorded");
  });

  it("leaves a review outside an application exactly as before", () => {
    const before = render();
    expect(render(null)).toBe(before);
    expect(render([])).toBe(before);
    expect(before).not.toContain("application runs");
  });

  it("keeps an unreadable start time as recorded", () => {
    expect(runStartedLabel("not a date")).toBe("not a date");
  });
});

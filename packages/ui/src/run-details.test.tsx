import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApplicationRunRowView } from "./application-run-list.js";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  type WritingPolicyVersionMetadata,
} from "./model.js";
import { ReviewWorkspace } from "./review.js";
import { footerBlocker } from "./review-footer.js";
import {
  nextStepOpensRunDetails,
  RunDetailsDrawer,
  runDetailsSummary,
  shortModelName,
} from "./run-details.js";

const fixture = createFixtureReviewState();

const policy: WritingPolicyVersionMetadata = {
  checksum: "sha256:0123456789abcdef",
  version: "policy-v2",
  schemaVersion: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  priorChecksum: null,
};

/** The application's runs, newest first: the fixture's run is the latest, with an earlier one. */
const applicationRuns: readonly ApplicationRunRowView[] = [
  {
    runId: fixture.runId,
    startedAt: "2026-10-02T00:00:00.000Z",
    authorModel: "claude-opus-5-5",
    criticModel: "gpt-6.1-sol",
    round: 1,
    state: "awaiting-approval",
    latest: true,
  },
  {
    runId: "run-earlier",
    startedAt: "2026-10-01T00:00:00.000Z",
    authorModel: "claude-sonnet-4-5",
    criticModel: "gpt-5",
    round: 2,
    state: "approved",
    latest: false,
  },
];

/** The pair configured for new runs, which differs from every run's recorded models. */
const configuredMistral: DesktopReviewState["providerExposure"] = {
  ...fixture.providerExposure,
  author: { company: "Mistral", model: "mistral-large-4" },
  critic: { company: "OpenAI", model: "gpt-6-luna" },
};

const fullSource: DesktopReviewState = {
  ...fixture,
  providerExposure: configuredMistral,
  applicationRuns,
  evidenceMode: {
    requestedMode: "full-source",
    effectiveMode: "full-source",
    chunkCount: 282,
    sourceCount: 3,
  },
  writingPolicy: { effective: policy, lineage: { kind: "workspace" } },
};

const stopped: DesktopReviewState = { ...fixture, state: "stopped", reviewComplete: false };

const running: DesktopReviewState = {
  ...fixture,
  state: "reviewing",
  reviewComplete: false,
  execution: {
    status: "running",
    step: "critic",
    provider: "openai",
    model: "gpt-5",
    attempt: 1,
    elapsedMs: 4_200,
    timeoutRemainingMs: null,
  },
};

function render(state: DesktopReviewState): string {
  return renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
}

/** The drawer's markup, which comes before the main column. */
function drawerOf(html: string): string {
  const start = html.indexOf('<div class="run-details-layer"');
  if (start < 0) throw new Error("Expected the Run details drawer.");
  return html.slice(start, html.indexOf('<div class="main-column">', start));
}

/** Everything the reviewer sees without opening the drawer. */
function outsideDrawer(html: string): string {
  const drawer = drawerOf(html);
  return html.replace(drawer, "");
}

function sidePanelOf(html: string): string {
  return html.slice(html.indexOf('<aside class="side-column">'));
}

describe("runDetailsSummary", () => {
  it("reads models, full-source evidence and the policy in one line", () => {
    expect(runDetailsSummary(fullSource)).toBe(
      "Opus 5.5 → GPT-6.1 Sol · full source, 282 chunks · policy active",
    );
  });

  it("reads a retrieval run's excerpts and a run without a policy", () => {
    expect(runDetailsSummary({ ...fixture, applicationRuns })).toBe(
      "Opus 5.5 → GPT-6.1 Sol · 1 excerpt · no policy",
    );
  });

  it("says retrieval was used when full source fell back", () => {
    const state: DesktopReviewState = {
      ...fullSource,
      evidenceMode: {
        requestedMode: "full-source",
        effectiveMode: "retrieval",
        chunkCount: 900,
        fallbackReason: "budget-exceeded",
      },
      setup: { ...fixture.setup, selectedEvidenceChunkCount: 12 },
    };
    expect(runDetailsSummary(state)).toBe(
      "Opus 5.5 → GPT-6.1 Sol · retrieval, 12 excerpts · policy active",
    );
  });

  it("counts sources before the evidence is indexed and names a policy override", () => {
    const state: DesktopReviewState = {
      ...fixture,
      setup: { ...fixture.setup, retrievalStatus: "not-indexed", evidenceSourceCount: 3 },
      writingPolicy: {
        effective: policy,
        lineage: {
          kind: "opportunity-override",
          base: { version: "policy-v1", checksum: "sha256:base" },
          override: { version: "policy-v2", checksum: policy.checksum },
        },
      },
    };
    expect(runDetailsSummary(state)).toBe("models not recorded · 3 sources · policy override");
  });

  it("keeps an unknown model id as it is", () => {
    expect(shortModelName("acme-model-1")).toBe("acme-model-1");
  });
});

describe("the run's recorded models, not the pair configured for new runs", () => {
  const earlier: DesktopReviewState = {
    ...fullSource,
    runId: "run-earlier",
    earlierRun: { latestRunId: fixture.runId },
    evidenceMode: null,
    writingPolicy: null,
  };
  const unrecorded: DesktopReviewState = {
    ...fullSource,
    applicationRuns: applicationRuns.map((run) =>
      run.runId === fixture.runId ? { ...run, authorModel: "", criticModel: "" } : run,
    ),
  };

  function trustFacts(state: DesktopReviewState): string {
    const html = render(state);
    const start = html.indexOf('aria-label="trust and policy summary"');
    if (start < 0) throw new Error("Expected the trust facts.");
    return html.slice(start, html.indexOf("</section>", start));
  }

  it("names the latest run's recorded models in the summary and the drawer", () => {
    expect(runDetailsSummary(fullSource)).toMatch(/^Opus 5\.5 → GPT-6\.1 Sol · /u);
    const facts = trustFacts(fullSource);
    expect(facts).toContain("<strong>claude-opus-5-5</strong>");
    expect(facts).toContain("<strong>gpt-6.1-sol</strong>");
    expect(facts).toContain("claimed lineage anthropic:claude-sonnet-4-5");
    expect(facts).toContain("New runs use: mistral-large-4 → gpt-6-luna");
    expect(facts).not.toContain("<strong>mistral-large-4</strong>");
    expect(runDetailsSummary(fullSource)).not.toContain("Mistral");
  });

  it("names an earlier run's recorded models when it is opened read-only", () => {
    expect(runDetailsSummary(earlier)).toBe("Sonnet 4.5 → GPT-5 · 1 excerpt · no policy");
    const facts = trustFacts(earlier);
    expect(facts).toContain("<strong>claude-sonnet-4-5</strong>");
    expect(facts).toContain("<strong>gpt-5</strong>");
    expect(facts).toContain("New runs use: mistral-large-4 → gpt-6-luna");
  });

  it("says the models were not recorded rather than borrowing the configured pair", () => {
    expect(runDetailsSummary(unrecorded)).toMatch(/^models not recorded · /u);
    expect(runDetailsSummary({ ...fullSource, applicationRuns: null })).toMatch(
      /^models not recorded · /u,
    );
    const facts = trustFacts(unrecorded);
    expect(facts.match(/<strong>models not recorded<\/strong>/gu)).toHaveLength(2);
    expect(facts).not.toContain("<strong>mistral-large-4</strong>");
    expect(facts).toContain("New runs use: mistral-large-4 → gpt-6-luna");
  });

  it("adds no new-runs line when the configured pair is the one the run recorded", () => {
    const same: DesktopReviewState = {
      ...fullSource,
      providerExposure: {
        ...configuredMistral,
        author: { company: "Anthropic", model: "claude-opus-5-5" },
        critic: { company: "OpenAI", model: "gpt-6.1-sol" },
      },
    };
    expect(trustFacts(same)).not.toContain("New runs use:");
  });

  it("keeps the shared-lineage warning on the run's recorded lineages", () => {
    const shared: DesktopReviewState = {
      ...earlier,
      providerExposure: {
        ...configuredMistral,
        independentReview: {
          authorLineage: "open-weights:base",
          criticLineage: "open-weights:base",
          lineagesDistinct: false,
          required: true,
          overrideRationale: null,
        },
      },
    };
    const html = render(shared);
    expect(sidePanelOf(html)).toContain('aria-label="independence warning"');
    expect(trustFacts(shared)).toContain("claimed lineage open-weights:base");
    expect(sidePanelOf(render(earlier))).not.toContain('aria-label="independence warning"');
  });
});

describe("Run details in the review header", () => {
  it("shows the button with the summary as visible text and as its title", () => {
    const html = render(fullSource);
    const summary = "Opus 5.5 → GPT-6.1 Sol · full source, 282 chunks · policy active";
    const header = html.slice(html.indexOf('<header class="spine">'), html.indexOf("</header>"));
    expect(header).toMatch(
      /<button class="run-details-button" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="([^"]+)" title="([^"]+)">/u,
    );
    expect(header).toContain(`title="${summary}"`);
    expect(header).toContain(`<span class="run-details-button-summary">${summary}</span>`);
    // The switcher comes first, then Run details, in the same header zone.
    const meta = header.slice(header.indexOf('class="spine-meta"'));
    expect(meta).toContain("Run details");
  });

  it("controls a closed, hidden dialog labelled by its heading", () => {
    const html = render(fixture);
    const controls = /aria-controls="([^"]+)" title=/u.exec(html)?.[1];
    const drawer = drawerOf(html);
    expect(drawer.startsWith('<div class="run-details-layer" hidden="">')).toBe(true);
    expect(drawer).toContain(`id="${controls}" role="dialog" aria-modal="true"`);
    const labelledBy = /aria-labelledby="([^"]+)"/u.exec(drawer)?.[1];
    expect(drawer).toContain(`<h2 id="${labelledBy}">Run details</h2>`);
  });
});

describe("RunDetailsDrawer", () => {
  function renderDrawer(state: DesktopReviewState, open = true): string {
    return renderToStaticMarkup(
      <RunDetailsDrawer
        id="run-details"
        open={open}
        onClose={() => undefined}
        returnFocusRef={createRef<HTMLElement>()}
        state={state}
        describeState={(value) => value}
        start={{ disabled: false, pending: false, blockedReason: null, onStart: () => undefined }}
        autopilot={null}
      />,
    );
  }

  it("is shown only when open", () => {
    expect(renderDrawer(fixture)).toMatch(/^<div class="run-details-layer">/u);
    expect(renderDrawer(fixture, false)).toMatch(/^<div class="run-details-layer" hidden="">/u);
  });

  it("puts Close first, so opening moves focus to it", () => {
    const html = renderDrawer(stopped);
    const firstControl = /<(button|input|select|textarea|summary|a)\b[^>]*>[^<]*/u.exec(
      html.slice(html.indexOf('role="dialog"')),
    )?.[0];
    expect(firstControl).toBe('<button class="button button-quiet" type="button">Close');
  });

  it("holds identities with lineage, data and writing policy, evidence and the timeline", () => {
    const html = renderDrawer(fullSource);
    expect(html).toContain('aria-label="trust and policy summary"');
    expect(html).toContain("claimed lineage anthropic:claude-sonnet-4-5");
    expect(html).toContain("claimed lineage openai:gpt-5");
    expect(html).toContain("trust-badge-independent");
    expect(html).toContain("Data policy");
    expect(html).toContain("Writing policy");
    expect(html).toContain("Workspace policy");
    expect(html).toMatch(/282 chunks/u);
    expect(html).toContain("full source from 3 sources");
    expect(html).toContain('<ol class="event-list">');
    expect(html).toContain("Critic found an unsupported claim");
  });

  it("offers Start a new review once the run has ended, and explains a blocked start", () => {
    expect(renderDrawer(stopped)).toMatch(
      /<button class="button button-primary" type="button">Start a new review</u,
    );
    expect(renderDrawer(fixture)).not.toContain("Start a new review");
    const blocked = renderToStaticMarkup(
      <RunDetailsDrawer
        id="run-details"
        open
        onClose={() => undefined}
        returnFocusRef={createRef<HTMLElement>()}
        state={stopped}
        describeState={(value) => value}
        start={{
          disabled: true,
          pending: false,
          blockedReason: "Choose a model pair first.",
          onStart: () => undefined,
        }}
        autopilot={null}
      />,
    );
    expect(blocked).toContain("Choose a model pair first.");
    expect(blocked).toMatch(/type="button" disabled="">Start a new review</u);
  });

  it("states the stop reason in plain words once the loop stopped or paused on findings", () => {
    const withReason = (stopReason: string): DesktopReviewState => ({
      ...fixture,
      state: "awaiting-approval",
      evaluation: { ...fixture.evaluation, stopReason },
    });
    expect(renderDrawer(withReason("consensus-ready"))).toContain(
      "Stopped: author and critic agree it&#x27;s ready",
    );
    expect(renderDrawer(withReason("persisting-findings"))).toContain(
      "Paused: the same blocking finding persisted for two rounds — decide it to continue",
    );
    expect(renderDrawer(withReason("blocked-findings"))).not.toContain("Paused:");
  });

  it("leaves the timeline to the side panel while the run executes", () => {
    const html = renderDrawer(running);
    expect(html).not.toContain('<ol class="event-list">');
    expect(html).toContain("progress is in the side panel while it runs.");
  });
});

describe("what stays outside the drawer", () => {
  it("keeps Resume for a paused run in the side panel, one click away", () => {
    const html = render(fixture);
    const side = sidePanelOf(html);
    expect(side).toContain('aria-label="run recovery"');
    expect(side).toMatch(/Resume review<\/button>/u);
    expect(side).not.toContain('aria-label="run progress"');
    expect(drawerOf(html)).not.toContain("Resume");
  });

  it("shows run progress and Stop in the side panel only while the run executes", () => {
    const html = render(running);
    const side = sidePanelOf(html);
    expect(side).toContain('aria-label="run progress"');
    expect(side).toContain("Stop review");
    expect(side).toContain('<ol class="event-list">');
    expect(sidePanelOf(render(fixture))).not.toContain('<ol class="event-list">');
  });

  it("keeps the interrupted run's recovery outside the drawer", () => {
    const html = render({
      ...fixture,
      state: "revising",
      execution: { ...running.execution, status: "interrupted", step: "revision" },
    });
    const outside = outsideDrawer(html);
    expect(outside).toContain("Resume interrupted review");
    expect(outside).toContain("Stop review");
    expect(outside).toContain("previous app session ended");
  });

  it("moves the trust facts and Start a new review into the drawer", () => {
    const html = render(stopped);
    expect(outsideDrawer(html)).not.toContain('aria-label="trust and policy summary"');
    expect(drawerOf(html)).toContain('aria-label="trust and policy summary"');
    expect(sidePanelOf(html)).not.toContain(">Start a new review</button>");
    expect(drawerOf(html)).toMatch(
      /<button class="button button-primary" type="button">Start a new review</u,
    );
  });

  it("leads the Next line to the drawer when starting a new review is the next step", () => {
    const html = render(stopped);
    expect(html).toContain(
      '<button class="next-step-action" type="button">Next: start a new review</button>',
    );
    expect(nextStepOpensRunDetails(stopped, footerBlocker(stopped, null, null))).toBe(true);
    expect(nextStepOpensRunDetails(fixture, footerBlocker(fixture, null, null))).toBe(false);
    expect(nextStepOpensRunDetails(running, footerBlocker(running, null, null))).toBe(false);
  });

  it("keeps a shared-lineage warning in the side panel, not behind the drawer", () => {
    const shared: DesktopReviewState = {
      ...fixture,
      providerExposure: {
        ...fixture.providerExposure,
        independentReview: {
          authorLineage: "open-weights:base",
          criticLineage: "open-weights:base",
          lineagesDistinct: false,
          required: true,
          overrideRationale: "Only one lineage was available for this test.",
        },
      },
    };
    const html = render(shared);
    const side = sidePanelOf(html);
    expect(side).toContain('aria-label="independence warning"');
    expect(side).toContain("trust-badge-shared");
    expect(side).toContain("Only one lineage was available for this test.");
    expect(drawerOf(html)).not.toContain("trust-badge-");
    expect(sidePanelOf(render(fixture))).not.toContain("trust-badge-");
  });
});

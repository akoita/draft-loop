import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  normalizeRunEvidenceMode,
  type RunEvidenceModeView,
  runEvidenceModeDisplay,
} from "./run-evidence-mode.js";

const fullSource: RunEvidenceModeView = {
  requestedMode: "full-source",
  effectiveMode: "full-source",
  chunkCount: 181,
  sourceCount: 1,
};

/** The fixture with readiness saying a fresh retrieval would select 20 excerpts. */
function stateWith(evidenceMode?: RunEvidenceModeView | null): DesktopReviewState {
  const fixture = createFixtureReviewState();
  return {
    ...fixture,
    setup: {
      ...fixture.setup,
      retrievalStatus: "matched",
      selectedEvidenceChunkCount: 20,
      selectedEvidenceSourceCount: 1,
    },
    ...(evidenceMode === undefined ? {} : { evidenceMode }),
  };
}

function render(state: DesktopReviewState): string {
  return renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
}

function strip(html: string): string {
  const match =
    /<section class="retrieval-strip" aria-label="evidence retrieval status">(.*?)<\/section>/su.exec(
      html,
    );
  if (match?.[1] === undefined) throw new Error("Expected the evidence retrieval strip.");
  return match[1];
}

function evidenceFact(html: string): string {
  const match = /<span class="label">Evidence<\/span>(.*?)<\/div>/su.exec(html);
  if (match?.[1] === undefined) throw new Error("Expected the Evidence trust fact.");
  return match[1];
}

describe("run evidence mode in the review", () => {
  it("shows the full-source chunk count instead of the readiness excerpts", () => {
    const html = render(stateWith(fullSource));
    expect(strip(html)).toContain("<strong>Full source</strong>");
    expect(strip(html)).toContain('<span role="status">181 chunks from 1 source</span>');
    expect(strip(html)).not.toContain("relevant excerpt");
    expect(evidenceFact(html)).toBe(
      '<strong class="numeric">181 chunks</strong><span>full source from 1 source</span>',
    );
  });

  it("omits the source count an older run did not record", () => {
    const { sourceCount: _omitted, ...older } = fullSource;
    const html = render(stateWith(older));
    expect(strip(html)).toContain('<span role="status">181 chunks</span>');
    expect(evidenceFact(html)).toContain("<span>full source</span>");
  });

  it("says when full source fell back to retrieval, and why", () => {
    const budget = render(
      stateWith({ ...fullSource, effectiveMode: "retrieval", fallbackReason: "budget-exceeded" }),
    );
    expect(strip(budget)).toContain("<strong>Evidence retrieval</strong>");
    expect(strip(budget)).toContain(
      "Full source did not fit the evidence budget (181 chunks), so retrieval was used",
    );
    expect(evidenceFact(budget)).toBe(
      '<strong class="numeric">20 excerpts</strong><span>retrieval; full source did not fit</span>',
    );

    const empty = render(
      stateWith({
        ...fullSource,
        chunkCount: 0,
        sourceCount: 0,
        effectiveMode: "retrieval",
        fallbackReason: "no-eligible-chunks",
      }),
    );
    expect(strip(empty)).toContain("No eligible chunks for full source, so retrieval was used");
    expect(evidenceFact(empty)).toContain("<span>retrieval; no full-source chunks</span>");
  });

  it("leaves a retrieval run's review exactly as before", () => {
    const before = render(stateWith());
    expect(render(stateWith(null))).toBe(before);
    expect(strip(before)).toContain("<strong>Evidence retrieval</strong>");
    expect(strip(before)).toContain("20 relevant excerpts selected from 1 career-evidence source");
    expect(evidenceFact(before)).toBe(
      '<strong class="numeric">20 excerpts</strong><span>from 1 source</span>',
    );
  });

  it("pluralizes chunks and sources", () => {
    expect(runEvidenceModeDisplay({ ...fullSource, chunkCount: 1, sourceCount: 3 })).toMatchObject({
      stripStatus: "1 chunk from 3 sources",
      panelValue: "1 chunk",
    });
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
describe("run evidence mode over the bridge", () => {
  it("accepts a real full-source and fallback payload unchanged", async () => {
    for (const evidenceMode of [
      fullSource,
      { ...fullSource, effectiveMode: "retrieval", fallbackReason: "budget-exceeded" } as const,
      null,
    ]) {
      const state = { ...createFixtureReviewState(), evidenceMode };
      await expect(loadReview(state)).resolves.toEqual({ ok: true, value: state });
    }
  });

  it("rejects an unexpected key or a malformed value", async () => {
    const fixture = createFixtureReviewState();
    for (const evidenceMode of [
      { ...fullSource, serializedCharacterCount: 90_000 },
      { ...fullSource, effectiveMode: "everything" },
      { ...fullSource, chunkCount: -1 },
      { ...fullSource, fallbackReason: "tired" },
      "full-source",
    ]) {
      await expect(loadReview({ ...fixture, evidenceMode })).resolves.toMatchObject({
        ok: false,
      });
    }
    expect(normalizeRunEvidenceMode({ ...fullSource, sourceCount: 1.5 })).toBeUndefined();
  });
});

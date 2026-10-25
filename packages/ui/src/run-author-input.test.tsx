import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  normalizeRunAuthorInput,
  type RunAuthorInputView,
  runAuthorInputView,
} from "./run-author-input.js";

const sent: RunAuthorInputView = {
  sentChunkCount: 12,
  sentFactCount: 3,
  knowledgeChunkCount: 181,
  knowledgeFactCount: 40,
  unmatchedRequirements: [],
};

function stateWith(authorInput?: RunAuthorInputView | null): DesktopReviewState {
  return {
    ...createFixtureReviewState(),
    ...(authorInput === undefined ? {} : { authorInput }),
  };
}

function render(state: DesktopReviewState): string {
  return renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
}

function authorInputFact(html: string): string {
  const match = /<span class="label">Author input<\/span>(.*?)<\/div>/su.exec(html);
  if (match?.[1] === undefined) throw new Error("Expected the Author input trust fact.");
  return match[1];
}

describe("run author input in the review", () => {
  it("shows the items sent out of the chunk and fact totals", () => {
    expect(authorInputFact(render(stateWith(sent)))).toBe(
      '<strong class="numeric">15 items</strong><span>of 181 chunks and 40 facts</span>',
    );
  });

  it("shows only the chunk total when no profile is pinned", () => {
    const { knowledgeFactCount: _omitted, ...chunksOnly } = sent;
    expect(authorInputFact(render(stateWith({ ...chunksOnly, sentFactCount: 0 })))).toBe(
      '<strong class="numeric">12 items</strong><span>of 181 chunks</span>',
    );
  });

  it("splits the sent items when no totals were recorded", () => {
    expect(
      authorInputFact(
        render(stateWith({ sentChunkCount: 1, sentFactCount: 4, unmatchedRequirements: [] })),
      ),
    ).toBe('<strong class="numeric">5 items</strong><span>1 chunk and 4 facts</span>');
  });

  it("says one item and pluralizes each total", () => {
    expect(
      authorInputFact(
        render(
          stateWith({
            ...sent,
            sentChunkCount: 1,
            sentFactCount: 0,
            knowledgeChunkCount: 1,
            knowledgeFactCount: 1,
          }),
        ),
      ),
    ).toBe('<strong class="numeric">1 item</strong><span>of 1 chunk and 1 fact</span>');
  });

  it("lists the requirements that matched no sent item", () => {
    const html = render(
      stateWith({
        ...sent,
        unmatchedRequirements: ["Lead synthetic platform migrations", "req-unknown"],
      }),
    );
    expect(authorInputFact(html)).toContain(
      "<summary>No sent evidence for 2 requirements</summary>" +
        "<ul><li>Lead synthetic platform migrations</li><li>req-unknown</li></ul>",
    );
    expect(
      authorInputFact(render(stateWith({ ...sent, unmatchedRequirements: ["req-1"] }))),
    ).toContain("<summary>No sent evidence for 1 requirement</summary>");
    expect(authorInputFact(render(stateWith(sent)))).not.toContain("<details");
  });

  it("leaves a run without recorded author input exactly as before", () => {
    const before = render(stateWith());
    expect(render(stateWith(null))).toBe(before);
    expect(before).not.toContain("Author input");
  });
});

describe("run author input view", () => {
  it("resolves requirement texts, falls back to the id, and caps the list", () => {
    const ids = Array.from({ length: 60 }, (_, index) => `req-${index}`);
    // The recorded event, round included, as the application reader returns it.
    const recorded = {
      round: 1,
      sentChunkCount: 2,
      sentFactCount: 0,
      unmatchedRequirementIds: ids,
    };
    const view = runAuthorInputView(
      recorded,
      new Map([["req-0", "Lead synthetic platform migrations"]]),
    );
    expect(view?.unmatchedRequirements).toHaveLength(50);
    expect(view?.unmatchedRequirements.slice(0, 2)).toEqual([
      "Lead synthetic platform migrations",
      "req-1",
    ]);
    expect(view).not.toHaveProperty("knowledgeChunkCount");
  });

  it("lists identical requirement texts once", () => {
    const view = runAuthorInputView(
      { sentChunkCount: 1, sentFactCount: 0, unmatchedRequirementIds: ["a", "b", "c"] },
      new Map([
        ["a", "Own the release process"],
        ["b", "Own the release process"],
      ]),
    );
    expect(view?.unmatchedRequirements).toEqual(["Own the release process", "c"]);
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
describe("run author input over the bridge", () => {
  it("accepts a real payload unchanged", async () => {
    const { knowledgeChunkCount: _c, knowledgeFactCount: _f, ...noTotals } = sent;
    for (const authorInput of [
      sent,
      { ...sent, unmatchedRequirements: ["Lead synthetic platform migrations"] },
      noTotals,
      null,
    ]) {
      const state = { ...createFixtureReviewState(), authorInput };
      await expect(loadReview(state)).resolves.toEqual({ ok: true, value: state });
    }
  });

  it("rejects an unexpected key or a malformed value", async () => {
    const fixture = createFixtureReviewState();
    for (const authorInput of [
      { ...sent, round: 1 },
      { ...sent, unmatchedRequirementIds: [] },
      { ...sent, sentChunkCount: -1 },
      { ...sent, knowledgeChunkCount: 1_000_001 },
      { ...sent, unmatchedRequirements: [7] },
      { ...sent, unmatchedRequirements: Array.from({ length: 51 }, () => "req") },
      { ...sent, unmatchedRequirements: ["x".repeat(2_001)] },
      "15 items",
    ]) {
      await expect(loadReview({ ...fixture, authorInput })).resolves.toMatchObject({
        ok: false,
      });
    }
    expect(normalizeRunAuthorInput({ ...sent, sentFactCount: 1.5 })).toBeUndefined();
  });
});

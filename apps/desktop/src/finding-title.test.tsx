import { createCapabilityPort, type NativeBridge } from "@draft-loop/ui/bridge";
import {
  findingRequirement,
  normalizeFindingRequirement,
} from "@draft-loop/ui/finding-requirement";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  type ReviewFinding,
} from "@draft-loop/ui/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findingTitle } from "./finding-title.js";
import { ReviewWorkspace } from "./review.js";

const requirement = { id: "req-1", text: "Lead synthetic platform migrations" };

function coverageFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "finding-requirement",
    code: "uncovered-requirement",
    category: "coverage",
    severity: "warning",
    message: "Requirement is not covered by deterministic token matching.",
    decision: "pending",
    agreement: "critic-only",
    requirement,
    ...overrides,
  };
}

function stateWith(findings: readonly ReviewFinding[]): DesktopReviewState {
  return { ...createFixtureReviewState(), findings };
}

describe("findingTitle", () => {
  it("names the requirement a word-match coverage finding is about", () => {
    expect(findingTitle(coverageFinding())).toBe(
      "Not found in the CV wording: Lead synthetic platform migrations",
    );
  });

  it("names the requirement whose covering line was removed", () => {
    expect(findingTitle(coverageFinding({ code: "coverage-block-dropped" }))).toBe(
      "A line covering this requirement was removed: Lead synthetic platform migrations",
    );
  });

  it("keeps the message without a resolved requirement or for other codes", () => {
    const { requirement: _omitted, ...unresolved } = coverageFinding();
    expect(findingTitle(unresolved)).toBe(unresolved.message);
    expect(findingTitle(coverageFinding({ code: "unsupported-claim", message: "Cite it." }))).toBe(
      "Cite it.",
    );
    expect(findingTitle(coverageFinding({ code: "toString" }))).toBe(
      "Requirement is not covered by deterministic token matching.",
    );
  });
});

describe("findingRequirement", () => {
  it("resolves the text, collapsing line breaks and bounding its length", () => {
    const texts = new Map([
      ["req-1", "Lead synthetic\r\n  platform\nmigrations"],
      ["req-long", "x".repeat(400)],
    ]);
    expect(findingRequirement("req-1", texts)).toEqual(requirement);
    expect(findingRequirement("req-long", texts)?.text).toHaveLength(300);
  });

  it("omits an unknown, missing, or blank requirement", () => {
    const texts = new Map([["req-blank", " \n "]]);
    expect(findingRequirement("req-unknown", texts)).toBeUndefined();
    expect(findingRequirement(undefined, texts)).toBeUndefined();
    expect(findingRequirement("req-1", undefined)).toBeUndefined();
    expect(findingRequirement("req-blank", texts)).toBeUndefined();
  });
});

describe("finding titles in the review", () => {
  it("renders the requirement-naming title in the finding queue", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={stateWith([coverageFinding()])} onAction={() => undefined} />,
    );
    expect(html).toContain(
      '<span class="finding-summary-message">Not found in the CV wording: Lead synthetic platform migrations</span>',
    );
    expect(html).not.toContain("Requirement is not covered by deterministic token matching.");
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
 * Drift proof: a real payload goes through the real review-state validator, so a finding field
 * added to the interface but not to the runtime allowlist fails here instead of in the app.
 */
describe("finding requirements over the bridge", () => {
  it("accepts a real payload unchanged", async () => {
    const fixture = createFixtureReviewState();
    for (const state of [
      stateWith([...fixture.findings, coverageFinding()]),
      stateWith([coverageFinding({ requirement: { id: "req-2", text: "x".repeat(300) } })]),
      fixture,
    ]) {
      await expect(loadReview(state)).resolves.toEqual({ ok: true, value: state });
    }
  });

  it("rejects an unexpected key or a malformed requirement", async () => {
    for (const finding of [
      { ...coverageFinding(), requirementId: "req-1" },
      coverageFinding({ requirement: { ...requirement, round: 1 } as never }),
      coverageFinding({ requirement: { ...requirement, text: "x".repeat(301) } }),
      coverageFinding({ requirement: { ...requirement, id: "" } }),
      coverageFinding({ requirement: { ...requirement, id: "x".repeat(201) } }),
      coverageFinding({ requirement: { id: "req-1" } as never }),
      coverageFinding({ requirement: "Lead synthetic platform migrations" as never }),
    ]) {
      await expect(loadReview(stateWith([finding]))).resolves.toMatchObject({ ok: false });
    }
    await expect(
      loadReview({ ...createFixtureReviewState(), findings: "none" }),
    ).resolves.toMatchObject({ ok: false });
    expect(normalizeFindingRequirement(requirement)).toEqual(requirement);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { approvalEditNote, ReviewWorkspace } from "./review.js";

const fixture = createFixtureReviewState();

function withEditedFirstBlock(state: DesktopReviewState): DesktopReviewState {
  const [section, ...rest] = state.artifact.sections;
  if (section === undefined) throw new Error("The fixture has no sections.");
  const [block, ...blocks] = section.blocks;
  if (block === undefined) throw new Error("The fixture section has no blocks.");
  return {
    ...state,
    artifact: {
      ...state.artifact,
      sections: [{ ...section, blocks: [{ ...block, edited: true }, ...blocks] }, ...rest],
    },
  };
}

describe("the candidate's edits at approval", () => {
  it("says approving makes the next version with the edits the critic has not reviewed", () => {
    const edited = withEditedFirstBlock(fixture);
    const version = fixture.artifact.version;

    expect(approvalEditNote(fixture.artifact, new Set())).toBeNull();
    expect(approvalEditNote(edited.artifact, new Set())).toBe(
      `Approving makes v${version + 1} with your 1 edit; the critic has not reviewed them.`,
    );
    const firstId = edited.artifact.sections[0]?.blocks[0]?.id ?? "";
    expect(approvalEditNote(edited.artifact, new Set([firstId, "another-block"]))).toBe(
      `Approving makes v${version + 1} with your 2 edits; the critic has not reviewed them.`,
    );
  });

  it("flags a block whose text is the candidate's, including after a reload", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={withEditedFirstBlock(fixture)} onAction={() => undefined} />,
    );
    expect(html).toContain('<span class="block-edited-flag">edited</span>');
    expect(html).toContain("Edits you make here are applied when you approve");
    expect(
      renderToStaticMarkup(<ReviewWorkspace state={fixture} onAction={() => undefined} />),
    ).not.toContain('<span class="block-edited-flag">edited</span>');
  });

  it("lets Approve send the edits past checks that failed on the reviewed version", () => {
    const blocked: DesktopReviewState = {
      ...fixture,
      state: "awaiting-approval",
      findings: fixture.findings
        .filter((finding) => finding.severity === "warning")
        .map((finding) => ({ ...finding, decision: "accepted" as const })),
      approvalReadiness: {
        artifactId: fixture.artifact.id,
        artifactVersion: fixture.artifact.version,
        applicationReady: false,
        blockers: [{ code: "deterministic-error", check: "missing-cv-header" }],
      },
    };
    const approve = /title="Approve artifact \(Alt\+A\)" disabled=""/u;

    expect(
      renderToStaticMarkup(<ReviewWorkspace state={blocked} onAction={() => undefined} />),
    ).toMatch(approve);
    // The host checks the edited version again, so a fixed header no longer waits for an override.
    expect(
      renderToStaticMarkup(
        <ReviewWorkspace state={withEditedFirstBlock(blocked)} onAction={() => undefined} />,
      ),
    ).not.toMatch(approve);
  });
});

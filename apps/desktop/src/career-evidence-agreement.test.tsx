import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CareerEvidenceStatus } from "./career-evidence.js";
import { CareerEvidenceCardView } from "./career-evidence-card.js";
import { HomeView } from "./home.js";

/** A workspace whose only evidence is files in its `evidence` folder, with no base selected. */
const noBase: CareerEvidenceStatus = { kind: "none" };

function home(legacyEvidenceSourceCount: number): string {
  return renderToStaticMarkup(
    <HomeView
      workspaceTitle={<h1>Demo workspace</h1>}
      workspaceNavigation={null}
      profile={{ kind: "none" }}
      evidence={noBase}
      legacyEvidenceSourceCount={legacyEvidenceSourceCount}
      applications={{ status: "ready", applications: [] }}
      now={new Date("2026-10-08T12:00:00.000Z")}
      onOpenApplication={() => undefined}
      onManageProfile={() => undefined}
      onManageEvidence={() => undefined}
    />,
  );
}

function evidencePage(legacyEvidenceSourceCount: number): string {
  return renderToStaticMarkup(
    <CareerEvidenceCardView
      status={noBase}
      setup={{
        evidenceSourceCount: legacyEvidenceSourceCount,
        retrievalStatus: "not-indexed",
        selectedEvidenceChunkCount: 0,
        selectedEvidenceSourceCount: 0,
      }}
      pending={false}
      disabled={false}
      message={null}
      error={null}
      url=""
      onUrlChange={() => undefined}
      onAddFile={() => undefined}
      onAddUrl={() => undefined}
      onChooseKnowledgeBase={() => undefined}
      canAddFile
      canAddUrl
      automatic
    />,
  );
}

describe("Home and the Career evidence page agree on workspace evidence files", () => {
  it("reports a legacy-only workspace as ready on both views, with the same file count", () => {
    const homeHtml = home(1);
    expect(homeHtml).toContain("Ready");
    expect(homeHtml).toContain("1 source file in this workspace");
    expect(homeHtml).not.toContain("No career evidence yet");

    const pageHtml = evidencePage(1);
    expect(pageHtml).toContain("Ready");
    expect(pageHtml).not.toContain("Required");
    expect(pageHtml).toContain("Workspace evidence files: 1 file");
    expect(pageHtml).toContain("Runs use these files while no knowledge base is selected.");
    expect(pageHtml).not.toContain("No career evidence yet");
  });

  it("reports a workspace without any evidence as empty on both views", () => {
    const homeHtml = home(0);
    expect(homeHtml).toContain("No career evidence yet");
    expect(homeHtml).toContain("None yet");

    const pageHtml = evidencePage(0);
    expect(pageHtml).toContain("No career evidence yet");
    expect(pageHtml).toContain("Required");
    expect(pageHtml).not.toContain("Workspace evidence files");
  });
});

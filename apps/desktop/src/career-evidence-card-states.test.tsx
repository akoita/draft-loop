import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CareerEvidenceStatus } from "./career-evidence.js";
import {
  CareerEvidenceCardView,
  type CareerEvidenceCardViewProps,
} from "./career-evidence-card.js";

const setup = {
  evidenceSourceCount: 0,
  retrievalStatus: "not-indexed" as const,
  selectedEvidenceChunkCount: 0,
  selectedEvidenceSourceCount: 0,
};

function render(
  status: CareerEvidenceStatus,
  overrides: Partial<CareerEvidenceCardViewProps> = {},
): string {
  return renderToStaticMarkup(
    <CareerEvidenceCardView
      status={status}
      setup={setup}
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
      {...overrides}
    />,
  );
}

const fresh: CareerEvidenceStatus = { kind: "none" };

describe("Career evidence card without a selected base", () => {
  it("creates the base on the first add when the workspace has no legacy evidence", () => {
    const html = render(fresh, { automatic: true });
    expect(html).toContain("No career evidence yet");
    expect(html).toContain("creates a knowledge base for this workspace in");
    expect(html).toContain("DraftLoop application data");
    expect(html).toContain(">Add files<");
    expect(html).toContain(">Review and fetch source URL<");
    expect(html).not.toContain("legacy");
    expect(html).not.toContain("Import legacy evidence");
    expect(html).toContain("Required");
  });

  it("ignores legacy workspace evidence: no import offer, and the first add still creates a base", () => {
    const html = render(fresh, {
      automatic: true,
      setup: { ...setup, evidenceSourceCount: 3 },
    });
    expect(html).toContain("No career evidence yet");
    expect(html).toContain(">Add files<");
    expect(html).not.toContain("legacy");
    expect(html).not.toContain("Keep using");
    expect(html).toContain("Required");
  });

  it("takes several URLs and says how many it will fetch", () => {
    const html = render(fresh, {
      automatic: true,
      url: "https://example.com/a\nhttps://example.com/b https://example.com/a",
    });
    expect(html).toContain("Or provide public URLs, one per line");
    expect(html).toContain("<textarea");
    expect(html).toContain(">Review and fetch 2 source URLs<");
  });

  it("asks for one URL at a time on legacy evidence", () => {
    const html = render(fresh, { url: "https://example.com/a\nhttps://example.com/b" });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Legacy evidence takes one URL at a time</);
    expect(render(fresh, { url: "https://example.com/a" })).toContain(
      ">Add URL to legacy evidence<",
    );
  });

  it("keeps the legacy path in a host that cannot create a base", () => {
    const html = render(fresh, { setup: { ...setup, evidenceSourceCount: 3 } });
    expect(html).toContain("No knowledge base selected");
    expect(html).not.toContain("Import legacy evidence");
  });
});

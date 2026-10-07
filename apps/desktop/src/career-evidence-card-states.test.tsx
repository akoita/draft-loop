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

const fresh: CareerEvidenceStatus = { kind: "none", legacyDeclined: false };

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

  it("offers a one-time import, with a decline, instead of add actions", () => {
    const html = render(fresh, {
      automatic: true,
      setup: { ...setup, evidenceSourceCount: 3 },
    });
    expect(html).toContain("This workspace has 3 legacy evidence files.");
    expect(html).toContain("into a knowledge base?");
    expect(html).toContain("The workspace files are not changed.");
    expect(html).toContain(">Import legacy evidence<");
    expect(html).toContain(">Keep using legacy evidence<");
    expect(html).not.toContain("Add to legacy workspace evidence");
    expect(html).not.toContain("Add files");
    const single = render(fresh, {
      automatic: true,
      setup: { ...setup, evidenceSourceCount: 1 },
    });
    expect(single).toContain("1 legacy evidence file.");
  });

  it("disables the offer while an action runs", () => {
    const html = render(fresh, {
      automatic: true,
      pending: true,
      setup: { ...setup, evidenceSourceCount: 3 },
    });
    expect(html.match(/disabled=""/gu)?.length).toBe(2);
  });

  it("keeps the legacy copy and buttons after the person declines", () => {
    const html = render(
      { kind: "none", legacyDeclined: true },
      { automatic: true, setup: { ...setup, evidenceSourceCount: 3 } },
    );
    expect(html).toContain("No knowledge base selected — runs will use legacy workspace evidence");
    expect(html).toContain(">Add to legacy workspace evidence<");
    expect(html).not.toContain("Import legacy evidence");
  });

  it("keeps the legacy path in a host that cannot create a base", () => {
    const html = render(fresh, { setup: { ...setup, evidenceSourceCount: 3 } });
    expect(html).toContain("No knowledge base selected");
    expect(html).not.toContain("Import legacy evidence");
  });
});

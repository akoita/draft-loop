import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CareerEvidenceStatus } from "./career-evidence.js";
import {
  CareerEvidenceCard,
  CareerEvidenceCardView,
  type CareerEvidenceCardViewProps,
  focusKnowledgeStore,
  knowledgeStoreFocusTargetId,
  legacyRetrievalText,
} from "./career-evidence-card.js";

const setup = {
  evidenceSourceCount: 0,
  retrievalStatus: "not-indexed" as const,
  selectedEvidenceChunkCount: 0,
  selectedEvidenceSourceCount: 0,
};

const selected: Extract<CareerEvidenceStatus, { kind: "selected" }> = {
  kind: "selected",
  storeId: "store-1",
  knowledgeBaseId: "base-1",
  displayName: "Engineering",
  sourceCount: 3,
  blockedCount: 0,
  semanticLine: null,
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

describe("Career evidence setup card", () => {
  it("shows the selected base, its source count and readiness, and ignores legacy evidence", () => {
    const html = render(selected, {
      setup: { ...setup, evidenceSourceCount: 9 },
    });
    expect(html).toContain("Career evidence");
    expect(html).not.toContain("Candidate source material");
    expect(html).toContain("Engineering · 3 sources");
    expect(html).toContain("Ready");
    expect(html).not.toContain("9 source");
    expect(html).not.toContain("legacy");
    expect(html).toContain("setup-card-ready");
    expect(html).toContain(">Add files<");
    expect(html).toContain(">Review and fetch source URL<");
    expect(html).not.toContain("Semantic search");
  });

  it("has no Manage button: adding and choosing the base both live in this one card", () => {
    const html = render(selected, {
      knowledgeBase: <section id="candidate-knowledge-heading">Knowledge base</section>,
    });
    expect(html).not.toContain(">Manage<");
    expect(html).toMatch(/Review and fetch source URL<\/button><section[^>]*>Knowledge base</);
    expect(html.indexOf("</section>")).toBeLessThan(html.indexOf("</article>"));
  });

  it("offers Add folder next to Add files only when evidence goes into a knowledge base", () => {
    const withFolder = { onAddFolder: () => undefined };
    expect(render(selected, withFolder)).toMatch(/>Add files<\/button><button[^>]*>Add folder</);
    expect(render(selected)).not.toContain(">Add folder<");
    expect(render({ kind: "none" }, withFolder)).not.toContain(">Add folder<");
    expect(render({ kind: "unsupported" }, withFolder)).not.toContain(">Add folder<");
    expect(
      render({ kind: "none", legacyDeclined: false }, { ...withFolder, automatic: true }),
    ).toContain(">Add folder<");
    expect(render(selected, { ...withFolder, pending: true })).toMatch(
      /<button[^>]*disabled=""[^>]*>Add folder</,
    );
  });

  it("shows the already-in-Career-evidence notice after an identical file is added again", () => {
    const html = render(
      { ...selected, displayName: "Career evidence" },
      { message: "Already in Career evidence. 3 sources, 3 ready." },
    );
    expect(html).toContain("Already in Career evidence. 3 sources, 3 ready.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("targets the Knowledge base heading", () => {
    expect(knowledgeStoreFocusTargetId).toBe("candidate-knowledge-heading");
  });

  it("shows the semantic index line in semantic or hybrid mode", () => {
    const html = render({ ...selected, semanticLine: "Semantic search: model not installed" });
    expect(html).toContain("Semantic search: model not installed");
  });

  it("is required and invites a first source when the selected base is empty", () => {
    const html = render(
      { ...selected, sourceCount: 0 },
      { setup: { ...setup, evidenceSourceCount: 4 } },
    );
    expect(html).toContain("Engineering · 0 sources");
    expect(html).toContain("Empty: add a CV, portfolio, or other source");
    expect(html).toContain("Required");
    expect(html).not.toContain("setup-card-ready");
    expect(html).not.toContain("4 source");
  });

  it("states plainly that no base is selected and keeps only legacy add buttons", () => {
    const html = render({ kind: "none" }, { setup: { ...setup, evidenceSourceCount: 2 } });
    expect(html).toContain("No knowledge base selected — runs will use legacy workspace evidence");
    expect(html).toContain("(2 sources)");
    expect(html).toContain("Create or choose a knowledge base");
    expect(html).toContain(">Add to legacy workspace evidence<");
    expect(html).toContain("Ready");
    expect(render({ kind: "none" })).toContain("Required");
  });

  it("offers no add actions while the saved base cannot be opened", () => {
    const html = render({ kind: "unavailable" });
    expect(html).toContain("could not be opened");
    expect(html).not.toContain("Add files");
    expect(html).not.toContain("Review and fetch");
  });

  it("keeps the previous copy and actions in a host without knowledge selection", () => {
    const html = render(
      { kind: "unsupported" },
      { setup: { ...setup, evidenceSourceCount: 1, retrievalStatus: "matched" } },
    );
    expect(html).toContain("1 source ready");
    expect(html).toContain("Add source files");
    expect(html).toContain("Review and fetch source URL");
    expect(html).not.toContain("No knowledge base selected");
  });

  it("disables the add actions while loading, busy, or without a URL", () => {
    expect(render({ kind: "loading" })).toContain("Checking the knowledge base…");
    const busy = render(selected, { disabled: true, url: "https://example.com" });
    expect(busy.match(/disabled=""/gu)?.length).toBe(2);
    const idle = render(selected);
    expect(idle.match(/disabled=""/gu)?.length).toBe(1);
  });

  it("renders the legacy card without a knowledge binding", () => {
    const html = renderToStaticMarkup(
      <CareerEvidenceCard
        setup={{ ...setup, evidenceSourceCount: 1 }}
        onSelectLegacyFiles={() => undefined}
        onAddLegacyUrl={() => undefined}
      />,
    );
    expect(html).toContain("Career evidence");
    expect(html).toContain("Add source files");
  });

  it("explains the legacy retrieval status", () => {
    expect(
      legacyRetrievalText({
        retrievalStatus: "matched",
        selectedEvidenceChunkCount: 2,
        selectedEvidenceSourceCount: 1,
      }),
    ).toBe("2 relevant excerpts selected from 1 source");
    expect(legacyRetrievalText(setup)).toBe("Evidence will be indexed when the review starts");
  });

  it("scrolls to and focuses the Knowledge base heading", () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const documentRef = {
      getElementById: (id: string) =>
        id === knowledgeStoreFocusTargetId ? { scrollIntoView, focus } : null,
    } as unknown as Document;
    expect(focusKnowledgeStore(documentRef)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(focusKnowledgeStore({ getElementById: () => null } as unknown as Document)).toBe(false);
  });
});

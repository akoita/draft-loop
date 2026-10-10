import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CareerEvidenceCardView } from "./career-evidence-card.js";
import type { SourceEvidenceKindSummary } from "./source-evidence-kind-contract.js";
import { SourceEvidenceKindList, type SourceEvidenceKindsState } from "./source-evidence-kinds.js";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement(node)) return [];
  const children = (node as ReactElement<{ readonly children?: ReactNode }>).props.children;
  return [
    node as ReactElement<Record<string, unknown>>,
    ...Children.toArray(children).flatMap(elements),
  ];
}

const sources: readonly SourceEvidenceKindSummary[] = [
  { sourceId: "source-1", displayName: "resume.pdf", kind: "cv", origin: "detected" },
  {
    sourceId: "source-2",
    displayName: "2025 review.docx",
    kind: "performance-review",
    origin: "user",
  },
];

function ready(overrides: Partial<Extract<SourceEvidenceKindsState, { status: "ready" }>> = {}) {
  return {
    status: "ready" as const,
    sources,
    truncated: false,
    savingSourceId: null,
    error: null,
    ...overrides,
  };
}

describe("source evidence kinds in Manage career evidence", () => {
  it("shows each source's kind and whether it was detected or set by the person", () => {
    const html = renderToStaticMarkup(
      <SourceEvidenceKindList state={ready()} disabled={false} onChange={() => undefined} />,
    );
    expect(html).toContain("What each source is (2)");
    expect(html).toContain("resume.pdf");
    expect(html).toContain('aria-label="Evidence kind of resume.pdf"');
    expect(html).toMatch(/<option value="cv" selected="">CV<\/option>/u);
    expect(html).toMatch(
      /<option value="performance-review" selected="">Performance review<\/option>/u,
    );
    expect(html).toContain("detected");
    expect(html).toContain("set by you");
    expect(html.match(/use detected/gu)).toHaveLength(1);
  });

  it("sets a kind from the select and clears an override with use detected", () => {
    const onChange = vi.fn();
    const view = SourceEvidenceKindList({ state: ready(), disabled: false, onChange });
    const select = elements(view).find((element) => element.type === "select");
    const clear = elements(view).find(
      (element) => element.type === "button" && element.props.children === "use detected",
    );
    if (select === undefined || clear === undefined) throw new Error("Controls were not rendered.");
    const choose = select.props.onChange as (event: { target: { value: string } }) => void;
    choose({ target: { value: "transcript" } });
    choose({ target: { value: "resume" } });
    (clear.props.onClick as () => void)();
    expect(onChange.mock.calls).toEqual([
      ["source-1", "transcript"],
      ["source-2", null],
    ]);
  });

  it("locks every control while one kind is saving or the card is busy", () => {
    const saving = renderToStaticMarkup(
      <SourceEvidenceKindList
        state={ready({ savingSourceId: "source-1" })}
        disabled={false}
        onChange={() => undefined}
      />,
    );
    expect(saving).toContain("saving…");
    expect(saving.match(/<select[^>]*disabled=""/gu)).toHaveLength(2);
    const busy = renderToStaticMarkup(
      <SourceEvidenceKindList state={ready()} disabled onChange={() => undefined} />,
    );
    expect(busy.match(/<select[^>]*disabled=""/gu)).toHaveLength(2);
  });

  it("reports loading, an unreadable listing, truncation and a save error", () => {
    const render = (state: SourceEvidenceKindsState) =>
      renderToStaticMarkup(
        <SourceEvidenceKindList state={state} disabled={false} onChange={() => undefined} />,
      );
    expect(render({ status: "loading" })).toContain("Reading what each source is");
    expect(render({ status: "unavailable" })).toContain("could not be read");
    expect(render(ready({ sources: [] }))).toBe("");
    expect(render(ready({ truncated: true }))).toContain("Only the first sources are listed.");
    expect(render(ready({ error: "Source source-1 is retired." }))).toContain(
      'role="alert">Source source-1 is retired.',
    );
  });

  it("appears in the card under the selected base", () => {
    const html = renderToStaticMarkup(
      <CareerEvidenceCardView
        status={{
          kind: "selected",
          storeId: "store-1",
          knowledgeBaseId: "base-1",
          displayName: "Engineering",
          sourceCount: 2,
          blockedCount: 0,
          semanticLine: null,
        }}
        setup={{
          evidenceSourceCount: 0,
          retrievalStatus: "not-indexed",
          selectedEvidenceChunkCount: 0,
          selectedEvidenceSourceCount: 0,
        }}
        pending
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
        evidenceKinds={{ state: ready(), onChange: () => undefined }}
      />,
    );
    expect(html).toContain("What each source is (2)");
    // A pending add locks the kind controls too.
    expect(html.match(/<select[^>]*disabled=""/gu)).toHaveLength(2);
  });
});

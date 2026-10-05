import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReviewEvent } from "./model.js";
import {
  collapsedReviewPanelsStorageKey,
  groupRepeatedReviewEvents,
  PanelToggle,
  parseCollapsedReviewPanels,
  RunTimeline,
  readStoredCollapsedReviewPanels,
  recentReviewEventRowLimit,
  writeStoredCollapsedReviewPanels,
} from "./review-panels.js";

function event(id: string, label: string, state: ReviewEvent["state"]): ReviewEvent {
  return { id, label, state, createdAt: "2026-10-05T00:00:00.000Z" };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

describe("review panel disclosure", () => {
  it("reads stored panel ids and ignores anything it does not know", () => {
    expect([...parseCollapsedReviewPanels('["gate","progress"]')]).toEqual(["gate", "progress"]);
    expect([...parseCollapsedReviewPanels('["gate","trust",3]')]).toEqual(["gate"]);
    expect(parseCollapsedReviewPanels("garbage").size).toBe(0);
    expect(parseCollapsedReviewPanels('{"gate":true}').size).toBe(0);
    expect(parseCollapsedReviewPanels(null).size).toBe(0);
  });

  it("round-trips the folded panels through storage in a stable order", () => {
    const storage = memoryStorage();
    writeStoredCollapsedReviewPanels(storage, new Set(["gate", "progress"]));
    expect(storage.values.get(collapsedReviewPanelsStorageKey)).toBe('["progress","gate"]');
    expect([...readStoredCollapsedReviewPanels(storage)]).toEqual(["progress", "gate"]);
  });

  it("treats an unavailable store as nothing folded", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredCollapsedReviewPanels(throwing).size).toBe(0);
    expect(() => writeStoredCollapsedReviewPanels(throwing, new Set(["gate"]))).not.toThrow();
    expect(readStoredCollapsedReviewPanels(undefined).size).toBe(0);
  });

  it("names the region it folds and whether it is open", () => {
    const html = renderToStaticMarkup(
      <PanelToggle label="Human gate" collapsed={true} controls="gate-body" onToggle={() => {}} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="gate-body"');
    expect(html).toContain("Human gate");
  });
});

describe("run timeline", () => {
  it("folds consecutive identical events and keeps the order they happened in", () => {
    const groups = groupRepeatedReviewEvents([
      event("1", "author execution failed", "provider-error"),
      event("2", "author execution failed", "provider-error"),
      event("3", "author execution completed", "drafting"),
      event("4", "Finding decision recorded: accepted", "awaiting-approval"),
      event("5", "Finding decision recorded: accepted", "awaiting-approval"),
      event("6", "Finding decision recorded: accepted", "awaiting-approval"),
      event("7", "Finding decision recorded: rejected", "awaiting-approval"),
      event("8", "author execution failed", "provider-error"),
    ]);
    expect(groups.map((group) => [group.id, group.label, group.count])).toEqual([
      ["1", "author execution failed", 2],
      ["3", "author execution completed", 1],
      ["4", "Finding decision recorded: accepted", 3],
      ["7", "Finding decision recorded: rejected", 1],
      ["8", "author execution failed", 1],
    ]);
  });

  it("shows a repeat count and only the most recent rows of a long run", () => {
    const events = [
      ...Array.from({ length: recentReviewEventRowLimit + 2 }, (_, index) =>
        event(`step-${index}`, `step ${index} completed`, "drafting"),
      ),
      ...Array.from({ length: 16 }, (_, index) =>
        event(`decision-${index}`, "Finding decision recorded: accepted", "awaiting-approval"),
      ),
    ];
    const html = renderToStaticMarkup(
      <RunTimeline events={events} describeState={(state) => state.replaceAll("-", " ")} />,
    );
    expect(html.match(/<li>/gu)).toHaveLength(recentReviewEventRowLimit);
    expect(html).toContain("×16");
    expect(html).toContain(", 16 times");
    expect(html).toContain("Show 3 earlier events");
    expect(html).not.toContain("step 0 completed");
    expect(html).toContain(`step ${recentReviewEventRowLimit + 1} completed`);
  });

  it("offers no fold for a short run", () => {
    const html = renderToStaticMarkup(
      <RunTimeline
        events={[event("1", "Run created", "drafting")]}
        describeState={(state) => state}
      />,
    );
    expect(html).not.toContain("earlier event");
    expect(html.match(/<li>/gu)).toHaveLength(1);
  });
});

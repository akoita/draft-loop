import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  type DraftEditBufferState,
  draftEditReducer,
  emptyDraftEditBuffer,
  hasUnsavedDraftEdits,
  nextDraftEditToSave,
} from "./draft-edit-buffer.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const saved = new Map([
  ["header", "[Your name] | [Email]"],
  ["bullet", "Built a service."],
]);
const open = { busy: false, editable: true };

function apply(...events: Parameters<typeof draftEditReducer>[1][]): DraftEditBufferState {
  return events.reduce(draftEditReducer, emptyDraftEditBuffer);
}

describe("the candidate's typing in a draft block (#1925)", () => {
  it("keeps every keystroke and saves one edit once the person pauses or leaves", () => {
    const typing = apply(
      { type: "change", blockId: "header", text: "A" },
      { type: "change", blockId: "header", text: "Al" },
      { type: "change", blockId: "header", text: "Alex Example" },
    );
    expect(typing.entries.get("header")?.text).toBe("Alex Example");
    expect(hasUnsavedDraftEdits(typing, saved)).toBe(true);
    // Still typing: nothing is sent yet.
    expect(nextDraftEditToSave(typing, saved, open)).toBeNull();

    const paused = draftEditReducer(typing, { type: "settle", blockId: "header" });
    expect(nextDraftEditToSave(paused, saved, open)).toEqual({
      blockId: "header",
      text: "Alex Example",
    });
    // Another action pending, or a draft that is not open for edits, sends nothing.
    expect(nextDraftEditToSave(paused, saved, { ...open, busy: true })).toBeNull();
    expect(nextDraftEditToSave(paused, saved, { ...open, editable: false })).toBeNull();
  });

  it("drops its copy when the save completes, so the screen shows what the host holds", () => {
    const sent = apply(
      { type: "change", blockId: "header", text: "Alex Example" },
      { type: "settle", blockId: "header" },
      { type: "sent", blockId: "header", text: "Alex Example" },
    );
    // One save at a time, and it counts as unsaved until it completes.
    expect(nextDraftEditToSave(sent, saved, open)).toBeNull();
    expect(hasUnsavedDraftEdits(sent, saved)).toBe(true);

    const pending = draftEditReducer(sent, { type: "busy", busy: true });
    const done = draftEditReducer(pending, { type: "busy", busy: false });
    expect(done.inFlight).toBeNull();
    expect(done.entries.has("header")).toBe(false);
    expect(hasUnsavedDraftEdits(done, saved)).toBe(false);
  });

  it("keeps text typed while the save was pending and saves it next", () => {
    const state = apply(
      { type: "change", blockId: "header", text: "Alex" },
      { type: "settle", blockId: "header" },
      { type: "sent", blockId: "header", text: "Alex" },
      { type: "busy", busy: true },
      { type: "change", blockId: "header", text: "Alex Example" },
      { type: "busy", busy: false },
      { type: "saved", savedText: new Map([...saved, ["header", "Alex"]]) },
      { type: "settle", blockId: "header" },
    );
    expect(state.entries.get("header")?.text).toBe("Alex Example");
    expect(nextDraftEditToSave(state, new Map([...saved, ["header", "Alex"]]), open)).toEqual({
      blockId: "header",
      text: "Alex Example",
    });
  });

  it("sends a save again when the first never started", () => {
    const sent = apply(
      { type: "change", blockId: "bullet", text: "Built and ran a service." },
      { type: "settle", blockId: "bullet" },
      { type: "sent", blockId: "bullet", text: "Built and ran a service." },
    );
    const lost = draftEditReducer(sent, { type: "lost" });
    expect(nextDraftEditToSave(lost, saved, open)).toEqual({
      blockId: "bullet",
      text: "Built and ran a service.",
    });
  });

  it("forgets text the host already holds and blocks the draft no longer has", () => {
    const state = apply(
      { type: "change", blockId: "header", text: "Alex Example" },
      { type: "change", blockId: "gone", text: "Old block" },
      { type: "saved", savedText: new Map([...saved, ["header", "Alex Example"]]) },
    );
    expect(state.entries.size).toBe(0);
  });
});

describe("the draft's edit lock (#1925)", () => {
  const fixture = createFixtureReviewState();

  it("is editable while the review waits for the person", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={fixture} onAction={() => undefined} />,
    );
    expect(html).toContain("editable</span>");
    expect(html).toContain("Edits you make here are applied when you approve");
  });

  it("locks the draft while a round runs", () => {
    const running: DesktopReviewState = { ...fixture, state: "reviewing" };
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={running} onAction={() => undefined} />,
    );
    expect(html).toContain("read-only</span>");
    expect(html).toContain("You can edit the draft once this round finishes.");
  });

  it("locks the draft once the run is approved", () => {
    const approved: DesktopReviewState = { ...fixture, state: "approved", approval: "approved" };
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={approved} onAction={() => undefined} />,
    );
    expect(html).toContain("read-only</span>");
    expect(html).toContain("This draft is approved; edits are closed.");
    expect(html).not.toContain("Edits you make here are applied when you approve");
  });
});

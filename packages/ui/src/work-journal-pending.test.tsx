import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pendingNotesText, WorkJournalPending } from "./work-journal-pending.js";

describe("Home's waiting work journal notes", () => {
  it("shows one waiting note with a link to review it", () => {
    const html = renderToStaticMarkup(<WorkJournalPending count={1} onOpen={() => {}} />);

    expect(html).toContain("1 work journal note waits for your review.");
    expect(html).toContain("Review notes");
  });

  it("shows nothing when no note waits or before the count is read", () => {
    expect(renderToStaticMarkup(<WorkJournalPending count={0} onOpen={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<WorkJournalPending count={undefined} onOpen={() => {}} />)).toBe(
      "",
    );
  });

  it("counts several notes, and caps the count at one read", () => {
    expect(pendingNotesText(3)).toBe("3 work journal notes wait for your review.");
    expect(pendingNotesText(50)).toBe("50 or more work journal notes wait for your review.");
  });
});

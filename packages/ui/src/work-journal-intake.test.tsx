import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { reviewNotesLabel, WorkJournalIntake } from "./work-journal-intake.js";

describe("work journal switch in Agents", () => {
  it("shows the switch as set, with what it allows", () => {
    const html = renderToStaticMarkup(
      <WorkJournalIntake enabled onSet={async () => undefined} onReview={() => undefined} />,
    );
    expect(html).toContain("Accept notes from agents");
    expect(html).toMatch(/type="checkbox" checked=""/u);
    expect(html).toContain("Nothing becomes career evidence until you approve it.");
    expect(html).toContain("Review notes");
  });

  it("is off and disabled until the setting is read", () => {
    const html = renderToStaticMarkup(
      <WorkJournalIntake enabled={undefined} onSet={async () => undefined} />,
    );
    expect(html).toMatch(/type="checkbox" disabled=""/u);
    expect(html).not.toContain("Review notes");
  });

  it("counts the notes that wait in the link", () => {
    expect(reviewNotesLabel(undefined)).toBe("Review notes");
    expect(reviewNotesLabel(0)).toBe("Review notes");
    expect(reviewNotesLabel(3)).toBe("Review notes (3 waiting)");
    expect(reviewNotesLabel(50)).toBe("Review notes (50 or more waiting)");
  });
});

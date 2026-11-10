import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  reviewNotesLabel,
  stopIntakeConsequence,
  WorkJournalIntake,
} from "./work-journal-intake.js";

const onSet = async () => undefined;

describe("notes from agents in Agents", () => {
  it("says it is on in words and offers to stop, with no checkbox to flip", () => {
    const html = renderToStaticMarkup(
      <WorkJournalIntake enabled onSet={onSet} onReview={() => undefined} />,
    );
    expect(html).toContain(">On</span>");
    expect(html).toContain("Agents can add notes to your Work journal.");
    expect(html).toContain("Stop accepting notes");
    expect(html).not.toContain(">Accept notes from agents<");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Review notes");
  });

  it("says it is off and names the button that turns it on", () => {
    const html = renderToStaticMarkup(<WorkJournalIntake enabled={false} onSet={onSet} />);
    expect(html).toContain(">Off</span>");
    expect(html).toContain("Agents cannot add notes to your Work journal.");
    expect(html).toContain(">Accept notes from agents<");
    expect(html).not.toContain("Stop accepting");
    expect(html).not.toContain("Review notes");
  });

  it("shows no state and a disabled button until the setting is read", () => {
    const html = renderToStaticMarkup(<WorkJournalIntake enabled={undefined} onSet={onSet} />);
    expect(html).not.toContain(">On</span>");
    expect(html).not.toContain(">Off</span>");
    expect(html).toMatch(/disabled=""[^>]*>Accept notes from agents</u);
  });

  it("asks before stopping, saying what is refused and what stays", () => {
    const html = renderToStaticMarkup(
      <WorkJournalIntake enabled pending={3} onSet={onSet} confirmingStop />,
    );
    expect(html).toContain("Stop accepting notes from agents?");
    expect(html).toContain("will be refused until you turn this back on.");
    expect(html).toContain("The notes already waiting stay for review.");
    expect(html).toContain(">Stop accepting<");
    expect(html).toContain(">Keep accepting<");
  });

  it("never asks while it is off", () => {
    const html = renderToStaticMarkup(
      <WorkJournalIntake enabled={false} onSet={onSet} confirmingStop />,
    );
    expect(html).not.toContain("Stop accepting notes from agents?");
  });

  it("mentions waiting notes only when some wait", () => {
    expect(stopIntakeConsequence(undefined)).not.toContain("waiting");
    expect(stopIntakeConsequence(0)).not.toContain("waiting");
    expect(stopIntakeConsequence(1)).toContain("The note already waiting stays for review.");
  });

  it("counts the notes that wait in the link", () => {
    expect(reviewNotesLabel(undefined)).toBe("Review notes");
    expect(reviewNotesLabel(0)).toBe("Review notes");
    expect(reviewNotesLabel(3)).toBe("Review notes (3 waiting)");
    expect(reviewNotesLabel(50)).toBe("Review notes (50 or more waiting)");
  });
});

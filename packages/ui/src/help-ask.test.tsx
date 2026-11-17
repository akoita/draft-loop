import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  assistantTurn,
  type HelpSupport,
  memberTurn,
  offersPerson,
  transcriptOf,
} from "./help-ask-model.js";
import { HelpDialog } from "./help-panel.js";
import { ScreensI18nProvider } from "./i18n.js";

const words = { fallbackText: "Sections match:", noMatchText: "Nothing matches." };

const support: HelpSupport = {
  start: async () => ({ conversationId: "sup_0123456789", assistantAvailable: true }),
  ask: async () => ({ mode: "assistant", outcome: "answered", text: "Yes.", sections: [] }),
};

describe("the Help panel's Ask conversation (#2883)", () => {
  it("keeps an answer's text and sources, and asks for a person when the answer does", () => {
    const answered = assistantTurn(
      {
        mode: "assistant",
        outcome: "answered",
        text: "Approve, then select Export.",
        sections: [{ id: "review", title: "Review and export" }],
      },
      words,
    );
    expect(answered).toEqual({
      role: "assistant",
      text: "Approve, then select Export.",
      sources: [{ id: "review", title: "Review and export" }],
      fallback: false,
      needsPerson: false,
    });
    expect(offersPerson([memberTurn("How?"), answered])).toBe(false);

    const person = assistantTurn(
      { mode: "assistant", outcome: "needs_person", text: "A person can help.", sections: [] },
      words,
    );
    expect(offersPerson([memberTurn("I was charged twice"), person])).toBe(true);
  });

  it("words a guide-search reply itself, and offers a person when nothing matches", () => {
    const found = assistantTurn(
      {
        mode: "guide_search",
        outcome: null,
        text: null,
        sections: [{ id: "credits", title: "Plans and credits" }],
      },
      words,
    );
    expect(found).toMatchObject({ text: "Sections match:", fallback: true, needsPerson: false });
    const none = assistantTurn(
      { mode: "guide_search", outcome: null, text: null, sections: [] },
      words,
    );
    expect(none).toMatchObject({ text: "Nothing matches.", needsPerson: true });
  });

  it("sends the last twenty turns, bounded, without the sources", () => {
    const turns = Array.from({ length: 25 }, (_, index) =>
      memberTurn(`q${index} ${"x".repeat(2100)}`),
    );
    const transcript = transcriptOf(turns);
    expect(transcript).toHaveLength(20);
    expect(transcript[0]?.text.startsWith("q5 ")).toBe(true);
    expect(transcript.every((turn) => turn.text.length <= 2000)).toBe(true);
    expect(Object.keys(transcript[0] ?? {})).toEqual(["role", "text"]);
  });

  it("shows no Ask form before the host says the assistant is on", () => {
    // Static rendering runs no effects, so the conversation has not started yet.
    const html = renderToStaticMarkup(
      <ScreensI18nProvider locale="en">
        <HelpDialog onClose={() => {}} support={support} />
      </ScreensI18nProvider>,
    );
    expect(html).not.toContain("Ask a question");
    expect(html).toContain("Search the guide");
  });
});

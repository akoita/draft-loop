import { helpGuide } from "@draft-loop/user-guide";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { claimHelpSection, helpSectionForStage } from "./help-context.js";
import { HelpDialog } from "./help-panel.js";
import { ScreensI18nProvider } from "./i18n.js";
import type { NextStepStage } from "./next-step.js";

function quickHelp(): string {
  return renderToStaticMarkup(
    <ScreensI18nProvider locale="en">
      <HelpDialog onClose={() => undefined} />
    </ScreensI18nProvider>,
  );
}

/** The titles of the sections that start open, in order. */
function openTitles(html: string): string[] {
  return [...html.matchAll(/<details[^>]* open=""[^>]*><summary>([^<]+)<\/summary>/gu)].map(
    (match) => match[1] ?? "",
  );
}

const title = (id: string) =>
  helpGuide("en").sections.find((section) => section.id === id)?.title ?? id;

describe("Quick help on the screen behind it (#3227)", () => {
  it("opens on the first section when no screen claims one", () => {
    expect(openTitles(quickHelp())).toEqual([title("evidence")]);
  });

  it("opens on the claimed section, and the newest claim wins until it is given back", () => {
    const giveBackReview = claimHelpSection("review");
    expect(openTitles(quickHelp())).toEqual([title("review")]);
    const giveBackDraft = claimHelpSection("draft");
    expect(openTitles(quickHelp())).toEqual([title("draft")]);
    giveBackDraft();
    expect(openTitles(quickHelp())).toEqual([title("review")]);
    giveBackReview();
    expect(openTitles(quickHelp())).toEqual([title("evidence")]);
  });

  it("gives every next-step stage a section, and a stopped review the one on starting again", () => {
    const stages: NextStepStage[] = [
      "career",
      "profile",
      "job",
      "start-review",
      "drafting",
      "reviewing",
      "review-ended",
      "export",
      "done",
    ];
    for (const stage of stages) {
      const section = helpSectionForStage(stage);
      expect(helpGuide("en").sections.some((item) => item.id === section)).toBe(true);
    }
    const draft = helpGuide("en").sections.find(
      (section) => section.id === helpSectionForStage("review-ended"),
    );
    expect(draft?.paragraphs.join(" ")).toContain("Start a new review");
  });
});

/**
 * The in-app user guide (#2830, #2880): short sections a member reads and searches from the Help
 * button.
 *
 * The guide's prose lives in one module per language instead of the message catalog. Paragraphs
 * are too long to translate string by string, and the same text also serves search and agents
 * (#2881). Menus and buttons around it still go through the catalog.
 */
import { englishHelpGuide } from "./help-guide-en.js";
import { frenchHelpGuide } from "./help-guide-fr.js";
import type { ScreenLocale } from "./i18n.js";

/** The guide's sections, in reading order. Every language has each one. */
export const helpSectionIds = [
  "evidence",
  "job",
  "draft",
  "review",
  "prepare",
  "display",
  "agents",
  "credits",
  "privacy",
  "problems",
] as const;
export type HelpSectionId = (typeof helpSectionIds)[number];

export interface HelpSection {
  readonly id: HelpSectionId;
  readonly title: string;
  /** Plain text, one paragraph each; rendered as text, never as markup. */
  readonly paragraphs: readonly string[];
  /** Other words a member may search with, such as "CV" or "price"; never shown. */
  readonly keywords: readonly string[];
}

export interface HelpGuide {
  /** The sentence above the sections. */
  readonly intro: string;
  readonly sections: readonly HelpSection[];
}

/**
 * The feature pages in `docs/features/` each section explains. `pnpm lint:docs` fails when an
 * available or partial feature page is in none of them, so a new capability gets its help text.
 */
export const helpSectionFeatures: Readonly<Record<HelpSectionId, readonly string[]>> = {
  evidence: ["career-evidence-sources.md", "career-profile.md"],
  job: ["job-applications.md"],
  draft: [],
  review: ["review-and-export.md"],
  prepare: [],
  display: ["help.md"],
  agents: [],
  credits: ["plans-and-credits.md"],
  privacy: ["organisations-and-consent.md", "sensitivity-and-screening.md"],
  problems: ["feedback.md"],
};

/** The guide in the screen's language; the development pseudo-locale reads the English one. */
export function helpGuide(locale: ScreenLocale): HelpGuide {
  return locale === "fr" ? frenchHelpGuide : englishHelpGuide;
}

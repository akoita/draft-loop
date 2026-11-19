/**
 * The user guide (#2830, #2880, #2881): short sections a member reads and searches from the Help
 * button, and an agent reads through the API.
 *
 * The prose lives in one module per language instead of the screens' message catalog. Paragraphs
 * are too long to translate string by string, and the API and agents read the same text. This
 * package has no dependency, so the browser screens and the server can both import it.
 */
import { englishHelpGuide } from "./guide-en.js";
import { frenchHelpGuide } from "./guide-fr.js";

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
  "connect-agent",
  "agent-permissions",
] as const;
export type HelpSectionId = (typeof helpSectionIds)[number];

export interface HelpSection {
  readonly id: HelpSectionId;
  readonly title: string;
  /** Plain text, one paragraph each; rendered as text, never as markup. */
  readonly paragraphs: readonly string[];
  /** Other words a member may search with, such as "CV" or "price"; never shown. */
  readonly keywords: readonly string[];
  /**
   * The screenshot the public guide page shows under the section, described for people who
   * cannot see it. The picture is `apps/web/public/guide/images/<id>.<language>.webp`; the
   * in-app panel shows the text only.
   */
  readonly screenshot?: { readonly alt: string };
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
  "connect-agent": [],
  "agent-permissions": [],
};

/** The languages the guide is written in. */
export const helpGuideLanguages = ["en", "fr"] as const;
export type HelpGuideLanguage = (typeof helpGuideLanguages)[number];

/**
 * The guide in a language: French for `fr` and its regional tags, English for anything else,
 * including the screens' development pseudo-locale.
 */
export function helpGuide(language: string): HelpGuide {
  return language.toLowerCase().split("-")[0] === "fr" ? frenchHelpGuide : englishHelpGuide;
}

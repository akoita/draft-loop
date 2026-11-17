/**
 * The in-app user guide (#2830): short sections a member reads from the Help button.
 *
 * The guide's prose lives in one module per language instead of the message catalog. Paragraphs
 * are too long to translate string by string, and the same text will also serve search and agents
 * (#2880, #2881). Menus and buttons around it still go through the catalog.
 */
import { englishHelpGuide } from "./help-guide-en.js";
import { frenchHelpGuide } from "./help-guide-fr.js";
import type { ScreenLocale } from "./i18n.js";

/** The guide's sections, in reading order. Every language has each one. */
export const helpSectionIds = ["evidence", "job", "draft", "review", "prepare", "display"] as const;
export type HelpSectionId = (typeof helpSectionIds)[number];

export interface HelpSection {
  readonly id: HelpSectionId;
  readonly title: string;
  /** Plain text, one paragraph each; rendered as text, never as markup. */
  readonly paragraphs: readonly string[];
}

export interface HelpGuide {
  /** The sentence above the sections. */
  readonly intro: string;
  readonly sections: readonly HelpSection[];
}

/** The guide in the screen's language; the development pseudo-locale reads the English one. */
export function helpGuide(locale: ScreenLocale): HelpGuide {
  return locale === "fr" ? frenchHelpGuide : englishHelpGuide;
}

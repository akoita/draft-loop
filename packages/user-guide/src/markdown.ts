import type { HelpGuide, HelpSection } from "./guide.js";

/** One section as Markdown: its title as a heading, then its paragraphs. */
export function sectionMarkdown(section: HelpSection): string {
  return [`## ${section.title}`, ...section.paragraphs].join("\n\n");
}

/** The whole guide as one Markdown page, for an agent to read (#2881). */
export function guideMarkdown(guide: HelpGuide, title: string): string {
  return [`# ${title}`, guide.intro, ...guide.sections.map(sectionMarkdown)].join("\n\n") + "\n";
}

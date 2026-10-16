import type { DraftArtifact } from "@draft-loop/schemas";

import {
  type LayoutBlock,
  type LayoutMetricsProfile,
  layoutSectionBlocks,
} from "./document-layout.js";
import { splitInlineLabel } from "./inline-label.js";
import { splitRoleHeader } from "./role-header.js";

/** A role header: bold, with a date range right-aligned; the separator is kept for copy and paste. */
function roleHeader(text: string, escapeText: (value: string) => string): string {
  const parts = splitRoleHeader(text);
  if (parts === null) return `<p class="role">${escapeText(text)}</p>`;
  return `<p class="role"><span>${escapeText(parts.left)}</span><span class="separator"> | </span><span class="date">${escapeText(parts.date)}</span></p>`;
}

/** Text whose leading "Label:" is bold, as the PDF and DOCX draw it. */
function labelled(text: string, escapeText: (value: string) => string): string {
  const parts = splitInlineLabel(text);
  return parts === null
    ? escapeText(text)
    : `<strong>${escapeText(parts.label)}</strong>${escapeText(parts.rest)}`;
}

function blockHtml(block: LayoutBlock, escapeText: (value: string) => string): string {
  switch (block.kind) {
    case "role":
      return roleHeader(block.text, escapeText);
    case "compact":
      return `<p class="compact">${escapeText(block.text)}</p>`;
    case "bullet":
      return `<li>${labelled(block.text, escapeText)}</li>`;
    default:
      return `<p>${labelled(block.text, escapeText)}</p>`;
  }
}

/** The HTML preview of one section's body, from the same blocks the PDF and DOCX draw. */
export function sectionBodyHtml(
  section: DraftArtifact["sections"][number],
  profile: LayoutMetricsProfile,
  escapeText: (value: string) => string,
): string {
  const blocks = layoutSectionBlocks(section, profile)
    .map((block) => blockHtml(block, escapeText))
    .join("");
  return section.blocks.some((block) => block.type === "bullet") ? `<ul>${blocks}</ul>` : blocks;
}

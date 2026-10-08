import type { CanonicalProfileExtractionTextWindow } from "./canonical-profile-extraction-sections.js";
import { planCanonicalProfileExtractionSizeWindows } from "./canonical-profile-extraction-size-windows.js";

const maximumHeadingTitleLength = 200;

export interface MarkdownHeading {
  readonly offset: number;
  readonly level: number;
  readonly title: string;
}

interface StructureSection {
  readonly start: number;
  readonly end: number;
  readonly headingPath: readonly string[];
}

const fenceOpening = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const fenceClosing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;
const atxHeading = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/u;

/** ATX headings at line start, skipping fenced code blocks. Offsets are line starts. */
export function findMarkdownHeadings(text: string): readonly MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let fence: { readonly character: string; readonly length: number } | undefined;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/u, "");

    if (fence !== undefined) {
      const closing = fenceClosing.exec(line)?.[1];
      if (closing?.startsWith(fence.character) === true && closing.length >= fence.length) {
        fence = undefined;
      }
    } else {
      const opening = fenceOpening.exec(line);
      const marker = opening?.[1];
      if (marker !== undefined && !(marker.startsWith("`") && (opening?.[2] ?? "").includes("`"))) {
        fence = { character: marker.charAt(0), length: marker.length };
      } else {
        const heading = atxHeading.exec(line);
        if (heading !== null) {
          const title = (heading[2] ?? "")
            .replace(/(?:^|[ \t]+)#+[ \t]*$/u, "")
            .trim()
            .slice(0, maximumHeadingTitleLength);
          headings.push({ offset: lineStart, level: (heading[1] ?? "#").length, title });
        }
      }
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return headings;
}

function hasBodyAfterHeadingLine(text: string, start: number, end: number): boolean {
  const newline = text.indexOf("\n", start);
  return newline !== -1 && newline < end && text.slice(newline + 1, end).trim().length > 0;
}

/**
 * Cut text into contiguous sections at Markdown headings, or return null when it has none.
 * A heading with no body of its own (a parent immediately followed by a child heading) stays with
 * the section that follows, so a heading is never separated from its first content line.
 */
function splitMarkdownSections(text: string): readonly StructureSection[] | null {
  const headings = findMarkdownHeadings(text);
  const first = headings[0];
  if (first === undefined) return null;

  const raw: (StructureSection & { readonly isHeading: boolean })[] = [];
  const stack: { readonly level: number; readonly title: string }[] = [];
  if (first.offset > 0)
    raw.push({ start: 0, end: first.offset, headingPath: [], isHeading: false });
  for (const [index, heading] of headings.entries()) {
    while ((stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    stack.push({ level: heading.level, title: heading.title });
    raw.push({
      start: heading.offset,
      end: headings[index + 1]?.offset ?? text.length,
      headingPath: stack.map((entry) => entry.title).filter((title) => title.length > 0),
      isHeading: true,
    });
  }

  const sections: StructureSection[] = [];
  let pendingStart: number | undefined;
  for (const [index, section] of raw.entries()) {
    const start = pendingStart ?? section.start;
    if (section.isHeading && !hasBodyAfterHeadingLine(text, section.start, section.end)) {
      if (index < raw.length - 1) {
        // Keep a heading-only section with the section that follows it.
        pendingStart = start;
        continue;
      }
      // A trailing heading-only section stays with the section before it.
      const previous = sections.pop();
      sections.push({
        start: previous?.start ?? start,
        end: section.end,
        headingPath: section.headingPath,
      });
      pendingStart = undefined;
      continue;
    }
    sections.push({ start, end: section.end, headingPath: section.headingPath });
    pendingStart = undefined;
  }
  return sections;
}

/**
 * Plan windows that keep whole Markdown sections together, packing consecutive sections greedily
 * up to the window size. A section larger than one window is split by size and each piece carries
 * the section's heading path as context. Returns null for text without headings, and for any
 * failure of the size splitter.
 */
export function planCanonicalProfileExtractionStructureWindows(
  text: string,
  windowCharacters: number,
): readonly CanonicalProfileExtractionTextWindow[] | null {
  const sections = splitMarkdownSections(text);
  if (sections === null) return null;

  const windows: CanonicalProfileExtractionTextWindow[] = [];
  let packStart: number | undefined;
  let packEnd = 0;
  const flush = () => {
    if (packStart !== undefined) {
      windows.push({ start: packStart, end: packEnd, text: text.slice(packStart, packEnd) });
    }
    packStart = undefined;
  };

  for (const section of sections) {
    if (section.end - section.start > windowCharacters) {
      flush();
      const pieces = planCanonicalProfileExtractionSizeWindows(
        text.slice(section.start, section.end),
        windowCharacters,
      );
      if (pieces === null) return null;
      for (const piece of pieces) {
        const start = section.start + piece.start;
        const end = section.start + piece.end;
        windows.push({
          start,
          end,
          text: text.slice(start, end),
          ...(section.headingPath.length === 0 ? {} : { headingPath: section.headingPath }),
        });
      }
      continue;
    }
    if (packStart !== undefined && section.end - packStart > windowCharacters) flush();
    packStart ??= section.start;
    packEnd = section.end;
  }
  flush();
  return windows;
}

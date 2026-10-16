/**
 * Inline labels: a paragraph or bullet that opens with a short "Label: " draws the label in bold
 * and the rest regular on the same line. Only the weight changes; the block text is never edited.
 * The PDF draws the label run in F3 under a "/DLLabel" marked-content tag, so the inspectors can
 * tell it from a role header (also F3) and join it back onto the run that follows it.
 */

const labelPattern = /^([^:]{1,40}):\s/u;
const maxLabelWords = 5;
const urlSchemes = new Set([
  "http",
  "https",
  "ftp",
  "ftps",
  "mailto",
  "tel",
  "file",
  "ssh",
  "data",
]);

export interface InlineLabel {
  /** The label including its colon, for example "Blockchain:". */
  readonly label: string;
  /** Everything after the label, starting with the whitespace that followed the colon. */
  readonly rest: string;
}

/** Split a leading short "Label:" from a block's text; null when the text has no such label. */
export function splitInlineLabel(text: string): InlineLabel | null {
  const match = labelPattern.exec(text);
  const name = match?.[1];
  if (match === null || name === undefined) return null;
  const words = name.trim().split(/\s+/u);
  if (name.trim() === "" || words.length > maxLabelWords) return null;
  // A label needs a letter: "10:", "10:30" and similar numbers and times are not labels.
  if (!/\p{L}/u.test(name)) return null;
  if (urlSchemes.has(name.trim().toLowerCase())) return null;
  const rest = text.slice(name.length + 1);
  if (rest.trim() === "") return null;
  return { label: `${name}:`, rest };
}

/** The wrapped lines of a labelled block: the label then the first line of text, then the rest. */
export interface LabelledLines {
  readonly label: string;
  /** Text drawn after the label on its line; empty when not even the first word fits there. */
  readonly firstRest: string;
  /** Further lines, filled to the full width. */
  readonly laterLines: readonly string[];
}

export interface LabelMeasure {
  /** Width of the block's lines (less any bullet indent), in points. */
  readonly widthPt: number;
  readonly boldWidth: (text: string) => number;
  readonly regularWidth: (text: string) => number;
  readonly wrap: (text: string, widthPt: number) => readonly string[];
}

/**
 * Lay a labelled block out: the text after the label fills the first line's remaining width,
 * measured with the bold label, and wraps at the full width after that.
 */
export function layoutLabelled(parts: InlineLabel, measure: LabelMeasure): LabelledLines {
  const room = measure.widthPt - measure.boldWidth(parts.label) - measure.regularWidth(" ");
  const rest = parts.rest.trim();
  if (room > 0) {
    const [first = "", ...others] = measure.wrap(rest, room);
    if (measure.regularWidth(first) <= room) {
      const remainder = others.join(" ");
      return {
        label: parts.label,
        firstRest: first,
        laterLines: remainder === "" ? [] : measure.wrap(remainder, measure.widthPt),
      };
    }
  }
  return { label: parts.label, firstRest: "", laterLines: measure.wrap(rest, measure.widthPt) };
}

/** The text lines of a labelled block as drawn: the label joins the first line of text. */
export function labelledTextLines(lines: LabelledLines): readonly string[] {
  const first = lines.firstRest === "" ? lines.label : `${lines.label} ${lines.firstRest}`;
  return [first, ...lines.laterLines];
}

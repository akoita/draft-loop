/**
 * The directive lines of a writing policy, read and rewritten as plain text.
 *
 * The policy text is the single source of truth: the editor's selectors are a
 * view of it, and changing a selector edits the matching `Name: value` line.
 * Lines are recognised the way the application compiles them (an optional list
 * marker, then a case-insensitive name, a colon and a value), so what a
 * selector shows is what a saved policy will mean.
 */

export const writingPolicyTones = ["professional", "warm", "direct", "conversational"] as const;
export const writingPolicyVerbosityLevels = ["concise", "balanced", "detailed"] as const;
export const writingPolicyPageTargets = ["one-page", "two-page"] as const;

export type PolicySelectorDirective = "tone" | "verbosity" | "pageTarget" | "spellingLocale";

export type PolicySelectorValues = Readonly<Record<PolicySelectorDirective, string | null>>;

const directiveLabels: Readonly<Record<PolicySelectorDirective, string>> = {
  tone: "Tone",
  verbosity: "Verbosity",
  pageTarget: "Page target",
  spellingLocale: "Spelling locale",
};

/** Every directive the application recognises, so insertion can sit beside any of them. */
const anyDirectiveLine =
  /^(\s*(?:[-*+]\s+)?)(Tone|Spelling\s+locale|Verbosity|Page\s+target|Section\s+order|Emphasis\s+areas|Anti-formulaic\s+defaults)(\s*:\s*)(.*)$/iu;

function directiveOfName(name: string): PolicySelectorDirective | undefined {
  switch (name.toLowerCase().replace(/\s+/gu, " ")) {
    case "tone":
      return "tone";
    case "verbosity":
      return "verbosity";
    case "page target":
      return "pageTarget";
    case "spelling locale":
      return "spellingLocale";
    default:
      return undefined;
  }
}

function splitLines(text: string): { readonly lines: string[]; readonly eol: string } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/u), eol };
}

/**
 * The value written for each selector directive, or null when the line is
 * absent or has no value. When a directive is written twice the first line
 * wins; the application rejects duplicates, which the editor surfaces on save.
 */
export function readPolicySelectorValues(text: string): PolicySelectorValues {
  const values: Record<PolicySelectorDirective, string | null> = {
    tone: null,
    verbosity: null,
    pageTarget: null,
    spellingLocale: null,
  };
  for (const line of splitLines(text).lines) {
    const match = line.match(anyDirectiveLine);
    const directive = match?.[2] === undefined ? undefined : directiveOfName(match[2]);
    if (directive === undefined || values[directive] !== null) continue;
    const value = (match?.[4] ?? "").trim();
    if (value !== "") values[directive] = value;
  }
  return values;
}

function normalizedValue(value: string | null): string | null {
  if (value === null) return null;
  const single = value.replace(/\s+/gu, " ").trim();
  return single === "" ? null : single;
}

/**
 * Rewrites, inserts or removes one directive line and leaves every other line
 * exactly as written.
 *
 * - An existing line keeps its indent, list marker and the spelling of its
 *   name; only the value changes. Repeated lines for the same directive are
 *   dropped so the result is never a duplicate the application would refuse.
 * - A missing line is inserted beside the other directive lines, or under the
 *   opening heading when there are none, in the style of its neighbour.
 * - A null or blank value removes the directive.
 */
export function setPolicySelectorValue(
  text: string,
  directive: PolicySelectorDirective,
  value: string | null,
): string {
  const next = normalizedValue(value);
  const { lines, eol } = splitLines(text);
  const output: string[] = [];
  let written = false;
  let lastDirectiveIndex = -1;
  let lastDirectivePrefix = "";
  for (const line of lines) {
    const match = line.match(anyDirectiveLine);
    if (match === null) {
      output.push(line);
      continue;
    }
    if (directiveOfName(match[2] ?? "") !== directive) {
      output.push(line);
      lastDirectiveIndex = output.length - 1;
      lastDirectivePrefix = match[1] ?? "";
      continue;
    }
    if (next === null || written) continue;
    output.push(`${match[1] ?? ""}${match[2] ?? ""}${match[3] ?? ": "}${next}`);
    written = true;
    lastDirectiveIndex = output.length - 1;
    lastDirectivePrefix = match[1] ?? "";
  }
  if (next !== null && !written) {
    const line = `${lastDirectivePrefix}${directiveLabels[directive]}: ${next}`;
    if (lastDirectiveIndex >= 0) {
      output.splice(lastDirectiveIndex + 1, 0, line);
    } else {
      insertWithoutNeighbour(output, line);
    }
  }
  return output.join(eol);
}

function insertWithoutNeighbour(lines: string[], line: string): void {
  if (lines.every((existing) => existing.trim() === "")) {
    lines.splice(0, lines.length, line, "");
    return;
  }
  const first = lines.findIndex((existing) => existing.trim() !== "");
  if (/^#{1,6}\s/u.test(lines[first] ?? "")) {
    lines.splice(first + 1, 0, "", line);
    return;
  }
  lines.splice(first, 0, line, "");
}

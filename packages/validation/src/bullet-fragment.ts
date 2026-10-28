/** Longest quote of the offending text placed in a finding message. */
const MAX_QUOTE_CHARACTERS = 40;

/** Fewest words on each side of a semicolon for the bullet to read as two stitched statements. */
const MIN_STITCHED_CLAUSE_WORDS = 3;

/** Lowercase-by-convention names that may legitimately open a bullet. */
const knownLowercaseTokens: ReadonlySet<string> = new Set([
  "dbt",
  "npm",
  "pnpm",
  "pip",
  "git",
  "kubectl",
  "curl",
  "bash",
  "zsh",
  "nginx",
  "webpack",
  "vite",
  "esbuild",
  "eslint",
]);

export type BulletFragmentReason = "lowercase-start" | "dangling-connector" | "semicolon-stitch";

/** The finding message for each reason, followed in the finding by a quote of the text. */
export const bulletFragmentMessages: Readonly<Record<BulletFragmentReason, string>> = {
  "lowercase-start": "bullet starts mid-sentence, like a copied source fragment",
  "dangling-connector": "bullet ends on a dangling connector, like a copied source fragment",
  "semicolon-stitch":
    "bullet joins separate facts with a semicolon; write one complete statement per bullet",
};

export interface BulletFragment {
  readonly reason: BulletFragmentReason;
  /** A short quote of the opening or closing text, as written. */
  readonly quote: string;
  readonly start: number;
  readonly end: number;
}

function startsAsKnownName(text: string): boolean {
  const token = /^[\p{L}\p{N}][\p{L}\p{N}._+#-]*/u.exec(text)?.[0] ?? "";
  // A lowercase token holding an uppercase letter or a digit is a product or tool name (iOS, k8s).
  if (/[\p{Lu}\p{N}]/u.test(token)) return true;
  return knownLowercaseTokens.has(token);
}

/**
 * Finds a bullet that reads as a copied source fragment: it opens with a lowercase letter that is
 * not a known lowercase name, or it ends on a connector (and, or, with, of, to) or a comma or
 * semicolon, or it joins separate statements with a semicolon. A complete statement starts with a
 * capital letter or an action verb, ends whole and states one fact.
 */
export function findBulletFragment(text: string): BulletFragment | undefined {
  const lead = text.length - text.trimStart().length;
  const body = text.trim();
  if (body === "") return undefined;

  if (/^\p{Ll}/u.test(body) && !startsAsKnownName(body)) {
    const end = lead + Math.min(body.length, MAX_QUOTE_CHARACTERS);
    return { reason: "lowercase-start", quote: text.slice(lead, end), start: lead, end };
  }

  const closing = /(?:[,;]|(?<![\p{L}\p{N}])(?:and|or|with|of|to)\.?)$/iu.exec(body);
  if (closing !== null) {
    const start = lead + closing.index;
    const end = lead + body.length;
    return {
      reason: "dangling-connector",
      quote: text.slice(Math.max(lead, end - MAX_QUOTE_CHARACTERS), end),
      start,
      end,
    };
  }

  const stitch = findSemicolonStitch(body);
  if (stitch !== undefined) {
    const start = lead + Math.max(0, stitch - MAX_QUOTE_CHARACTERS / 2);
    const end = lead + Math.min(body.length, stitch + MAX_QUOTE_CHARACTERS / 2);
    return { reason: "semicolon-stitch", quote: text.slice(start, end), start, end };
  }
  return undefined;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

/** The index of the first semicolon that joins two clauses of at least a few words each. */
function findSemicolonStitch(body: string): number | undefined {
  const clauses = body.split(";");
  let offset = 0;
  for (let index = 0; index < clauses.length - 1; index += 1) {
    offset += (clauses[index] ?? "").length;
    if (
      wordCount(clauses[index] ?? "") >= MIN_STITCHED_CLAUSE_WORDS &&
      wordCount(clauses[index + 1] ?? "") >= MIN_STITCHED_CLAUSE_WORDS
    ) {
      return offset;
    }
    offset += 1;
  }
  return undefined;
}

/** Longest quote of the offending text placed in a finding message. */
const MAX_QUOTE_CHARACTERS = 40;

/** Lowercase-by-convention names that may legitimately open a bullet. */
const knownLowercaseTokens: ReadonlySet<string> = new Set([
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

export type BulletFragmentReason = "lowercase-start" | "dangling-connector";

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
 * semicolon. A complete statement starts with a capital letter or an action verb and ends whole.
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
  return undefined;
}

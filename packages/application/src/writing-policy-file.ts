import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  type ContextSnapshot,
  defaultAntiFormulaicTerms,
  maximumWritingPolicyPreferenceListEntries,
  maximumWritingPolicyPreferenceNameLength,
  maximumWritingPolicyRules,
  maximumWritingPolicySpellingLocaleLength,
  maximumWritingPolicyTermLength,
  normalizeWritingPolicySpellingLocale,
  type WritingPolicyPreferences,
  type WritingPolicyRule,
  writingPolicyPageTargets,
  writingPolicySpellingLocalePattern,
  writingPolicyTones,
  writingPolicyVerbosityLevels,
} from "@draft-loop/domain";

import { CliUserError } from "./cli-user-error.js";
import { ensureFile } from "./workspace-paths.js";
import { workspaceSettings } from "./workspace-settings.js";
import {
  compareWritingPolicySemantics,
  type UnidentifiedWritingPolicyRule,
  writingPolicyRuleId,
  writingPolicyTermIdentity,
} from "./writing-policy-rule-identity.js";

/**
 * Compiles a writing policy's text into the immutable policy a run records: its checksum, the
 * rules it states, and the preferences its directives set. A policy comes from a file the person
 * picks, or from the workspace's managed copy read through the settings port.
 */

export const maximumWritingPolicyBytes = 64 * 1024;

const recognizedWritingPolicyPunctuation = "‐‑‒–—―‘’“”";
function compileWritingPolicyRules(
  content: string,
  antiFormulaicDefaultsEnabled = true,
): readonly WritingPolicyRule[] {
  const candidates: UnidentifiedWritingPolicyRule[] = [];
  const characters = new Set<string>();
  if (/plain\s+ascii\s+punctuation/iu.test(content)) {
    for (const character of recognizedWritingPolicyPunctuation) characters.add(character);
  }
  if (/no\s+em\s+dashes?/iu.test(content)) characters.add("—");
  if (/no\s+en\s+dashes?/iu.test(content)) characters.add("–");
  if (characters.size > 0) {
    candidates.push({
      kind: "forbidden-characters",
      characters: [...recognizedWritingPolicyPunctuation]
        .filter((character) => characters.has(character))
        .join(""),
    });
  }
  const defaultTerms = new Map<string, string>();
  if (antiFormulaicDefaultsEnabled) {
    for (const term of defaultAntiFormulaicTerms) {
      defaultTerms.set(writingPolicyTermIdentity(term), term);
    }
  }
  const explicitTerms = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(
      /^\s*(?:[-*+]\s+)?Forbidden\s+(?:term|phrase)\s*:\s*(\S(?:.*?\S)?)\s*$/iu,
    );
    const term = match?.[1]?.trim();
    if (term === undefined || term === "") continue;
    const semanticKey = writingPolicyTermIdentity(term);
    if ([...term].length > maximumWritingPolicyTermLength) {
      throw new CliUserError("The writing policy contains a forbidden term that is too long.");
    }
    if (!explicitTerms.has(semanticKey)) explicitTerms.set(semanticKey, term);
  }
  const terms = new Map(defaultTerms);
  for (const [semanticKey, term] of explicitTerms) terms.set(semanticKey, term);
  for (const [, term] of [...terms.entries()].sort(([left], [right]) =>
    compareWritingPolicySemantics(left, right),
  )) {
    candidates.push({
      kind: "forbidden-term",
      term,
      caseSensitive: false,
      wholeWord: true,
    });
  }
  const ordered = [...candidates].sort((left, right) => {
    const leftKey =
      left.kind === "forbidden-term"
        ? `forbidden-term\u0000${writingPolicyTermIdentity(left.term)}\u0000false\u0000true`
        : `forbidden-characters\u0000${left.characters}`;
    const rightKey =
      right.kind === "forbidden-term"
        ? `forbidden-term\u0000${writingPolicyTermIdentity(right.term)}\u0000false\u0000true`
        : `forbidden-characters\u0000${right.characters}`;
    return compareWritingPolicySemantics(leftKey, rightKey);
  });
  if (ordered.length > maximumWritingPolicyRules) {
    throw new CliUserError(
      `The writing policy contains too many rules; use at most ${maximumWritingPolicyRules}.`,
    );
  }
  return ordered.map((rule) => ({ id: writingPolicyRuleId(rule), ...rule }));
}
type WritingPolicyPreferenceKey = keyof WritingPolicyPreferences;
type MutableWritingPolicyPreferences = {
  -readonly [Key in keyof WritingPolicyPreferences]?: WritingPolicyPreferences[Key];
};
const writingPolicyPreferenceDirectives = {
  tone: "Tone",
  spellingLocale: "Spelling locale",
  verbosity: "Verbosity",
  pageTarget: "Page target",
  sectionOrder: "Section order",
  emphasisAreas: "Emphasis areas",
} as const satisfies Record<WritingPolicyPreferenceKey, string>;
type WritingPolicyDirective = WritingPolicyPreferenceKey | "antiFormulaicDefaults";
const writingPolicyDirectiveLabels: Record<WritingPolicyDirective, string> = {
  ...writingPolicyPreferenceDirectives,
  antiFormulaicDefaults: "Anti-formulaic defaults",
};
function writingPolicyDirectiveError(
  directive: WritingPolicyDirective,
  kind: "duplicate" | "invalid",
): CliUserError {
  const label = writingPolicyDirectiveLabels[directive];
  return new CliUserError(
    kind === "duplicate"
      ? `The writing policy contains duplicate ${label} directives.`
      : `The writing policy contains an invalid ${label} directive.`,
  );
}
function normalizePolicyPreferenceName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
function compilePolicyPreferenceNames(
  directive: "sectionOrder" | "emphasisAreas",
  value: string,
): readonly string[] {
  const entries = value.split(",").map(normalizePolicyPreferenceName);
  if (
    entries.length === 0 ||
    entries.length > maximumWritingPolicyPreferenceListEntries ||
    entries.some(
      (entry) => entry === "" || [...entry].length > maximumWritingPolicyPreferenceNameLength,
    )
  ) {
    throw writingPolicyDirectiveError(directive, "invalid");
  }
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = entry.normalize("NFKC").toLowerCase();
    if (identities.has(identity)) throw writingPolicyDirectiveError(directive, "invalid");
    identities.add(identity);
  }
  return Object.freeze(entries);
}
interface CompiledWritingPolicyDirectives {
  readonly preferences?: WritingPolicyPreferences;
  readonly antiFormulaicDefaultsEnabled: boolean;
}
function compileWritingPolicyPreferences(content: string): CompiledWritingPolicyDirectives {
  const preferences: MutableWritingPolicyPreferences = {};
  const seen = new Set<WritingPolicyDirective>();
  let antiFormulaicDefaultsEnabled = true;
  const directivePattern =
    /^\s*(?:[-*+]\s+)?(Tone|Spelling\s+locale|Verbosity|Page\s+target|Section\s+order|Emphasis\s+areas|Anti-formulaic\s+defaults)\s*:\s*(.*)$/iu;
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(directivePattern);
    if (match === null) continue;
    const label = match[1]?.toLowerCase().replace(/\s+/gu, " ");
    const value = match[2]?.trim() ?? "";
    const directive: WritingPolicyDirective | undefined =
      label === "tone"
        ? "tone"
        : label === "spelling locale"
          ? "spellingLocale"
          : label === "verbosity"
            ? "verbosity"
            : label === "page target"
              ? "pageTarget"
              : label === "section order"
                ? "sectionOrder"
                : label === "emphasis areas"
                  ? "emphasisAreas"
                  : label === "anti-formulaic defaults"
                    ? "antiFormulaicDefaults"
                    : undefined;
    if (directive === undefined) continue;
    if (seen.has(directive)) throw writingPolicyDirectiveError(directive, "duplicate");
    seen.add(directive);
    if (value === "") {
      throw writingPolicyDirectiveError(directive, "invalid");
    }
    if (directive === "antiFormulaicDefaults") {
      const normalized = value.toLowerCase();
      if (normalized !== "enabled" && normalized !== "disabled") {
        throw writingPolicyDirectiveError(directive, "invalid");
      }
      antiFormulaicDefaultsEnabled = normalized === "enabled";
      continue;
    }
    if (directive === "tone") {
      const tone = value.toLowerCase() as NonNullable<WritingPolicyPreferences["tone"]>;
      if (!writingPolicyTones.includes(tone as (typeof writingPolicyTones)[number])) {
        throw writingPolicyDirectiveError(directive, "invalid");
      }
      preferences.tone = tone;
      continue;
    }
    if (directive === "verbosity") {
      const verbosity = value.toLowerCase() as NonNullable<WritingPolicyPreferences["verbosity"]>;
      if (
        !writingPolicyVerbosityLevels.includes(
          verbosity as (typeof writingPolicyVerbosityLevels)[number],
        )
      ) {
        throw writingPolicyDirectiveError(directive, "invalid");
      }
      preferences.verbosity = verbosity;
      continue;
    }
    if (directive === "spellingLocale") {
      if (
        [...value].length > maximumWritingPolicySpellingLocaleLength ||
        !writingPolicySpellingLocalePattern.test(value)
      ) {
        throw writingPolicyDirectiveError(directive, "invalid");
      }
      preferences.spellingLocale = normalizeWritingPolicySpellingLocale(value);
      continue;
    }
    if (directive === "pageTarget") {
      const pageTarget = value.toLowerCase() as NonNullable<WritingPolicyPreferences["pageTarget"]>;
      if (
        !writingPolicyPageTargets.includes(pageTarget as (typeof writingPolicyPageTargets)[number])
      ) {
        throw writingPolicyDirectiveError(directive, "invalid");
      }
      preferences.pageTarget = pageTarget;
      continue;
    }
    preferences[directive] = compilePolicyPreferenceNames(directive, value);
  }
  return {
    ...(Object.keys(preferences).length === 0 ? {} : { preferences }),
    antiFormulaicDefaultsEnabled,
  };
}

export async function writingPolicyFromPath(
  path: string,
): Promise<NonNullable<ContextSnapshot["writingPolicy"]>> {
  await ensureFile(path, "Writing policy");
  if ((await stat(path)).size > maximumWritingPolicyBytes) throw writingPolicyTooLarge();
  return writingPolicyFromText(await readFile(path, "utf8"));
}

const writingPolicyTooLarge = () =>
  new CliUserError("The writing policy is too large; use a Markdown or text file under 64 KiB.");

/** The workspace's active managed policy, read through the settings port. */
export async function managedWritingPolicy(
  root: string,
): Promise<NonNullable<ContextSnapshot["writingPolicy"]>> {
  const text = await workspaceSettings().read(root, "writing-policy.md");
  if (text === undefined) throw new CliUserError("Writing policy does not exist.");
  if (Buffer.byteLength(text, "utf8") > maximumWritingPolicyBytes) throw writingPolicyTooLarge();
  return writingPolicyFromText(text);
}

function writingPolicyFromText(text: string): NonNullable<ContextSnapshot["writingPolicy"]> {
  const content = text.trim();
  if (content === "") throw new CliUserError("The writing policy is empty.");
  if (content.includes("\0")) throw new CliUserError("The writing policy is not valid text.");
  const checksum = createHash("sha256").update(content, "utf8").digest("hex");
  const directives = compileWritingPolicyPreferences(content);
  const rules = compileWritingPolicyRules(content, directives.antiFormulaicDefaultsEnabled);
  return Object.freeze({
    content,
    checksum,
    version: `sha256:${checksum.slice(0, 12)}`,
    rules: Object.freeze(rules.map((rule) => Object.freeze(rule))),
    ...(directives.preferences === undefined
      ? {}
      : { preferences: Object.freeze(directives.preferences) }),
  });
}

/**
 * Deterministic scoring of one draft against a fictional cohort case (#3287, part 1 of #1107).
 *
 * It judges only the failure modes a rule can decide from the draft text and the case's own
 * profile: placeholders left in, numbers the sources never state, dated roles that are missing,
 * and roles whose dates are not kept. The model-judged modes (#3288) stay out of this file.
 */

export const deterministicFailureModes = [
  "placeholder-left",
  "altered-number",
  "role-omission",
  "chronology-drift",
] as const;
export type DeterministicFailureMode = (typeof deterministicFailureModes)[number];
export type ModeVerdict = "pass" | "fail";

export interface CohortRole {
  readonly evidenceId: string;
  readonly employer: string;
  readonly start: string;
  readonly end: string;
}

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;
const monthPattern =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const datePattern = `(?:${monthPattern}\\s+\\d{4}|\\d{4})`;
const separator = "\\s+[—·|–-]\\s+";
const roleHeadingPattern = new RegExp(
  `^#{2,3}\\s+(.+?)${separator}.+?${separator}(${datePattern})\\s+to\\s+(${datePattern}|present)\\s*$`,
  "iu",
);
const gapHeadingPattern = new RegExp(
  `^#{2,3}\\s+.+?${separator}(${datePattern})\\s+to\\s+(${datePattern})\\s*$`,
  "iu",
);
const roleEvidencePattern = /-(?:role|employment)-\d+$/u;
const gapEvidencePattern = /-gap(?:-\d+)?$/u;
const gapWords =
  /\b(?:gap|career break|break|travel(?:led|ed|ling|ing)?|sabbatical|interval|not employed|unemployed|no (?:paid |software )?employment)\b/u;
const placeholderPattern =
  /\[(?:your |candidate )?(?:full )?(?:name|phone|telephone|email|e-mail|address|location|city|linkedin|website|date)(?: number| address)?\]/iu;
const numberPattern = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/gu;

export interface CohortGap {
  readonly evidenceId: string;
  readonly start: string;
  readonly end: string;
}

function headings(
  profile: string,
): readonly { readonly evidenceId: string; readonly line: string }[] {
  const found: { evidenceId: string; line: string }[] = [];
  let evidenceId = "";
  for (const line of profile.split(/\r?\n/u)) {
    const marker = /<!-- evidence-id: ([\w-]+) -->/u.exec(line);
    if (marker !== null) {
      evidenceId = marker[1] ?? "";
      continue;
    }
    if (/^#{2,3}\s/u.test(line.trim())) found.push({ evidenceId, line: line.trim() });
  }
  return found;
}

/** Dated roles from a cohort profile: `### Employer — Title — Month YYYY to Month YYYY`. */
export function cohortRoles(profile: string): readonly CohortRole[] {
  return headings(profile).flatMap(({ evidenceId, line }) => {
    const heading = roleEvidencePattern.test(evidenceId) ? roleHeadingPattern.exec(line) : null;
    return heading === null
      ? []
      : [
          {
            evidenceId,
            employer: heading[1] ?? "",
            start: heading[2] ?? "",
            end: heading[3] ?? "",
          },
        ];
  });
}

/** Recorded gaps from a cohort profile: `### Career break — Month YYYY to Month YYYY`. */
export function cohortGaps(profile: string): readonly CohortGap[] {
  return headings(profile).flatMap(({ evidenceId, line }) => {
    const heading = gapEvidencePattern.test(evidenceId) ? gapHeadingPattern.exec(line) : null;
    return heading === null ? [] : [{ evidenceId, start: heading[1] ?? "", end: heading[2] ?? "" }];
  });
}

/** Every visible string in a draft artifact, joined by newlines. */
export function draftText(artifact: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown, key: string): void => {
    if (typeof value === "string") {
      if (key === "text" || key === "title" || key === "items") parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [inner, child] of Object.entries(value)) visit(child, inner);
    }
  };
  const sections = (artifact as { sections?: unknown } | null)?.sections;
  visit(sections ?? [], "sections");
  return parts.join("\n");
}

function normalise(text: string): string {
  return text.normalize("NFKC").replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").toLowerCase();
}

function numbers(text: string): Set<string> {
  return new Set(
    [...text.normalize("NFKC").matchAll(numberPattern)].map((match) =>
      match[0].replace(/,(?=\d{3}\b)/gu, ""),
    ),
  );
}

function monthIndex(word: string): number {
  const lower = word.toLowerCase();
  return monthNames.findIndex((name) => name.startsWith(lower.slice(0, 3)));
}

function dateMentioned(text: string, date: string): boolean {
  if (date.toLowerCase() === "present") return /\b(?:present|current|now|today)\b/u.test(text);
  const [first, second] = date.trim().split(/\s+/u);
  const year = second ?? first ?? "";
  if (!text.includes(year)) return false;
  if (second === undefined) return true;
  const month = monthIndex(first ?? "");
  const name = monthNames[month] ?? "";
  const spelled = new RegExp(`\\b${name.slice(0, 3)}[a-z]*\\.?\\s+${year}`, "u");
  const numeric = new RegExp(`\\b0?${month + 1}[/.-]${year}`, "u");
  return spelled.test(text) || numeric.test(text);
}

/** The employer is named in full, or by its first two words, or by a distinctive first word. */
function employerNamed(text: string, employer: string): boolean {
  const words = normalise(employer).split(" ");
  const candidates = [words.join(" "), words.slice(0, 2).join(" ")];
  if ((words[0] ?? "").length >= 5) candidates.push(words[0] ?? "");
  return candidates.some((candidate) =>
    new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(text),
  );
}

export interface CohortScore {
  readonly verdicts: Readonly<Record<DeterministicFailureMode, ModeVerdict>>;
  /** Content-free reasons: role evidence ids, or the count of unsupported numbers. */
  readonly reasons: Readonly<Partial<Record<DeterministicFailureMode, readonly string[]>>>;
}

/**
 * Scores a draft. `sources` holds every text the draft may draw numbers from: the profile and the
 * job description. A missing draft fails nothing here; the runner records it as `no-draft`.
 */
export function scoreCohortDraft(input: {
  readonly artifact: unknown;
  readonly profile: string;
  readonly jobDescription: string;
}): CohortScore {
  const raw = draftText(input.artifact);
  const text = normalise(raw);
  const reasons: Partial<Record<DeterministicFailureMode, string[]>> = {};

  if (placeholderPattern.test(raw)) reasons["placeholder-left"] = ["placeholder"];

  const allowed = numbers(`${input.profile}\n${input.jobDescription}`);
  const unsupported = [...numbers(raw)].filter((value) => !allowed.has(value));
  if (unsupported.length > 0) reasons["altered-number"] = [`${unsupported.length} number(s)`];

  const roles = cohortRoles(input.profile);
  const present = roles.filter((role) => employerNamed(text, role.employer));
  const missing = roles.filter((role) => !present.includes(role));
  if (missing.length > 0) reasons["role-omission"] = missing.map(({ evidenceId }) => evidenceId);

  const drifted = present
    .filter((role) => !dateMentioned(text, role.start) || !dateMentioned(text, role.end))
    .map(({ evidenceId }) => evidenceId);
  // A recorded gap must be stated, by a gap word or its own start date, not left to inference.
  const hidden = cohortGaps(input.profile)
    .filter((gap) => !gapWords.test(text) && !dateMentioned(text, gap.start))
    .map(({ evidenceId }) => evidenceId);
  if (drifted.length + hidden.length > 0) reasons["chronology-drift"] = [...drifted, ...hidden];

  const verdicts = Object.fromEntries(
    deterministicFailureModes.map((mode) => [mode, reasons[mode] === undefined ? "pass" : "fail"]),
  ) as Record<DeterministicFailureMode, ModeVerdict>;
  return { verdicts, reasons };
}

export interface ModeAgreement {
  readonly mode: DeterministicFailureMode;
  readonly rounds: number;
  readonly agreement: number;
  /** Human fails the scorer also failed, over human fails. */
  readonly truePositiveRate: number | null;
  /** Human passes the scorer also passed, over human passes. */
  readonly trueNegativeRate: number | null;
}

/** Compares scorer verdicts with human labels, per mode. */
export function agreementWithLabels(
  pairs: readonly {
    readonly scored: Readonly<Record<DeterministicFailureMode, ModeVerdict>>;
    readonly labels: Readonly<Record<string, ModeVerdict>>;
  }[],
): readonly ModeAgreement[] {
  return deterministicFailureModes.map((mode) => {
    const rated = pairs.filter(({ labels }) => labels[mode] !== undefined);
    const humanFails = rated.filter(({ labels }) => labels[mode] === "fail");
    const humanPasses = rated.filter(({ labels }) => labels[mode] === "pass");
    const rate = (subset: typeof rated, verdict: ModeVerdict) =>
      subset.length === 0
        ? null
        : subset.filter(({ scored }) => scored[mode] === verdict).length / subset.length;
    return {
      mode,
      rounds: rated.length,
      agreement:
        rated.length === 0
          ? 0
          : rated.filter(({ scored, labels }) => scored[mode] === labels[mode]).length /
            rated.length,
      truePositiveRate: rate(humanFails, "fail"),
      trueNegativeRate: rate(humanPasses, "pass"),
    };
  });
}

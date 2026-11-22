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

const months =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const roleHeadingPattern = new RegExp(
  `^###\\s+(.+?)\\s+—\\s+.+?\\s+—\\s+((?:${months})\\s+\\d{4}|\\d{4})\\s+to\\s+((?:${months})\\s+\\d{4}|\\d{4}|present)\\s*$`,
  "u",
);
const placeholderPattern =
  /\[(?:your |candidate )?(?:full )?(?:name|phone|telephone|email|e-mail|address|location|city|linkedin|website|date)(?: number| address)?\]/iu;
const numberPattern = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/gu;

/** Dated roles from a cohort profile: `### Employer — Title — Month YYYY to Month YYYY`. */
export function cohortRoles(profile: string): readonly CohortRole[] {
  const roles: CohortRole[] = [];
  let evidenceId = "";
  for (const line of profile.split(/\r?\n/u)) {
    const marker = /<!-- evidence-id: ([\w-]+) -->/u.exec(line);
    if (marker !== null) {
      evidenceId = marker[1] ?? "";
      continue;
    }
    const heading = roleHeadingPattern.exec(line.trim());
    if (heading === null || !/-role-\d+$/u.test(evidenceId)) continue;
    roles.push({
      evidenceId,
      employer: heading[1] ?? "",
      start: heading[2] ?? "",
      end: heading[3] ?? "",
    });
  }
  return roles;
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

function dateMentioned(text: string, date: string): boolean {
  if (date === "present") return /\b(?:present|current|now|today)\b/u.test(text);
  const [month, year] = date.includes(" ") ? date.split(" ") : ["", date];
  if (year === undefined || !text.includes(year)) return false;
  if (month === "" || month === undefined) return true;
  const lower = month.toLowerCase();
  return text.includes(`${lower} ${year}`) || text.includes(`${lower.slice(0, 3)} ${year}`);
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
  const present = roles.filter((role) => text.includes(normalise(role.employer)));
  const missing = roles.filter((role) => !present.includes(role));
  if (missing.length > 0) reasons["role-omission"] = missing.map(({ evidenceId }) => evidenceId);

  const drifted = present.filter(
    (role) =>
      !dateMentioned(text, role.start.toLowerCase()) ||
      !dateMentioned(text, role.end.toLowerCase()),
  );
  if (drifted.length > 0) reasons["chronology-drift"] = drifted.map(({ evidenceId }) => evidenceId);

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

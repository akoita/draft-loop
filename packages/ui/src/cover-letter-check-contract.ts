/**
 * Bridge contract for Check my letter (#3280): the candidate's own cover letter goes to the host
 * once, on their press, and comes back as findings: claims their approved facts do not support,
 * requirements not answered yet, and wording that reads as machine-made. The host never stores
 * the letter, and nothing here rewrites it.
 */

/** The longest letter one check reads, as the API's `maximumCoverLetterCheckCharacters`. */
export const maximumCoverLetterCheckCharacters = 8_000;

export const coverLetterCheckSkipReasons = [
  "model_calls_paused",
  "model_unavailable",
  "consent_required",
  "no_facts",
] as const;
export type CoverLetterCheckSkipReason = (typeof coverLetterCheckSkipReasons)[number];

export const coverLetterClaimReasons = [
  "no_supporting_fact",
  "number_not_in_fact",
  "joins_different_roles",
] as const;
export type CoverLetterClaimReason = (typeof coverLetterClaimReasons)[number];

export const coverLetterWordingCodes = [
  "job_ad_echo",
  "empty_superlative",
  "stock_phrase",
  "heavy_dashes",
  "list_of_three",
  "mirrored_openings",
  "word_count",
] as const;
export type CoverLetterWordingCode = (typeof coverLetterWordingCodes)[number];

export interface CoverLetterCheckFactView {
  readonly factId: string;
  readonly text: string;
}

export interface CoverLetterClaimFindingView {
  readonly paragraph: number;
  readonly sentence: string;
  readonly about: "candidate" | "employer";
  readonly reason: CoverLetterClaimReason;
  /** For number_not_in_fact: the numbers no approved fact states. */
  readonly numbers: readonly string[];
  readonly closestFact: CoverLetterCheckFactView | null;
}

export interface CoverLetterCheckView {
  readonly claims: {
    readonly status: "checked" | "skipped";
    readonly reason: CoverLetterCheckSkipReason | null;
    readonly checkedSentences: number;
    readonly findings: readonly CoverLetterClaimFindingView[];
  };
  readonly requirements: {
    readonly source: "kit" | "brief" | "none";
    readonly total: number;
    readonly unanswered: readonly {
      readonly requirementId: string;
      readonly text: string;
      readonly facts: readonly CoverLetterCheckFactView[];
    }[];
  };
  readonly wording: readonly {
    readonly code: CoverLetterWordingCode;
    readonly paragraph: number | null;
    readonly sentence: string | null;
    readonly match: string | null;
  }[];
}

export interface CoverLetterCheckInput {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly text: string;
}

export interface CoverLetterCheckResult {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly check: CoverLetterCheckView;
}

type Raw = Readonly<Record<string, unknown>>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,191}$/u;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function text(value: unknown, maximum = maximumCoverLetterCheckCharacters): string | undefined {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximum
    ? value
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function list<T>(value: unknown, each: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(each);
  return items.every((item) => item !== undefined) ? (items as T[]) : undefined;
}

function fact(value: unknown): CoverLetterCheckFactView | undefined {
  const raw = record(value);
  const factId = identifier(raw?.factId);
  const factText = text(raw?.text, 1_200);
  return factId === undefined || factText === undefined ? undefined : { factId, text: factText };
}

function claim(value: unknown): CoverLetterClaimFindingView | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const paragraph = count(raw.paragraph);
  const sentence = text(raw.sentence);
  const about = oneOf(["candidate", "employer"] as const, raw.about);
  const reason = oneOf(coverLetterClaimReasons, raw.reason);
  const numbers = list(raw.numbers, (item) => text(item, 40));
  const closestFact = raw.closestFact === null ? null : fact(raw.closestFact);
  if (
    paragraph === undefined ||
    sentence === undefined ||
    about === undefined ||
    reason === undefined ||
    numbers === undefined ||
    closestFact === undefined
  ) {
    return undefined;
  }
  return { paragraph, sentence, about, reason, numbers, closestFact };
}

function requirement(
  value: unknown,
): CoverLetterCheckView["requirements"]["unanswered"][number] | undefined {
  const raw = record(value);
  const requirementId = identifier(raw?.requirementId);
  const requirementText = text(raw?.text, 1_200);
  const facts = list(raw?.facts, fact);
  return requirementId === undefined || requirementText === undefined || facts === undefined
    ? undefined
    : { requirementId, text: requirementText, facts };
}

function nullable<T>(
  value: unknown,
  parse: (value: unknown) => T | undefined,
): T | null | undefined {
  return value === null ? null : parse(value);
}

function wording(value: unknown): CoverLetterCheckView["wording"][number] | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const code = oneOf(coverLetterWordingCodes, raw.code);
  const paragraph = nullable(raw.paragraph, count);
  const sentence = nullable(raw.sentence, (item) => text(item));
  const match = nullable(raw.match, (item) => text(item, 400));
  if (code === undefined || paragraph === undefined || sentence === undefined) return undefined;
  if (match === undefined) return undefined;
  return { code, paragraph, sentence, match };
}

/** A check as the host answered it, or undefined when any part is malformed. */
export function normalizeCoverLetterCheckView(value: unknown): CoverLetterCheckView | undefined {
  const raw = record(value);
  const claims = record(raw?.claims);
  const requirements = record(raw?.requirements);
  if (claims === undefined || requirements === undefined) return undefined;
  const status = oneOf(["checked", "skipped"] as const, claims.status);
  const reason = nullable(claims.reason, (item) => oneOf(coverLetterCheckSkipReasons, item));
  const checkedSentences = count(claims.checkedSentences);
  const findings = list(claims.findings, claim);
  const source = oneOf(["kit", "brief", "none"] as const, requirements.source);
  const total = count(requirements.total);
  const unanswered = list(requirements.unanswered, requirement);
  const found = list(raw?.wording, wording);
  if (
    status === undefined ||
    reason === undefined ||
    checkedSentences === undefined ||
    findings === undefined ||
    source === undefined ||
    total === undefined ||
    unanswered === undefined ||
    found === undefined
  ) {
    return undefined;
  }
  return {
    claims: { status, reason, checkedSentences, findings },
    requirements: { source, total, unanswered },
    wording: found,
  };
}

export function validateCoverLetterCheckInput(value: unknown): CoverLetterCheckInput | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const applicationId = identifier(raw.applicationId);
  const letter = text(raw.text);
  return workspaceId === undefined || applicationId === undefined || letter === undefined
    ? undefined
    : { workspaceId, applicationId, text: letter };
}

export function normalizeCoverLetterCheckResult(
  value: unknown,
): CoverLetterCheckResult | undefined {
  const raw = record(value);
  const workspaceId = identifier(raw?.workspaceId);
  const applicationId = identifier(raw?.applicationId);
  const check = normalizeCoverLetterCheckView(raw?.check);
  return workspaceId === undefined || applicationId === undefined || check === undefined
    ? undefined
    : { workspaceId, applicationId, check };
}

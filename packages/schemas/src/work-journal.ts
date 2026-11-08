import { sourceSensitivityTiers } from "@draft-loop/domain/source-sensitivity";
import { z } from "zod";
import { contentScreeningSignals, contentScreeningVerdicts } from "./content-screening.js";

/**
 * The work journal (ADR 0011 D17, #2018): an agent files a short note about notable work it
 * helped ship, and the note waits for the candidate's review before it becomes career evidence.
 * One contract serves the API, the MCP server, the web and the CLI. Field names are the ones the
 * agent sees, so they follow the MCP tool's snake_case.
 */

export const workJournalCategories = [
  "feature",
  "integration",
  "payments",
  "infrastructure",
  "data",
  "security",
  "performance",
  "migration",
  "release",
  "incident",
  "design",
  "other",
] as const;
export type WorkJournalCategory = (typeof workJournalCategories)[number];

export const workJournalCandidateRoles = [
  "designed",
  "implemented",
  "directed",
  "reviewed",
] as const;
export type WorkJournalCandidateRole = (typeof workJournalCandidateRoles)[number];

export const workJournalLinkKinds = [
  "pull-request",
  "commit",
  "issue",
  "release",
  "document",
] as const;
export type WorkJournalLinkKind = (typeof workJournalLinkKinds)[number];

export const workJournalProjectVisibilities = ["public", "private", "unknown"] as const;
export type WorkJournalProjectVisibility = (typeof workJournalProjectVisibilities)[number];

export const workJournalNoteStatuses = ["pending", "approved", "merged", "discarded"] as const;
export type WorkJournalNoteStatus = (typeof workJournalNoteStatuses)[number];

/**
 * Content-free refusal codes. A refusal names what is wrong, never the text that was refused, so
 * it can be logged, relayed to the agent and shown to the candidate without leaking the note.
 */
export const workJournalRefusalCodes = [
  "invalid_note",
  "secret_like_content",
  "link_not_https",
  "metric_without_how_measured",
  "amend_not_pending",
] as const;
export type WorkJournalRefusalCode = (typeof workJournalRefusalCodes)[number];

export const workJournalLimits = Object.freeze({
  titleMin: 8,
  titleMax: 120,
  summaryMin: 40,
  summaryMax: 1_500,
  technologiesMin: 1,
  technologiesMax: 15,
  linksMax: 10,
  metricsMax: 5,
});

export const workJournalNoteIdSchema = z
  .string()
  .regex(/^wjn_[A-Za-z0-9_-]{8,64}$/u, "must be a work journal note id");

/** A calendar month (`2026-10`) or day (`2026-10-31`). */
const periodDate = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/u, "must be YYYY-MM or YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value.length === 7 ? `${value}-01` : value)), {
    message: "must be a real date",
  });

/** Whether a string holds a control character other than the allowed ones. */
function hasControlCharacter(value: string, allowed: readonly number[] = []): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 0x20 || code === 0x7f) && !allowed.includes(code)) return true;
  }
  return false;
}

/** One line of plain text, without control characters. */
function line(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacter(value), "must be one line of plain text");
}

/** Plain text that may hold line breaks but no other control characters. */
function text(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacter(value, [0x09, 0x0a, 0x0d]), "must be plain text");
}

export const workJournalPeriodSchema = z
  .object({ start: periodDate, end: periodDate.optional() })
  .strict()
  .refine((period) => period.end === undefined || period.end >= period.start, {
    message: "end must not be before start",
    path: ["end"],
  });

export const workJournalProjectSchema = z
  .object({
    name: line(1, 120),
    visibility: z.enum(workJournalProjectVisibilities),
    repository: line(1, 200).optional(),
  })
  .strict();

export const workJournalLinkSchema = z
  .object({
    kind: z.enum(workJournalLinkKinds),
    url: z
      .string()
      .trim()
      .max(2_000)
      .refine(isHttpsUrl, {
        message: "must be an https address",
        params: { code: "link_not_https" },
      }),
  })
  .strict();

export const workJournalMetricSchema = z
  .object({
    description: line(1, 200),
    how_measured: line(1, 300).optional(),
  })
  .strict()
  .refine((metric) => metric.how_measured !== undefined, {
    message: "every metric needs how_measured",
    path: ["how_measured"],
    params: { code: "metric_without_how_measured" },
  });

function uniqueCaseInsensitive(values: readonly string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size === values.length;
}

/** The fields of a note, without the agent's call options. */
export const workJournalNoteContentSchema = z
  .object({
    title: line(workJournalLimits.titleMin, workJournalLimits.titleMax),
    summary: text(workJournalLimits.summaryMin, workJournalLimits.summaryMax),
    period: workJournalPeriodSchema,
    project: workJournalProjectSchema,
    technologies: z
      .array(line(1, 60))
      .min(workJournalLimits.technologiesMin)
      .max(workJournalLimits.technologiesMax)
      .refine(uniqueCaseInsensitive, "technologies must be unique"),
    category: z.enum(workJournalCategories),
    candidate_role: z
      .array(z.enum(workJournalCandidateRoles))
      .min(1)
      .refine((roles) => new Set(roles).size === roles.length, "roles must be unique"),
    links: z.array(workJournalLinkSchema).max(workJournalLimits.linksMax).default([]),
    metrics: z.array(workJournalMetricSchema).max(workJournalLimits.metricsMax).default([]),
  })
  .strict();
export type WorkJournalNoteContent = z.infer<typeof workJournalNoteContentSchema>;

/** What `record_work` sends: the note plus how to file it. */
export const workJournalNoteInputSchema = workJournalNoteContentSchema
  .extend({
    dedupe_key: line(1, 200).optional(),
    amends: workJournalNoteIdSchema.optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();
export type WorkJournalNoteInput = z.infer<typeof workJournalNoteInputSchema>;

/**
 * The note's injection screening (sprint 1m rules): a `flagged` or `unscreened` note is
 * quarantined and cannot be approved. Closed codes only, never text.
 */
export const workJournalScreeningSchema = z
  .object({
    verdict: z.enum(contentScreeningVerdicts),
    signals: z.array(z.enum(contentScreeningSignals)).max(contentScreeningSignals.length),
    screened_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type WorkJournalScreening = z.infer<typeof workJournalScreeningSchema>;

/** The candidate's approval: where the note went and the tier they confirmed. */
export const workJournalApprovalSchema = z
  .object({
    knowledge_base_id: line(1, 200),
    tier: z.enum(sourceSensitivityTiers),
    source_id: line(1, 200).optional(),
    approved_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type WorkJournalApproval = z.infer<typeof workJournalApprovalSchema>;

/** An agent token's id, as the API issues it: never its secret. */
export const workJournalAgentTokenIdSchema = z.string().regex(/^dlat_[A-Za-z0-9_-]{8,64}$/u);

/** The most agent token ids a note keeps for its amendments; the newest are kept. */
export const maximumWorkJournalAmendingTokens = 20;

/**
 * A stored note. After an edit it holds the edited content only: the agent's original text is
 * not kept, and `edit_count` says that it changed. `agent_token_id` names the agent token that
 * filed it and never changes; `amended_by_agent_token_ids` lists the tokens that amended it, so
 * the owner can find everything a leaked token touched (agent token audit, A-4).
 */
export const workJournalStoredNoteSchema = z
  .object({
    id: workJournalNoteIdSchema,
    tenant_id: line(1, 200),
    workspace_id: line(1, 200),
    status: z.enum(workJournalNoteStatuses),
    content: workJournalNoteContentSchema,
    dedupe_key: line(1, 400),
    possible_duplicate_of: z.array(workJournalNoteIdSchema).max(20).default([]),
    merged_into: workJournalNoteIdSchema.optional(),
    approval: workJournalApprovalSchema.optional(),
    screening: workJournalScreeningSchema,
    edit_count: z.number().int().min(0),
    agent_token_id: workJournalAgentTokenIdSchema.optional(),
    amended_by_agent_token_ids: z
      .array(workJournalAgentTokenIdSchema)
      .max(maximumWorkJournalAmendingTokens)
      .optional(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type WorkJournalStoredNote = z.infer<typeof workJournalStoredNoteSchema>;

/** What `list_work` and the default list view show: no summaries, links or metrics. */
export const workJournalNoteListItemSchema = z
  .object({
    id: workJournalNoteIdSchema,
    title: z.string(),
    period: workJournalPeriodSchema,
    project: z.string(),
    technologies: z.array(z.string()),
    category: z.enum(workJournalCategories),
    status: z.enum(workJournalNoteStatuses),
    created_at: z.string(),
  })
  .strict();
export type WorkJournalNoteListItem = z.infer<typeof workJournalNoteListItemSchema>;

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/**
 * Credential-shaped text a note must never carry. Matching is deliberately broad: a refused note
 * costs the agent one retry, a stored key costs the candidate a rotation.
 */
const secretPatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/u,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/iu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/iu,
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|secret)\s*[:=]\s*["']?[^"'\s,;]{6,}/iu,
];

function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (value !== null && typeof value === "object")
    for (const item of Object.values(value)) strings(item, into);
  return into;
}

/** Whether any string anywhere in a value looks like a credential. */
export function containsSecretLikeContent(value: unknown): boolean {
  return strings(value).some((item) => secretPatterns.some((pattern) => pattern.test(item)));
}

export type WorkJournalNoteCheck<Note> =
  | { readonly ok: true; readonly note: Note }
  | {
      readonly ok: false;
      readonly code: WorkJournalRefusalCode;
      /** Dotted paths of the fields at fault; never their values. */
      readonly fields: readonly string[];
    };

function refusal(error: z.ZodError): {
  readonly code: WorkJournalRefusalCode;
  readonly fields: readonly string[];
} {
  const coded = (code: WorkJournalRefusalCode) =>
    error.issues.filter(
      (issue) =>
        issue.code === "custom" && (issue as { params?: { code?: string } }).params?.code === code,
    );
  const fields = (issues: readonly z.core.$ZodIssue[]) => [
    ...new Set(issues.map((issue) => issue.path.join("."))),
  ];
  for (const code of ["link_not_https", "metric_without_how_measured"] as const) {
    const issues = coded(code);
    if (issues.length > 0) return { code, fields: fields(issues) };
  }
  return { code: "invalid_note", fields: fields(error.issues) };
}

function check<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): WorkJournalNoteCheck<z.infer<Schema>> {
  if (containsSecretLikeContent(input))
    return { ok: false, code: "secret_like_content", fields: [] };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, ...refusal(parsed.error) };
  return { ok: true, note: parsed.data };
}

/** Checks what an agent sent, refusing with a content-free code. */
export function checkWorkJournalNoteInput(
  input: unknown,
): WorkJournalNoteCheck<WorkJournalNoteInput> {
  return check(workJournalNoteInputSchema, input);
}

/** Checks a candidate's edit of a note's content with the same rules as intake. */
export function checkWorkJournalNoteContent(
  input: unknown,
): WorkJournalNoteCheck<WorkJournalNoteContent> {
  return check(workJournalNoteContentSchema, input);
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

/**
 * The exact dedupe key: the agent's own key when it gave one, else the repository with the first
 * pull request link, else the project with the title.
 */
export function workJournalDedupeKey(input: WorkJournalNoteInput): string {
  if (input.dedupe_key !== undefined) return `key:${normalized(input.dedupe_key)}`;
  const pullRequest = input.links.find((link) => link.kind === "pull-request");
  if (input.project.repository !== undefined && pullRequest !== undefined) {
    return `pr:${normalized(input.project.repository)}|${pullRequest.url.trim().toLowerCase()}`;
  }
  return `title:${normalized(input.project.name)}|${normalized(input.title)}`;
}

function periodEnd(period: WorkJournalNoteContent["period"]): string {
  return period.end ?? period.start;
}

/** The words of a title that carry meaning: three letters or more, lower case. */
function titleWords(title: string): Set<string> {
  return new Set(
    normalized(title)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  );
}

/** Whether two titles name the same work: at least 60% of their meaningful words are shared. */
function similarTitles(left: string, right: string): boolean {
  const leftWords = titleWords(left);
  const rightWords = titleWords(right);
  if (leftWords.size === 0 || rightWords.size === 0) return normalized(left) === normalized(right);
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / new Set([...leftWords, ...rightWords]).size >= 0.6;
}

/**
 * Whether two notes likely describe the same work: the same project with overlapping periods and
 * either one shared link or nearly the same title. Shared technologies do not count: one
 * project's notes all share its stack. Shown side by side for the candidate to merge, never
 * merged by itself.
 */
export function isLikelyWorkJournalDuplicate(
  left: WorkJournalNoteContent,
  right: WorkJournalNoteContent,
): boolean {
  if (normalized(left.project.name) !== normalized(right.project.name)) return false;
  const overlaps =
    left.period.start.slice(0, 7) <= periodEnd(right.period).slice(0, 7) &&
    right.period.start.slice(0, 7) <= periodEnd(left.period).slice(0, 7);
  if (!overlaps) return false;
  const links = new Set(left.links.map((link) => link.url.trim().toLowerCase()));
  const sharedLink = right.links.some((link) => links.has(link.url.trim().toLowerCase()));
  return sharedLink || similarTitles(left.title, right.title);
}

/** Projects a stored note to the list view, which carries no summary, links or metrics. */
export function workJournalNoteListItem(note: WorkJournalStoredNote): WorkJournalNoteListItem {
  return {
    id: note.id,
    title: note.content.title,
    period: note.content.period,
    project: note.content.project.name,
    technologies: [...note.content.technologies],
    category: note.content.category,
    status: note.status,
    created_at: note.created_at,
  };
}

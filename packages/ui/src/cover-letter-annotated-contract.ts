/**
 * Bridge contract for the annotated draft on the Cover letter tab (#3281). The host reads the
 * newest cover letter a model drafted for the application, or drafts one when the person asks,
 * paragraph by paragraph with the facts each one cites. The screen builds its notes from that
 * without another model call, and saves only the person's own version through the writing kit's
 * save and download commands.
 */

export interface AnnotatedDraftParagraphView {
  readonly text: string;
  /** The approved facts from the career record this paragraph cites. */
  readonly facts: readonly { readonly factId: string; readonly text: string }[];
  /** The dated facts about the employer it cites. */
  readonly employerFacts: readonly { readonly findingId: string; readonly text: string }[];
}

export interface AnnotatedDraftView {
  /** The drafted letter's id; the person's first version is saved based on it. */
  readonly id: string;
  readonly createdAt: string;
  /** The model that drafted it, for the screen's provenance line. */
  readonly model: string;
  readonly paragraphs: readonly AnnotatedDraftParagraphView[];
}

/** The newest drafted letter, or null before one exists. */
export interface AnnotatedDraftLoadResult {
  readonly draft: AnnotatedDraftView | null;
}

export interface AnnotatedDraftPrepareResult {
  readonly draft: AnnotatedDraftView;
}

type Raw = Readonly<Record<string, unknown>>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,199}$/u;
const maximumTextCharacters = 4_000;
const maximumParagraphs = 10;
const maximumCitations = 40;

function record(value: unknown, keys: readonly string[]): Raw | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Raw;
  return Object.keys(raw).every((key) => keys.includes(key)) ? raw : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximumTextCharacters
    ? value
    : undefined;
}

/** Every entry mapped, or undefined when the list is too long or one entry is invalid. */
function list<Value>(
  value: unknown,
  maximum: number,
  map: (entry: unknown) => Value | undefined,
): Value[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const mapped = value.map(map);
  return mapped.some((entry) => entry === undefined) ? undefined : (mapped as Value[]);
}

function citation<Key extends string>(key: Key) {
  return (value: unknown): ({ readonly [K in Key]: string } & { text: string }) | undefined => {
    const raw = record(value, [key, "text"]);
    const id = identifier(raw?.[key]);
    const cited = text(raw?.text);
    return id === undefined || cited === undefined
      ? undefined
      : ({ [key]: id, text: cited } as { readonly [K in Key]: string } & { text: string });
  };
}

function paragraph(value: unknown): AnnotatedDraftParagraphView | undefined {
  const raw = record(value, ["text", "facts", "employerFacts"]);
  if (raw === undefined) return undefined;
  const body = text(raw.text);
  const facts = list(raw.facts, maximumCitations, citation("factId"));
  const employerFacts = list(raw.employerFacts, maximumCitations, citation("findingId"));
  return body === undefined || facts === undefined || employerFacts === undefined
    ? undefined
    : { text: body, facts, employerFacts };
}

export function normalizeAnnotatedDraft(value: unknown): AnnotatedDraftView | undefined {
  const raw = record(value, ["id", "createdAt", "model", "paragraphs"]);
  if (raw === undefined) return undefined;
  const id = identifier(raw.id);
  const createdAt =
    typeof raw.createdAt === "string" &&
    raw.createdAt.length <= 64 &&
    Number.isFinite(Date.parse(raw.createdAt))
      ? raw.createdAt
      : undefined;
  const model = text(raw.model);
  const paragraphs = list(raw.paragraphs, maximumParagraphs, paragraph);
  return id === undefined ||
    createdAt === undefined ||
    model === undefined ||
    paragraphs === undefined ||
    paragraphs.length === 0
    ? undefined
    : { id, createdAt, model, paragraphs };
}

export function normalizeAnnotatedDraftLoadResult(
  value: unknown,
): AnnotatedDraftLoadResult | undefined {
  const raw = record(value, ["draft"]);
  if (raw === undefined) return undefined;
  if (raw.draft === null) return { draft: null };
  const draft = normalizeAnnotatedDraft(raw.draft);
  return draft === undefined ? undefined : { draft };
}

export function normalizeAnnotatedDraftPrepareResult(
  value: unknown,
): AnnotatedDraftPrepareResult | undefined {
  const draft = normalizeAnnotatedDraft(record(value, ["draft"])?.draft);
  return draft === undefined ? undefined : { draft };
}

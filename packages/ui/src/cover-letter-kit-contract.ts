/**
 * Bridge contract for the cover letter writing kit screen (#3279). The host prepares a kit (the
 * material for the person to write their own letter: requirements with the facts that prove
 * them, opening angles and an outline as notes, dated employer facts, phrases to avoid), keeps the
 * person's own letter as a new version beside it and downloads that letter as Word or PDF. Hosts
 * without a kit leave these capabilities out, and the screen is not offered.
 */

import { type ExportTemplate, exportTemplates } from "./export-template.js";

export interface CoverLetterKitFactView {
  readonly factId: string;
  readonly text: string;
}

export interface CoverLetterKitView {
  /** The saved kit's id; the person's letter is saved based on it. */
  readonly id: string;
  readonly createdAt: string;
  /** The model that prepared the kit, for the screen's provenance line. */
  readonly model: string;
  readonly requirements: readonly {
    readonly requirementId: string;
    readonly text: string;
    readonly facts: readonly CoverLetterKitFactView[];
  }[];
  readonly angles: readonly {
    readonly note: string;
    readonly factIds: readonly string[];
    readonly findingIds: readonly string[];
  }[];
  readonly employerFacts: readonly {
    readonly findingId: string;
    readonly text: string;
    readonly publishedOn: string;
  }[];
  readonly outline: readonly {
    readonly paragraph: number;
    readonly purpose: string;
    readonly requirementIds: readonly string[];
    readonly factIds: readonly string[];
    readonly findingIds: readonly string[];
  }[];
  readonly avoid: readonly string[];
}

/** A letter the person wrote in their own words, one entry per paragraph. */
export interface OwnCoverLetterView {
  readonly id: string;
  readonly createdAt: string;
  readonly paragraphs: readonly string[];
}

export interface CoverLetterKitScopeInput {
  readonly workspaceId: string;
  readonly applicationId: string;
}

export interface OwnCoverLetterSaveInput extends CoverLetterKitScopeInput {
  /** The kit, or the person's earlier letter, this version follows. */
  readonly basedOn: string;
  readonly paragraphs: readonly string[];
}

export interface OwnCoverLetterDownloadInput extends CoverLetterKitScopeInput {
  readonly letterId: string;
  readonly format: "docx" | "pdf";
  readonly template: ExportTemplate;
}

/** The newest kit and the newest letter the person wrote, when there are any. */
export interface CoverLetterKitLoadResult {
  readonly kit: CoverLetterKitView | null;
  readonly letter: OwnCoverLetterView | null;
}

export interface CoverLetterKitPrepareResult {
  readonly kit: CoverLetterKitView;
}

export interface OwnCoverLetterSaveResult {
  readonly letter: OwnCoverLetterView;
}

export interface OwnCoverLetterDownloadResult {
  readonly letterId: string;
}

/** A letter holds at most ten paragraphs of 4,000 characters, as any saved cover letter. */
export const maximumOwnLetterParagraphs = 10;
export const maximumOwnLetterParagraphCharacters = 4_000;

type Raw = Readonly<Record<string, unknown>>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,199}$/u;
const maximumTextCharacters = 4_000;
const maximumListEntries = 80;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function onlyKeys(value: Raw, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximumTextCharacters
    ? value
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

/** Every entry mapped, or undefined when the list is too long or one entry is invalid. */
function list<Value>(value: unknown, map: (entry: unknown) => Value | undefined) {
  if (!Array.isArray(value) || value.length > maximumListEntries) return undefined;
  const mapped = value.map(map);
  return mapped.some((entry) => entry === undefined) ? undefined : (mapped as Value[]);
}

function fields<Value>(
  value: unknown,
  keys: readonly string[],
  build: (raw: Raw) => Value | undefined,
): Value | undefined {
  const raw = record(value);
  return raw === undefined || !onlyKeys(raw, keys) ? undefined : build(raw);
}

/** The object when every field is set, typed without `undefined`; undefined otherwise. */
function allDefined<Value extends object>(
  value: Value,
): { [Key in keyof Value]: Exclude<Value[Key], undefined> } | undefined {
  return Object.values(value).some((entry) => entry === undefined)
    ? undefined
    : (value as { [Key in keyof Value]: Exclude<Value[Key], undefined> });
}

export function normalizeCoverLetterKit(value: unknown): CoverLetterKitView | undefined {
  return fields(
    value,
    ["id", "createdAt", "model", "requirements", "angles", "employerFacts", "outline", "avoid"],
    (raw) =>
      allDefined({
        id: identifier(raw.id),
        createdAt: timestamp(raw.createdAt),
        model: text(raw.model),
        requirements: list(raw.requirements, (entry) =>
          fields(entry, ["requirementId", "text", "facts"], (requirement) =>
            allDefined({
              requirementId: identifier(requirement.requirementId),
              text: text(requirement.text),
              facts: list(requirement.facts, (fact) =>
                fields(fact, ["factId", "text"], (raw) =>
                  allDefined({ factId: identifier(raw.factId), text: text(raw.text) }),
                ),
              ),
            }),
          ),
        ),
        angles: list(raw.angles, (entry) =>
          fields(entry, ["note", "factIds", "findingIds"], (angle) =>
            allDefined({
              note: text(angle.note),
              factIds: list(angle.factIds, identifier),
              findingIds: list(angle.findingIds, identifier),
            }),
          ),
        ),
        employerFacts: list(raw.employerFacts, (entry) =>
          fields(entry, ["findingId", "text", "publishedOn"], (fact) =>
            allDefined({
              findingId: identifier(fact.findingId),
              text: text(fact.text),
              publishedOn: timestamp(fact.publishedOn),
            }),
          ),
        ),
        outline: list(raw.outline, (entry) =>
          fields(
            entry,
            ["paragraph", "purpose", "requirementIds", "factIds", "findingIds"],
            (part) =>
              allDefined({
                paragraph:
                  typeof part.paragraph === "number" &&
                  Number.isInteger(part.paragraph) &&
                  part.paragraph >= 1 &&
                  part.paragraph <= 10
                    ? part.paragraph
                    : undefined,
                purpose: text(part.purpose),
                requirementIds: list(part.requirementIds, identifier),
                factIds: list(part.factIds, identifier),
                findingIds: list(part.findingIds, identifier),
              }),
          ),
        ),
        avoid: list(raw.avoid, text),
      }),
  );
}

function paragraphs(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumOwnLetterParagraphs) return undefined;
  const all = value.map((entry) =>
    typeof entry === "string" &&
    entry.trim() !== "" &&
    entry.length <= maximumOwnLetterParagraphCharacters
      ? entry
      : undefined,
  );
  return all.some((entry) => entry === undefined) ? undefined : (all as string[]);
}

export function normalizeOwnCoverLetter(value: unknown): OwnCoverLetterView | undefined {
  return fields(value, ["id", "createdAt", "paragraphs"], (raw) => {
    const letter = allDefined({
      id: identifier(raw.id),
      createdAt: timestamp(raw.createdAt),
      paragraphs: paragraphs(raw.paragraphs),
    });
    return letter === undefined || letter.paragraphs.length === 0 ? undefined : letter;
  });
}

// -- Inputs ---------------------------------------------------------------------------------

export function validateCoverLetterKitScopeInput(
  value: unknown,
): CoverLetterKitScopeInput | undefined {
  return fields(value, ["workspaceId", "applicationId"], (raw) =>
    allDefined({
      workspaceId: identifier(raw.workspaceId),
      applicationId: identifier(raw.applicationId),
    }),
  );
}

export function validateOwnCoverLetterSaveInput(
  value: unknown,
): OwnCoverLetterSaveInput | undefined {
  return fields(value, ["workspaceId", "applicationId", "basedOn", "paragraphs"], (raw) => {
    const input = allDefined({
      workspaceId: identifier(raw.workspaceId),
      applicationId: identifier(raw.applicationId),
      basedOn: identifier(raw.basedOn),
      paragraphs: paragraphs(raw.paragraphs),
    });
    return input === undefined || input.paragraphs.length === 0 ? undefined : input;
  });
}

export function validateOwnCoverLetterDownloadInput(
  value: unknown,
): OwnCoverLetterDownloadInput | undefined {
  return fields(value, ["workspaceId", "applicationId", "letterId", "format", "template"], (raw) =>
    allDefined({
      workspaceId: identifier(raw.workspaceId),
      applicationId: identifier(raw.applicationId),
      letterId: identifier(raw.letterId),
      format: raw.format === "docx" || raw.format === "pdf" ? raw.format : undefined,
      template: (exportTemplates as readonly unknown[]).includes(raw.template)
        ? (raw.template as ExportTemplate)
        : undefined,
    }),
  );
}

// -- Results --------------------------------------------------------------------------------

export function normalizeCoverLetterKitLoadResult(
  value: unknown,
): CoverLetterKitLoadResult | undefined {
  return fields(value, ["kit", "letter"], (raw) => {
    const kit = raw.kit === null ? null : normalizeCoverLetterKit(raw.kit);
    const letter = raw.letter === null ? null : normalizeOwnCoverLetter(raw.letter);
    return kit === undefined || letter === undefined ? undefined : { kit, letter };
  });
}

export function normalizeCoverLetterKitPrepareResult(
  value: unknown,
): CoverLetterKitPrepareResult | undefined {
  return fields(value, ["kit"], (raw) => allDefined({ kit: normalizeCoverLetterKit(raw.kit) }));
}

export function normalizeOwnCoverLetterSaveResult(
  value: unknown,
): OwnCoverLetterSaveResult | undefined {
  return fields(value, ["letter"], (raw) =>
    allDefined({ letter: normalizeOwnCoverLetter(raw.letter) }),
  );
}

export function normalizeOwnCoverLetterDownloadResult(
  value: unknown,
): OwnCoverLetterDownloadResult | undefined {
  return fields(value, ["letterId"], (raw) => allDefined({ letterId: identifier(raw.letterId) }));
}

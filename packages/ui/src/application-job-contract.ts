/**
 * Bridge contract for reading an application's job description back after a run has started.
 *
 * The review screen hides the job inputs once a run exists, so this read-only command is how the
 * reviewer consults the job the draft is written for. It carries the job text the application
 * holds and where it came from; a job added from a web page carries the approved address and the
 * copy of the page saved when it was read, so the job stays readable after the page expires
 * (#2592). No path crosses the bridge.
 * The runtime key lists are bound to the interfaces, so adding a field to one without the other
 * is a compile error rather than a validator that silently rejects real payloads.
 */

/**
 * - `workspace-file`: the workspace's own job file, for the default application.
 * - `pasted-text`: the text pasted when the application was created.
 * - `local-file`: the file chosen when the application was created, as it reads now.
 * - `url`: an approved job page: its address, and the copy saved when it was read, if any.
 * - `unavailable`: the job text could not be read.
 */
export const applicationJobOrigins = [
  "workspace-file",
  "pasted-text",
  "local-file",
  "url",
  "unavailable",
] as const;
export type ApplicationJobOrigin = (typeof applicationJobOrigins)[number];

export interface ApplicationJobInput {
  readonly workspaceId: string;
  /** The application whose job to read; omitted means the workspace's default application. */
  readonly applicationId?: string;
}

export type JobPageCopySource = "page" | "pasted";

/**
 * Saves a copy of a URL job's page (#2593): read once more from the approved address, or the
 * text the person pasted when the page can no longer be read.
 */
export interface ApplicationJobCopyInput extends ApplicationJobInput {
  readonly text?: string;
}

/** An earlier copy of a job page, kept when a later read of the page gave different text. */
export interface SavedJobPageCopy {
  readonly text: string;
  readonly savedAt: string;
}

export interface ApplicationJobResult {
  readonly workspaceId: string;
  readonly origin: ApplicationJobOrigin;
  /** The job text; for a URL job the saved copy, null without one or when it could not be read. */
  readonly text: string | null;
  /** True when the text was cut at `maximumApplicationJobTextLength`. */
  readonly truncated: boolean;
  /** The approved job page address, only for a URL job. */
  readonly url: string | null;
  /** When a URL job's copy was saved; null otherwise. */
  readonly savedAt: string | null;
  /** Whether a URL job's copy was read from the page or pasted by the person; null otherwise. */
  readonly copySource: JobPageCopySource | null;
  /** The first copy of a URL job's page, kept when a later read differed; null otherwise. */
  readonly earlier: SavedJobPageCopy | null;
}

/** The longest job text that crosses the bridge, in UTF-16 code units. */
export const maximumApplicationJobTextLength = 200_000;
const maximumUrlLength = 2_048;

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const applicationJobInputKeys = exactKeys<ApplicationJobInput>()([
  "workspaceId",
  "applicationId",
]);
export const applicationJobCopyInputKeys = exactKeys<ApplicationJobCopyInput>()([
  "workspaceId",
  "applicationId",
  "text",
]);
const resultKeys = exactKeys<ApplicationJobResult>()([
  "workspaceId",
  "origin",
  "text",
  "truncated",
  "url",
  "savedAt",
  "copySource",
  "earlier",
]);

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;

type Raw = Readonly<Record<string, unknown>>;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function webAddress(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > maximumUrlLength) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function timestamp(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

function savedCopy(value: unknown): SavedJobPageCopy | null | undefined {
  if (value === null) return null;
  const raw = record(value);
  if (raw === undefined || Object.keys(raw).some((key) => key !== "text" && key !== "savedAt")) {
    return undefined;
  }
  const savedAt = timestamp(raw.savedAt);
  const { text } = raw;
  if (typeof text !== "string" || text.length > maximumApplicationJobTextLength) return undefined;
  return savedAt === undefined ? undefined : { text, savedAt };
}

/** Validates the host's answer; `undefined` means the host answered wrongly. */
export function normalizeApplicationJobResult(value: unknown): ApplicationJobResult | undefined {
  const raw = record(value);
  if (raw === undefined || !Object.keys(raw).every((key) => resultKeys.includes(key as never))) {
    return undefined;
  }
  const workspaceId = identifier(raw.workspaceId);
  const origin = applicationJobOrigins.find((candidate) => candidate === raw.origin);
  if (workspaceId === undefined || origin === undefined || typeof raw.truncated !== "boolean") {
    return undefined;
  }
  // A URL job has text only when a copy of its page was saved, and then says when.
  const text = raw.text;
  const hasText = origin === "url" ? text !== null : origin !== "unavailable";
  if (hasText) {
    if (typeof text !== "string" || text.length > maximumApplicationJobTextLength) {
      return undefined;
    }
  } else if (text !== null || raw.truncated) {
    return undefined;
  }
  const url = origin === "url" ? webAddress(raw.url) : raw.url === null ? null : undefined;
  if (url === undefined) return undefined;
  const savedAt =
    origin === "url" && hasText ? timestamp(raw.savedAt) : raw.savedAt === null ? null : undefined;
  const earlier =
    origin === "url" && hasText ? savedCopy(raw.earlier) : raw.earlier === null ? null : undefined;
  const copySource =
    origin === "url" && hasText
      ? raw.copySource === "page" || raw.copySource === "pasted"
        ? raw.copySource
        : undefined
      : raw.copySource === null
        ? null
        : undefined;
  if (savedAt === undefined || earlier === undefined || copySource === undefined) return undefined;
  return {
    workspaceId,
    origin,
    text: hasText ? (text as string) : null,
    truncated: raw.truncated,
    url,
    savedAt,
    copySource,
    earlier,
  };
}

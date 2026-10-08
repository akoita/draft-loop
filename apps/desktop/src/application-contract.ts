/**
 * Bridge contract for job applications inside a workspace (ADR 0010).
 *
 * An application crosses the bridge as a path-free summary: its name, the kind of its job source
 * (never the stored path, URL or text), a derived status, timestamps, content-free counts and
 * ids. The runtime key lists are bound to the interfaces, so adding a field to one without the
 * other is a compile error rather than a validator that silently rejects real payloads.
 */
import {
  type ApplicationJobSourceKind,
  type ApplicationStatus,
  applicationJobSourceKinds,
  applicationNameMaxLength,
  applicationStatuses,
} from "@draft-loop/domain/application";

export type { ApplicationJobSourceKind, ApplicationStatus };

/** The largest pasted job description the application service stores. */
export const maximumApplicationJobTextLength = 200_000;

export interface ApplicationSummaryView {
  readonly id: string;
  readonly name: string;
  readonly jobSourceKind: ApplicationJobSourceKind;
  readonly status: ApplicationStatus;
  /** True for the application a workspace without created applications is read as. */
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runCount: number;
  readonly briefCount: number;
  readonly exportCount: number;
  /** The newest run, so the review can open on it; null before the first run. */
  readonly latestRunId: string | null;
}

export interface ApplicationListInput {
  readonly workspaceId: string;
}

export interface ApplicationGetInput {
  readonly workspaceId: string;
  readonly applicationId: string;
}

/**
 * Creates an application from pasted job text or from an approved job URL; give exactly one of
 * them. The host stores pasted text inside the workspace. A URL is stored with the approval and
 * fetched only when requirements are extracted, behind the extraction's own consent step.
 */
export interface ApplicationCreateInput {
  readonly workspaceId: string;
  readonly name: string;
  readonly jobText?: string;
  readonly jobUrl?: string;
  /** Must be `true` with a `jobUrl`: the person approved fetching that page. */
  readonly jobUrlApproved?: boolean;
}

/**
 * Imports another workspace as an application. The host shows the native folder picker, so no
 * path crosses the bridge in either direction.
 */
export interface ApplicationImportInput {
  readonly workspaceId: string;
  readonly selection?: "native-dialog";
}

/** What an import copied, as content-free counts. */
export interface ApplicationImportCounts {
  readonly runs: number;
  readonly briefs: number;
  readonly briefVersions: number;
  readonly exports: number;
  /** Completed exports whose file was missing in the source, so they were not imported. */
  readonly skippedExports: number;
}

export interface ApplicationImportResult {
  readonly workspaceId: string;
  readonly application: ApplicationSummaryView;
  readonly imported: ApplicationImportCounts;
}

export interface ApplicationListResult {
  readonly workspaceId: string;
  /** The default application first, then created applications, oldest first. */
  readonly applications: readonly ApplicationSummaryView[];
}

export interface ApplicationRecordResult {
  readonly workspaceId: string;
  readonly application: ApplicationSummaryView;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const applicationListKeys = exactKeys<ApplicationListInput>()(["workspaceId"]);
export const applicationGetKeys = exactKeys<ApplicationGetInput>()([
  "workspaceId",
  "applicationId",
]);
export const applicationImportKeys = exactKeys<ApplicationImportInput>()([
  "workspaceId",
  "selection",
]);
const importCountsKeys = exactKeys<ApplicationImportCounts>()([
  "runs",
  "briefs",
  "briefVersions",
  "exports",
  "skippedExports",
]);
const importResultKeys = exactKeys<ApplicationImportResult>()([
  "workspaceId",
  "application",
  "imported",
]);
export const applicationCreateKeys = exactKeys<ApplicationCreateInput>()([
  "workspaceId",
  "name",
  "jobText",
  "jobUrl",
  "jobUrlApproved",
]);
const summaryKeys = exactKeys<ApplicationSummaryView>()([
  "id",
  "name",
  "jobSourceKind",
  "status",
  "isDefault",
  "createdAt",
  "updatedAt",
  "runCount",
  "briefCount",
  "exportCount",
  "latestRunId",
]);
const listResultKeys = exactKeys<ApplicationListResult>()(["workspaceId", "applications"]);
const recordResultKeys = exactKeys<ApplicationRecordResult>()(["workspaceId", "application"]);

export const maximumListedApplications = 500;
const maximumCount = 1_000_000;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;

type Raw = Readonly<Record<string, unknown>>;

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

function displayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > applicationNameMaxLength) return undefined;
  const clean = [...trimmed].every((character) => character >= " " && character !== "\u007f");
  return clean ? trimmed : undefined;
}

function timestamp(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximumCount
    ? value
    : undefined;
}

function oneOf<Value extends string>(value: unknown, values: readonly Value[]): Value | undefined {
  return typeof value === "string" ? values.find((candidate) => candidate === value) : undefined;
}

/** Validates one summary received from the host; `undefined` means the host answered wrongly. */
export function normalizeApplicationSummary(value: unknown): ApplicationSummaryView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, summaryKeys)) return undefined;
  const id = identifier(raw.id);
  const name = displayName(raw.name);
  const jobSourceKind = oneOf(raw.jobSourceKind, applicationJobSourceKinds);
  const status = oneOf(raw.status, applicationStatuses);
  const createdAt = timestamp(raw.createdAt);
  const updatedAt = timestamp(raw.updatedAt);
  const runCount = count(raw.runCount);
  const briefCount = count(raw.briefCount);
  const exportCount = count(raw.exportCount);
  const latestRunId = raw.latestRunId === null ? null : identifier(raw.latestRunId);
  if (
    id === undefined ||
    name === undefined ||
    jobSourceKind === undefined ||
    status === undefined ||
    typeof raw.isDefault !== "boolean" ||
    createdAt === undefined ||
    updatedAt === undefined ||
    runCount === undefined ||
    briefCount === undefined ||
    exportCount === undefined ||
    latestRunId === undefined
  ) {
    return undefined;
  }
  return {
    id,
    name,
    jobSourceKind,
    status,
    isDefault: raw.isDefault,
    createdAt,
    updatedAt,
    runCount,
    briefCount,
    exportCount,
    latestRunId,
  };
}

export function normalizeApplicationListResult(value: unknown): ApplicationListResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, listResultKeys)) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  if (
    workspaceId === undefined ||
    !Array.isArray(raw.applications) ||
    raw.applications.length > maximumListedApplications
  ) {
    return undefined;
  }
  const applications: ApplicationSummaryView[] = [];
  for (const item of raw.applications as readonly unknown[]) {
    const application = normalizeApplicationSummary(item);
    if (application === undefined) return undefined;
    applications.push(application);
  }
  return { workspaceId, applications };
}

export function normalizeApplicationRecordResult(
  value: unknown,
): ApplicationRecordResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, recordResultKeys)) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const application = normalizeApplicationSummary(raw.application);
  if (workspaceId === undefined || application === undefined) return undefined;
  return { workspaceId, application };
}

export function normalizeApplicationImportResult(
  value: unknown,
): ApplicationImportResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, importResultKeys)) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const application = normalizeApplicationSummary(raw.application);
  const counts = record(raw.imported);
  if (workspaceId === undefined || application === undefined) return undefined;
  if (counts === undefined || !onlyKeys(counts, importCountsKeys)) return undefined;
  const runs = count(counts.runs);
  const briefs = count(counts.briefs);
  const briefVersions = count(counts.briefVersions);
  const exports = count(counts.exports);
  const skippedExports = count(counts.skippedExports);
  if (
    runs === undefined ||
    briefs === undefined ||
    briefVersions === undefined ||
    exports === undefined ||
    skippedExports === undefined
  ) {
    return undefined;
  }
  return {
    workspaceId,
    application,
    imported: { runs, briefs, briefVersions, exports, skippedExports },
  };
}

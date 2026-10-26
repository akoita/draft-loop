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
  /** True for the default application while its workspace has no job text; Home leaves it out. */
  readonly jobMissing?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runCount: number;
  readonly briefCount: number;
  readonly exportCount: number;
  /** The newest run, so the review can open on it; null before the first run. */
  readonly latestRunId: string | null;
  /** When the application was archived; null while it is on the main list. */
  readonly archivedAt: string | null;
  /** The model pair this application uses instead of the workspace's; null uses the workspace's. */
  readonly modelProfiles: ApplicationModelProfilesView | null;
  /** False only for a default application the person has not named yet. */
  readonly nameChosen: boolean;
  /** A name from the newest brief's role and employer, offered while the name is not chosen. */
  readonly suggestedName: string | null;
  /** The run whose draft the person chose for approval and export; absent uses the latest run. */
  readonly chosenRun?: ApplicationChosenRunView;
}

/** The run an application uses, and its number among the runs (oldest = 1). */
export interface ApplicationChosenRunView {
  readonly runId: string;
  readonly runNumber: number;
}

/**
 * Uses one of the application's runs for approval and export. The reason is the person's own
 * short text; the host refuses a run of another application or one without a draft.
 */
export interface ApplicationChooseRunInput {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly runId: string;
  readonly reason?: string;
}

/** The longest reason the application service stores for a chosen run. */
export const maximumChosenRunReasonLength = 500;

/** Exact author and critic model profile references, as the model profile picker names them. */
export interface ApplicationModelProfilesView {
  readonly author: { readonly id: string; readonly version: number };
  readonly critic: { readonly id: string; readonly version: number };
}

/** Sets the pair one application's new runs use, or clears it with `null`. */
export interface ApplicationSetModelsInput {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly modelProfiles: ApplicationModelProfilesView | null;
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

/** Archives an application with `archived: true`, or restores it with `false`. */
export interface ApplicationArchiveInput {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly archived: boolean;
}

/** Renames an application; the default application keeps the name as chosen. */
export interface ApplicationRenameInput {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly name: string;
}

/** Deletes a created application that holds no run, brief or export. */
export interface ApplicationDeleteInput {
  readonly workspaceId: string;
  readonly applicationId: string;
}

export interface ApplicationDeleteResult {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly deleted: true;
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
export const applicationArchiveKeys = exactKeys<ApplicationArchiveInput>()([
  "workspaceId",
  "applicationId",
  "archived",
]);
export const applicationRenameKeys = exactKeys<ApplicationRenameInput>()([
  "workspaceId",
  "applicationId",
  "name",
]);
export const applicationSetModelsKeys = exactKeys<ApplicationSetModelsInput>()([
  "workspaceId",
  "applicationId",
  "modelProfiles",
]);
export const applicationChooseRunKeys = exactKeys<ApplicationChooseRunInput>()([
  "workspaceId",
  "applicationId",
  "runId",
  "reason",
]);
const chosenRunKeys = exactKeys<ApplicationChosenRunView>()(["runId", "runNumber"]);
const modelProfilesKeys = exactKeys<ApplicationModelProfilesView>()(["author", "critic"]);
const modelProfileReferenceKeys = ["id", "version"] as const;
export const applicationDeleteKeys = exactKeys<ApplicationDeleteInput>()([
  "workspaceId",
  "applicationId",
]);
const deleteResultKeys = exactKeys<ApplicationDeleteResult>()([
  "workspaceId",
  "applicationId",
  "deleted",
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
  "jobMissing",
  "createdAt",
  "updatedAt",
  "runCount",
  "briefCount",
  "exportCount",
  "latestRunId",
  "archivedAt",
  "modelProfiles",
  "nameChosen",
  "suggestedName",
  "chosenRun",
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

/** A trimmed application name of 1 to 120 printable characters; `undefined` otherwise. */
export function normalizeApplicationDisplayName(value: unknown): string | undefined {
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

const modelProfileIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** Validates a model pair from either side of the bridge; `undefined` means it is malformed. */
export function normalizeApplicationModelProfiles(
  value: unknown,
): ApplicationModelProfilesView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, modelProfilesKeys)) return undefined;
  const reference = (item: unknown) => {
    const ref = record(item);
    if (ref === undefined || !onlyKeys(ref, modelProfileReferenceKeys)) return undefined;
    if (typeof ref.id !== "string" || !modelProfileIdPattern.test(ref.id)) return undefined;
    if (typeof ref.version !== "number" || !Number.isSafeInteger(ref.version) || ref.version < 1) {
      return undefined;
    }
    return { id: ref.id, version: ref.version };
  };
  const author = reference(raw.author);
  const critic = reference(raw.critic);
  return author === undefined || critic === undefined ? undefined : { author, critic };
}

/** A chosen run from the host, or `undefined` when it is malformed. */
function normalizeChosenRun(value: unknown): ApplicationChosenRunView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, chosenRunKeys)) return undefined;
  const runId = identifier(raw.runId);
  const runNumber = count(raw.runNumber);
  if (runId === undefined || runNumber === undefined || runNumber < 1) return undefined;
  return { runId, runNumber };
}

/**
 * The reason for choosing a run as the host takes it: trimmed, omitted when empty, and
 * `undefined` when it is too long or holds control characters other than line breaks and tabs.
 */
export function normalizeChosenRunReasonInput(value: unknown): string | null | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maximumChosenRunReasonLength) return undefined;
  const plain = [...trimmed].every(
    (character) =>
      character === "\n" || character === "\t" || (character >= " " && character !== "\u007f"),
  );
  return plain ? trimmed : undefined;
}

/** Validates one summary received from the host; `undefined` means the host answered wrongly. */
export function normalizeApplicationSummary(value: unknown): ApplicationSummaryView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, summaryKeys)) return undefined;
  const id = identifier(raw.id);
  const name = normalizeApplicationDisplayName(raw.name);
  const jobSourceKind = oneOf(raw.jobSourceKind, applicationJobSourceKinds);
  const status = oneOf(raw.status, applicationStatuses);
  const createdAt = timestamp(raw.createdAt);
  const updatedAt = timestamp(raw.updatedAt);
  const runCount = count(raw.runCount);
  const briefCount = count(raw.briefCount);
  const exportCount = count(raw.exportCount);
  const latestRunId = raw.latestRunId === null ? null : identifier(raw.latestRunId);
  const archivedAt = raw.archivedAt === null ? null : timestamp(raw.archivedAt);
  const modelProfiles =
    raw.modelProfiles === null ? null : normalizeApplicationModelProfiles(raw.modelProfiles);
  const suggestedName =
    raw.suggestedName === null ? null : normalizeApplicationDisplayName(raw.suggestedName);
  const chosenRun = raw.chosenRun === undefined ? undefined : normalizeChosenRun(raw.chosenRun);
  if (raw.chosenRun !== undefined && chosenRun === undefined) return undefined;
  if (
    id === undefined ||
    name === undefined ||
    jobSourceKind === undefined ||
    status === undefined ||
    typeof raw.isDefault !== "boolean" ||
    (raw.jobMissing !== undefined && typeof raw.jobMissing !== "boolean") ||
    createdAt === undefined ||
    updatedAt === undefined ||
    runCount === undefined ||
    briefCount === undefined ||
    exportCount === undefined ||
    latestRunId === undefined ||
    archivedAt === undefined ||
    modelProfiles === undefined ||
    typeof raw.nameChosen !== "boolean" ||
    suggestedName === undefined
  ) {
    return undefined;
  }
  return {
    id,
    name,
    jobSourceKind,
    status,
    isDefault: raw.isDefault,
    ...(raw.jobMissing === true ? { jobMissing: true } : {}),
    createdAt,
    updatedAt,
    runCount,
    briefCount,
    exportCount,
    latestRunId,
    archivedAt,
    modelProfiles,
    nameChosen: raw.nameChosen,
    suggestedName,
    ...(chosenRun === undefined ? {} : { chosenRun }),
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

export function normalizeApplicationDeleteResult(
  value: unknown,
): ApplicationDeleteResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, deleteResultKeys)) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const applicationId = identifier(raw.applicationId);
  if (workspaceId === undefined || applicationId === undefined || raw.deleted !== true) {
    return undefined;
  }
  return { workspaceId, applicationId, deleted: true };
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

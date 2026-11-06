/**
 * Bridge contract for the folders that group a workspace's applications on Home (#2283). A folder
 * crosses the bridge with its id, name, timestamps and how many applications it holds; moving an
 * application answers with the application's summary. Hosts without folders (the local-first
 * desktop) leave these capabilities out, and Home then shows no folder controls.
 */

import {
  applicationFolderLimit,
  isApplicationFolderId,
  normalizeApplicationFolderName,
} from "@draft-loop/domain/application-folder";

export interface ApplicationFolderView {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Applications in the folder, archived ones included. */
  readonly applicationCount: number;
}

export interface ApplicationFolderListInput {
  readonly workspaceId: string;
}

export interface ApplicationFolderCreateInput {
  readonly workspaceId: string;
  readonly name: string;
}

export interface ApplicationFolderRenameInput {
  readonly workspaceId: string;
  readonly folderId: string;
  readonly name: string;
}

export interface ApplicationFolderDeleteInput {
  readonly workspaceId: string;
  readonly folderId: string;
}

/** Puts an application in a folder, or in none with `null`. */
export interface ApplicationMoveInput {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly folderId: string | null;
}

export interface ApplicationFolderListResult {
  readonly workspaceId: string;
  readonly folders: readonly ApplicationFolderView[];
}

export interface ApplicationFolderRecordResult {
  readonly workspaceId: string;
  readonly folder: ApplicationFolderView;
}

export interface ApplicationFolderDeleteResult {
  readonly workspaceId: string;
  readonly folderId: string;
  /** Applications that went back to no folder; none is deleted. */
  readonly movedApplications: number;
}

type Raw = Readonly<Record<string, unknown>>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;
const maximumCount = 1_000_000;

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

/** A folder id the host issued; `undefined` for anything else. */
export function folderIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && isApplicationFolderId(value) ? value : undefined;
}

/** The trimmed folder name, or `undefined` when it is empty or longer than 60 characters. */
export function normalizeFolderName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return normalizeApplicationFolderName(value);
  } catch {
    return undefined;
  }
}

export function normalizeApplicationFolder(value: unknown): ApplicationFolderView | undefined {
  const raw = record(value);
  if (
    raw === undefined ||
    !onlyKeys(raw, ["id", "name", "createdAt", "updatedAt", "applicationCount"])
  ) {
    return undefined;
  }
  const id = folderIdentifier(raw.id);
  const name = normalizeFolderName(raw.name);
  const createdAt = timestamp(raw.createdAt);
  const updatedAt = timestamp(raw.updatedAt);
  const applicationCount = count(raw.applicationCount);
  if (
    id === undefined ||
    name === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    applicationCount === undefined
  ) {
    return undefined;
  }
  return { id, name, createdAt, updatedAt, applicationCount };
}

// -- Inputs ---------------------------------------------------------------------------------

export function validateApplicationFolderListInput(
  value: unknown,
): ApplicationFolderListInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  return workspaceId === undefined ? undefined : { workspaceId };
}

export function validateApplicationFolderCreateInput(
  value: unknown,
): ApplicationFolderCreateInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "name"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const name = normalizeFolderName(raw.name);
  return workspaceId === undefined || name === undefined ? undefined : { workspaceId, name };
}

export function validateApplicationFolderRenameInput(
  value: unknown,
): ApplicationFolderRenameInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "folderId", "name"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const folderId = folderIdentifier(raw.folderId);
  const name = normalizeFolderName(raw.name);
  return workspaceId === undefined || folderId === undefined || name === undefined
    ? undefined
    : { workspaceId, folderId, name };
}

export function validateApplicationFolderDeleteInput(
  value: unknown,
): ApplicationFolderDeleteInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "folderId"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const folderId = folderIdentifier(raw.folderId);
  return workspaceId === undefined || folderId === undefined
    ? undefined
    : { workspaceId, folderId };
}

export function validateApplicationMoveInput(value: unknown): ApplicationMoveInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "applicationId", "folderId"])) {
    return undefined;
  }
  const workspaceId = identifier(raw.workspaceId);
  const applicationId = identifier(raw.applicationId);
  const folderId = raw.folderId === null ? null : folderIdentifier(raw.folderId);
  return workspaceId === undefined || applicationId === undefined || folderId === undefined
    ? undefined
    : { workspaceId, applicationId, folderId };
}

// -- Results --------------------------------------------------------------------------------

export function normalizeApplicationFolderListResult(
  value: unknown,
): ApplicationFolderListResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "folders"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  if (
    workspaceId === undefined ||
    !Array.isArray(raw.folders) ||
    raw.folders.length > applicationFolderLimit
  ) {
    return undefined;
  }
  const folders = raw.folders.map(normalizeApplicationFolder);
  if (folders.some((folder) => folder === undefined)) return undefined;
  return { workspaceId, folders: folders as ApplicationFolderView[] };
}

export function normalizeApplicationFolderRecordResult(
  value: unknown,
): ApplicationFolderRecordResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "folder"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const folder = normalizeApplicationFolder(raw.folder);
  return workspaceId === undefined || folder === undefined ? undefined : { workspaceId, folder };
}

export function normalizeApplicationFolderDeleteResult(
  value: unknown,
): ApplicationFolderDeleteResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "folderId", "movedApplications"])) {
    return undefined;
  }
  const workspaceId = identifier(raw.workspaceId);
  const folderId = folderIdentifier(raw.folderId);
  const movedApplications = count(raw.movedApplications);
  return workspaceId === undefined || folderId === undefined || movedApplications === undefined
    ? undefined
    : { workspaceId, folderId, movedApplications };
}

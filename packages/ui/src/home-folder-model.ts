import { t } from "@lingui/core/macro";
/**
 * Home's folder sections (#2283): one section per folder in creation order, then No folder.
 * Archived applications stay in their own group below, whatever their folder. Whether Home groups
 * by folder and which sections are folded are display choices, remembered per device.
 */
import type { ApplicationSummaryView } from "./application-contract.js";
import type { ApplicationFolderView } from "./application-folder-contract.js";

export const noFolderSectionKey = "none";
export const noFolderLabel = "No folder";

export interface FolderSection {
  /** The folder id, or `none` for the applications in no folder. */
  readonly key: string;
  readonly folder: ApplicationFolderView | null;
  readonly applications: readonly ApplicationSummaryView[];
}

/**
 * Splits already filtered and sorted applications into folder sections, keeping their order. An
 * application whose folder is unknown, such as one deleted in another window, reads as in no
 * folder. While a search or filter narrows the list, sections with no match are left out;
 * otherwise an empty folder still shows, so a folder just created is there to move into.
 */
export function folderSections(
  applications: readonly ApplicationSummaryView[],
  folders: readonly ApplicationFolderView[],
  narrowed: boolean,
): readonly FolderSection[] {
  const known = new Set(folders.map((folder) => folder.id));
  const byFolder = new Map<string, ApplicationSummaryView[]>();
  for (const application of applications) {
    const key =
      application.folderId !== undefined && known.has(application.folderId)
        ? application.folderId
        : noFolderSectionKey;
    const list = byFolder.get(key) ?? [];
    list.push(application);
    byFolder.set(key, list);
  }
  const sections: FolderSection[] = folders.map((folder) => ({
    key: folder.id,
    folder,
    applications: byFolder.get(folder.id) ?? [],
  }));
  sections.push({
    key: noFolderSectionKey,
    folder: null,
    applications: byFolder.get(noFolderSectionKey) ?? [],
  });
  return sections.filter(
    (section) => section.applications.length > 0 || (section.folder !== null && !narrowed),
  );
}

/** Where an application can go from its current folder: every other folder, then out of any. */
export function moveTargets(
  application: ApplicationSummaryView,
  folders: readonly ApplicationFolderView[],
): readonly { readonly folderId: string | null; readonly label: string }[] {
  const current = folders.some((folder) => folder.id === application.folderId)
    ? application.folderId
    : undefined;
  return [
    ...folders
      .filter((folder) => folder.id !== current)
      .map((folder) => ({ folderId: folder.id, label: t`Move to ${folder.name}` })),
    ...(current === undefined ? [] : [{ folderId: null, label: t`Remove from folder` }]),
  ];
}

export function folderDeleteConfirmation(folder: ApplicationFolderView): string {
  const held = folder.applicationCount;
  const what =
    held === 0
      ? t`It is empty.`
      : held === 1
        ? t`Its 1 application moves to No folder.`
        : t`Its ${held} applications move to No folder.`;
  return t`Delete the folder “${folder.name}”? ${what} No application is deleted.`;
}

export function folderMoveNotice(
  application: ApplicationSummaryView,
  folderId: string | null,
  folders: readonly ApplicationFolderView[],
): string {
  const folder = folders.find((item) => item.id === folderId);
  return folder === undefined
    ? t`Took "${application.name}" out of its folder.`
    : t`Moved "${application.name}" to ${folder.name}.`;
}

/** The error a person reads; the host's own words when it gave short ones. */
export function folderErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message === "" || message.length > 300 ? fallback : message;
}

// -- Per-device choices ---------------------------------------------------------------------

export const folderPreferencesKey = "draft-loop.home.folders";
export const folderGroupings = ["folders", "together"] as const;
export type FolderGrouping = (typeof folderGroupings)[number];

export interface FolderPreferences {
  readonly grouping: FolderGrouping;
  /** Folded sections by key: folder ids, or `none` for No folder. */
  readonly folded: readonly string[];
}

export const defaultFolderPreferences: FolderPreferences = { grouping: "folders", folded: [] };

/** The most folded keys kept: the folder limit and No folder. */
const maximumFolded = 51;

export function readFolderPreferences(
  storage: Pick<Storage, "getItem"> | undefined,
): FolderPreferences {
  if (storage === undefined) return defaultFolderPreferences;
  try {
    const raw: unknown = JSON.parse(storage.getItem(folderPreferencesKey) ?? "null");
    if (typeof raw !== "object" || raw === null) return defaultFolderPreferences;
    const { grouping, folded } = raw as Record<string, unknown>;
    return {
      grouping:
        typeof grouping === "string" && (folderGroupings as readonly string[]).includes(grouping)
          ? (grouping as FolderGrouping)
          : defaultFolderPreferences.grouping,
      folded: Array.isArray(folded)
        ? folded
            .filter((key): key is string => typeof key === "string" && key.length <= 80)
            .slice(0, maximumFolded)
        : [],
    };
  } catch {
    return defaultFolderPreferences;
  }
}

export function writeFolderPreferences(
  storage: Pick<Storage, "setItem"> | undefined,
  preferences: FolderPreferences,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(
      folderPreferencesKey,
      JSON.stringify({
        grouping: preferences.grouping,
        folded: preferences.folded.slice(0, maximumFolded),
      }),
    );
  } catch {
    // A blocked or full store costs the person the remembered choice, not the list.
  }
}

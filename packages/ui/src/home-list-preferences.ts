/**
 * The applications list's view and sort, remembered per device in `localStorage`. They are
 * display choices, so they never reach the host; search and status filter are not stored, so
 * Home never reopens on a list that looks empty.
 */
import { type ApplicationListView, isApplicationListView } from "./home-applications-view.js";
import { type ApplicationSortOrder, isApplicationSortOrder } from "./home-list-model.js";

export const applicationListPreferencesKey = "draft-loop.home.applications";

export interface ApplicationListPreferences {
  readonly view: ApplicationListView;
  readonly sort: ApplicationSortOrder;
}

export const defaultApplicationListPreferences: ApplicationListPreferences = {
  view: "cards",
  sort: "activity",
};

/** Reads the stored choices; a missing, blocked or malformed entry reads as the defaults. */
export function readApplicationListPreferences(
  storage: Pick<Storage, "getItem"> | undefined,
): ApplicationListPreferences {
  if (storage === undefined) return defaultApplicationListPreferences;
  try {
    const raw: unknown = JSON.parse(storage.getItem(applicationListPreferencesKey) ?? "null");
    if (typeof raw !== "object" || raw === null) return defaultApplicationListPreferences;
    const { view, sort } = raw as Record<string, unknown>;
    return {
      view: isApplicationListView(view) ? view : defaultApplicationListPreferences.view,
      sort: isApplicationSortOrder(sort) ? sort : defaultApplicationListPreferences.sort,
    };
  } catch {
    return defaultApplicationListPreferences;
  }
}

/** Stores the choices, ignoring quota and security failures. */
export function writeApplicationListPreferences(
  storage: Pick<Storage, "setItem"> | undefined,
  preferences: ApplicationListPreferences,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(
      applicationListPreferencesKey,
      JSON.stringify({ view: preferences.view, sort: preferences.sort }),
    );
  } catch {
    // A blocked or full store costs the person the remembered choice, not the list.
  }
}

export function browserPreferenceStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

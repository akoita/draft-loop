import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiClient, ApiSchemas } from "./api-client.js";

/** How the screens show themselves (#2788): Guided, the simple view or Show everything. */
export type DisplayPreference = ApiSchemas["MemberDisplayPreference"];
export type DisplayMode = NonNullable<DisplayPreference["mode"]>;

const displayModes: readonly DisplayMode[] = ["guided", "standard", "everything"];

/** What a person who never chose gets: the simple view, the guide not hidden. */
export const defaultDisplayPreference: DisplayPreference = Object.freeze({
  mode: null,
  guideHidden: false,
});

/** Where this browser keeps the display preference, before sign-in and in owner-token mode. */
export const displayPreferenceKey = "draft-loop.display-preference";

function isDisplayPreference(value: unknown): value is DisplayPreference {
  if (typeof value !== "object" || value === null) return false;
  const { mode, guideHidden } = value as Record<string, unknown>;
  return (
    (mode === null || displayModes.some((known) => known === mode)) &&
    typeof guideHidden === "boolean"
  );
}

/** The preference this browser saved, or null when it saved none or storage is refused. */
export function browserDisplayPreference(
  storage: () => Storage | undefined,
): DisplayPreference | null {
  try {
    const raw = storage()?.getItem(displayPreferenceKey) ?? null;
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return isDisplayPreference(value) ? { mode: value.mode, guideHidden: value.guideHidden } : null;
  } catch {
    return null;
  }
}

/** Saves the preference for the next visit; a browser that refuses storage keeps it for this one. */
export function saveBrowserDisplayPreference(
  storage: () => Storage | undefined,
  preference: DisplayPreference,
): void {
  try {
    storage()?.setItem(displayPreferenceKey, JSON.stringify(preference));
  } catch {
    // Private windows and blocked storage keep the choice in memory only.
  }
}

/** The member's saved preference, or null when it cannot be read. */
export async function readAccountDisplayPreference(
  client: ApiClient,
): Promise<DisplayPreference | null> {
  try {
    return await client.call("GET /v1/me/display-preference", {});
  } catch {
    return null;
  }
}

/** Saves the member's preference; a failed save keeps it in this browser, which saved it already. */
export async function saveAccountDisplayPreference(
  client: ApiClient,
  preference: DisplayPreference,
): Promise<void> {
  try {
    await client.call("PUT /v1/me/display-preference", { body: preference });
  } catch {
    // The browser keeps the choice; the next change tries the server again.
  }
}

/**
 * What the account should hold once its answer arrives (#2788): a choice made in this browser
 * before sign-in moves to an account that never chose; otherwise the account's own answer wins.
 */
export function accountDisplayPreferenceToSave(
  account: DisplayPreference,
  browser: DisplayPreference | null,
): DisplayPreference | undefined {
  const accountUnchosen = account.mode === null && !account.guideHidden;
  if (!accountUnchosen || browser === null) return undefined;
  return browser.mode === null && !browser.guideHidden ? undefined : browser;
}

export interface DisplayPreferenceState {
  readonly preference: DisplayPreference;
  readonly choose: (preference: DisplayPreference) => void;
}

/**
 * The display preference as the screens use it. Owner-token mode keeps it in this browser only;
 * sign-in mode starts from the browser, then follows the account and saves each change there.
 */
export function useDisplayPreference({
  client,
  mode,
  storage = () => globalThis.localStorage,
}: {
  readonly client: ApiClient;
  readonly mode: "owner" | "sign-in";
  readonly storage?: () => Storage | undefined;
}): DisplayPreferenceState {
  const [preference, setPreference] = useState<DisplayPreference>(
    () => browserDisplayPreference(storage) ?? defaultDisplayPreference,
  );
  // A choice made while the account's answer loads wins over that answer.
  const chosen = useRef(false);
  const storageRef = useRef(storage);
  storageRef.current = storage;
  useEffect(() => {
    if (mode !== "sign-in") return;
    let live = true;
    void readAccountDisplayPreference(client).then((account) => {
      if (!live || account === null || chosen.current) return;
      const browser = browserDisplayPreference(storageRef.current);
      const toSave = accountDisplayPreferenceToSave(account, browser);
      if (toSave !== undefined) {
        void saveAccountDisplayPreference(client, toSave);
        return;
      }
      setPreference(account);
      saveBrowserDisplayPreference(storageRef.current, account);
    });
    return () => {
      live = false;
    };
  }, [client, mode]);
  const choose = useCallback(
    (next: DisplayPreference) => {
      chosen.current = true;
      setPreference(next);
      saveBrowserDisplayPreference(storageRef.current, next);
      if (mode === "sign-in") void saveAccountDisplayPreference(client, next);
    },
    [client, mode],
  );
  return { preference, choose };
}

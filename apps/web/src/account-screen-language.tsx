import {
  type ScreenLanguage,
  ScreenLanguageChoiceListener,
  useScreenLocale,
} from "@draft-loop/ui/i18n";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import type { ApiClient } from "./api-client.js";
import { savedLanguage } from "./screen-language-choice.js";

/** The member's saved screen language, or null when they saved none or it cannot be read. */
export async function readAccountScreenLanguage(client: ApiClient): Promise<ScreenLanguage | null> {
  try {
    const { language } = await client.call("GET /v1/me/screen-language", {});
    return language ?? null;
  } catch {
    return null;
  }
}

/** Saves the member's choice; a failed save keeps it in this browser, which saved it already. */
export async function saveAccountScreenLanguage(
  client: ApiClient,
  language: ScreenLanguage,
): Promise<void> {
  try {
    await client.call("PUT /v1/me/screen-language", { body: { language } });
  } catch {
    // The browser keeps the choice; the next change tries the server again.
  }
}

/**
 * The language to switch the screens to once the saved one arrives: none when the member saved
 * none, the screens already show it, or the member chose another while it loaded.
 */
export function accountLanguageToApply(
  saved: ScreenLanguage | null,
  shown: string,
  chosenSinceSignIn: boolean,
): ScreenLanguage | undefined {
  return saved === null || chosenSinceSignIn || saved === shown ? undefined : saved;
}

/**
 * The language to save on the account at sign-in (#2773): the one chosen in this browser before
 * sign-in, such as on the sign-in page, when the account has none saved yet. A language only
 * guessed from the browser's settings is not saved.
 */
export function accountLanguageToSave(
  saved: ScreenLanguage | null,
  chosenInBrowser: ScreenLanguage | null,
): ScreenLanguage | undefined {
  return saved === null && chosenInBrowser !== null ? chosenInBrowser : undefined;
}

/**
 * A signed-in member's screen language follows them (#2373): after sign-in the screens switch to
 * the language saved on the server, and each later change is saved there too. A language chosen
 * before sign-in is saved there when the account has none.
 */
export function AccountScreenLanguage({
  client,
  chosenInBrowser = () => savedLanguage(() => globalThis.localStorage),
  children,
}: {
  readonly client: ApiClient;
  /** The language this browser saved from a choice, read once the account's answer arrives. */
  readonly chosenInBrowser?: () => ScreenLanguage | null;
  readonly children: ReactNode;
}) {
  const { locale, choose } = useScreenLocale();
  const current = useRef({ locale, choose });
  current.current = { locale, choose };
  // A choice made while the saved language loads wins over the saved one.
  const chosen = useRef(false);
  const browserChoice = useRef(chosenInBrowser);
  browserChoice.current = chosenInBrowser;
  useEffect(() => {
    let live = true;
    void readAccountScreenLanguage(client).then((saved) => {
      const { locale: shown, choose: apply } = current.current;
      if (!live) return;
      const language = accountLanguageToApply(saved, shown, chosen.current);
      if (language !== undefined) apply?.(language);
      const toSave = accountLanguageToSave(saved, browserChoice.current());
      if (toSave !== undefined) void saveAccountScreenLanguage(client, toSave);
    });
    return () => {
      live = false;
    };
  }, [client]);
  const save = useCallback(
    (language: ScreenLanguage) => {
      chosen.current = true;
      void saveAccountScreenLanguage(client, language);
    },
    [client],
  );
  return <ScreenLanguageChoiceListener onChoose={save}>{children}</ScreenLanguageChoiceListener>;
}

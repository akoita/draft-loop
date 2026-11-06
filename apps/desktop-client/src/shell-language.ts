import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isShellLanguage, type ShellLanguage } from "./shell-text.js";

export { screenLanguageChannels } from "./shell-language-contract.js";

export const screenLanguageFilename = "screen-language.json";

/** The screen language a person chose in a server's Workspace settings, kept for every server. */
export interface ScreenLanguageStore {
  read(): ShellLanguage | undefined;
  save(language: ShellLanguage): void;
}

export function createScreenLanguageStore(userDataDirectory: string): ScreenLanguageStore {
  const file = join(userDataDirectory, screenLanguageFilename);
  return {
    read() {
      try {
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        const language = (value as { language?: unknown } | null)?.language;
        return isShellLanguage(language) ? language : undefined;
      } catch {
        return undefined;
      }
    },
    save(language) {
      try {
        writeFileSync(file, `${JSON.stringify({ language })}\n`, "utf8");
      } catch {
        // The choice still applies until the app closes.
      }
    },
  };
}

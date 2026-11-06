import { describe, expect, it } from "vitest";

import {
  negotiateShellLanguage,
  type ShellText,
  shellLanguages,
  shellReason,
  shellText,
} from "./shell-text.js";

describe("the desktop shell's words", () => {
  it("follows the saved screen language, else the system's, else English", () => {
    expect(negotiateShellLanguage("fr", ["en-GB"])).toBe("fr");
    expect(negotiateShellLanguage(undefined, ["de-DE", "fr-BE"])).toBe("fr");
    expect(negotiateShellLanguage("pseudo", ["it"])).toBe("en");
  });

  it("has every word in every language, and French differs from English", () => {
    const keys = Object.keys(shellText.en) as (keyof ShellText)[];
    for (const language of shellLanguages) {
      expect(Object.keys(shellText[language]).sort()).toEqual([...keys].sort());
    }
    expect(shellText.fr.serverMenu).toBe("Serveur");
    expect(shellText.fr.cantReach("https://a.example")).toBe(
      "Impossible de joindre https://a.example.",
    );
  });

  it("writes the checks' English reasons in French, and keeps an unknown reason as it is", () => {
    expect(shellReason("The server cannot be reached.", "fr")).toBe("Le serveur est injoignable.");
    expect(shellReason("The server answered 503.", "fr")).toBe("Le serveur a répondu 503.");
    expect(shellReason("The page did not load (ERR_FAILED).", "fr")).toBe(
      "La page ne s’est pas chargée (ERR_FAILED).",
    );
    expect(shellReason("Something new.", "fr")).toBe("Something new.");
    expect(shellReason("The server cannot be reached.", "en")).toBe(
      "The server cannot be reached.",
    );
  });

  it("knows every reason the address rules and the server check give", async () => {
    const { parseServerAddress } = await import("./server-address.js");
    const reasons = [
      "",
      "ftp://x",
      "http://a.example",
      "https://u:p@a.example",
      "https://a.example/x",
    ]
      .map((input) => parseServerAddress(input))
      .flatMap((result) => (result.ok ? [] : [result.reason]));
    expect(reasons).toHaveLength(5);
    for (const reason of reasons) expect(shellText.fr.reasons[reason]).toBeDefined();
  });
});

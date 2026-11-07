import {
  type ScreenLanguage,
  ScreenLanguageChoiceListener,
  ScreensI18nProvider,
  useScreenLocale,
} from "@draft-loop/ui/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  accountLanguageToApply,
  readAccountScreenLanguage,
  saveAccountScreenLanguage,
} from "./account-screen-language.js";
import { type ApiClient, ApiRequestError } from "./api-client.js";

function fakeClient(answers: Record<string, () => unknown>): ApiClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    call: async (operation, input) => {
      calls.push({ operation, input });
      const answer = answers[operation];
      if (answer === undefined) throw new Error(`Unexpected ${operation}`);
      return answer() as never;
    },
  } as ApiClient & { calls: unknown[] };
}

describe("a member's screen language on the hosted service", () => {
  it("reads the saved language, and null when none is saved or it cannot be read", async () => {
    await expect(
      readAccountScreenLanguage(
        fakeClient({ "GET /v1/me/screen-language": () => ({ language: "fr" }) }),
      ),
    ).resolves.toBe("fr");
    await expect(
      readAccountScreenLanguage(
        fakeClient({ "GET /v1/me/screen-language": () => ({ language: null }) }),
      ),
    ).resolves.toBeNull();
    const refused = fakeClient({
      "GET /v1/me/screen-language": () => {
        throw new ApiRequestError(404, "not_found", "No such route.");
      },
    });
    await expect(readAccountScreenLanguage(refused)).resolves.toBeNull();
  });

  it("saves a change on the server, and keeps quiet when the save fails", async () => {
    const client = fakeClient({ "PUT /v1/me/screen-language": () => ({ language: "fr" }) });
    await saveAccountScreenLanguage(client, "fr");
    expect(client.calls).toEqual([
      { operation: "PUT /v1/me/screen-language", input: { body: { language: "fr" } } },
    ]);
    await expect(saveAccountScreenLanguage(fakeClient({}), "en")).resolves.toBeUndefined();
  });

  it("switches to the saved language unless the screens show it or the member chose since", () => {
    expect(accountLanguageToApply("fr", "en", false)).toBe("fr");
    expect(accountLanguageToApply("fr", "fr", false)).toBeUndefined();
    expect(accountLanguageToApply("fr", "en", true)).toBeUndefined();
    expect(accountLanguageToApply(null, "en", false)).toBeUndefined();
  });

  it("passes each choice in the screens to the browser and to the server", () => {
    const browser: ScreenLanguage[] = [];
    const server: ScreenLanguage[] = [];
    let choose: ((language: ScreenLanguage) => void) | undefined;
    renderToStaticMarkup(
      <ScreensI18nProvider locale="en" onChoose={(language) => browser.push(language)}>
        <ScreenLanguageChoiceListener onChoose={(language) => server.push(language)}>
          <ChooseProbe onChoose={(next) => (choose = next)} />
        </ScreenLanguageChoiceListener>
      </ScreensI18nProvider>,
    );
    choose?.("fr");
    expect(browser).toEqual(["fr"]);
    expect(server).toEqual(["fr"]);
  });
});

/** Hands the screens' language picker to the test. */
function ChooseProbe({
  onChoose,
}: {
  onChoose: (choose: ((language: ScreenLanguage) => void) | undefined) => void;
}) {
  onChoose(useScreenLocale().choose);
  return null;
}

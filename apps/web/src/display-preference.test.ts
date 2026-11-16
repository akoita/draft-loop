import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import {
  accountDisplayPreferenceToSave,
  browserDisplayPreference,
  displayPreferenceKey,
  readAccountDisplayPreference,
  saveAccountDisplayPreference,
  saveBrowserDisplayPreference,
} from "./display-preference.js";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()].at(index) ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

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

describe("the display preference in this browser", () => {
  it("reads back what it saved, and null for nothing, junk or refused storage", () => {
    const storage = memoryStorage();
    expect(browserDisplayPreference(() => storage)).toBeNull();
    saveBrowserDisplayPreference(() => storage, { mode: "everything", guideHidden: false });
    expect(browserDisplayPreference(() => storage)).toEqual({
      mode: "everything",
      guideHidden: false,
    });
    storage.setItem(displayPreferenceKey, '{"mode":"expert","guideHidden":false}');
    expect(browserDisplayPreference(() => storage)).toBeNull();
    storage.setItem(displayPreferenceKey, "not json");
    expect(browserDisplayPreference(() => storage)).toBeNull();
    const refused = () => {
      throw new Error("blocked");
    };
    expect(browserDisplayPreference(refused)).toBeNull();
    expect(() =>
      saveBrowserDisplayPreference(refused, { mode: null, guideHidden: true }),
    ).not.toThrow();
  });
});

describe("the display preference on the account", () => {
  it("reads the saved preference, and null when it cannot be read", async () => {
    await expect(
      readAccountDisplayPreference(
        fakeClient({
          "GET /v1/me/display-preference": () => ({ mode: "guided", guideHidden: false }),
        }),
      ),
    ).resolves.toEqual({ mode: "guided", guideHidden: false });
    await expect(readAccountDisplayPreference(fakeClient({}))).resolves.toBeNull();
  });

  it("saves a change and swallows a failed save", async () => {
    const client = fakeClient({ "PUT /v1/me/display-preference": () => ({}) });
    await saveAccountDisplayPreference(client, { mode: "standard", guideHidden: true });
    expect(client.calls).toEqual([
      {
        operation: "PUT /v1/me/display-preference",
        input: { body: { mode: "standard", guideHidden: true } },
      },
    ]);
    await expect(
      saveAccountDisplayPreference(fakeClient({}), { mode: null, guideHidden: false }),
    ).resolves.toBeUndefined();
  });

  it("moves a choice made before sign-in to an account that never chose", () => {
    const unchosen = { mode: null, guideHidden: false };
    const guided = { mode: "guided" as const, guideHidden: false };
    expect(accountDisplayPreferenceToSave(unchosen, guided)).toEqual(guided);
    expect(accountDisplayPreferenceToSave(unchosen, null)).toBeUndefined();
    expect(accountDisplayPreferenceToSave(unchosen, unchosen)).toBeUndefined();
    expect(
      accountDisplayPreferenceToSave({ mode: "everything", guideHidden: false }, guided),
    ).toBeUndefined();
    expect(
      accountDisplayPreferenceToSave({ mode: null, guideHidden: true }, guided),
    ).toBeUndefined();
  });
});

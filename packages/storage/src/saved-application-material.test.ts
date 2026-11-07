import type { SavedApplicationMaterial } from "@draft-loop/schemas/saved-application-material";
import { describe, expect, it } from "vitest";

import {
  createMemorySavedApplicationMaterialStore,
  requireSavedApplicationMaterial,
} from "./saved-application-material.js";

// Invented paragraphs and facts only.
function draft(
  id: string,
  overrides: Partial<SavedApplicationMaterial> = {},
): SavedApplicationMaterial {
  return requireSavedApplicationMaterial({
    id,
    workspace_id: "owner",
    application_id: "application-1",
    kind: "cover-letter",
    items: [
      {
        question: "",
        text: "I led the fictional migration of a ledger service.",
        citations: [{ fact_id: "fact-1", text: "experience outcome: Fictional migration" }],
      },
    ],
    model: { provider: "anthropic", model: "claude-sonnet-5-5" },
    prompt_version: "application-material-v4",
    cost_usd: 0.04,
    created_at: "2026-11-07T09:00:00.000Z",
    ...overrides,
  });
}

describe("saved application material in memory", () => {
  it("keeps each version, lists an application's newest first and deletes one", async () => {
    const store = createMemorySavedApplicationMaterialStore();
    const first = draft("amd_fixture0001");
    await store.insert(first);
    await expect(store.insert(first)).rejects.toMatchObject({ code: "duplicate_material" });
    await store.insert(draft("amd_fixture0002", { created_at: "2026-11-07T10:00:00.000Z" }));
    await store.insert(
      draft("amd_fixture0003", {
        kind: "interview-questions",
        items: [{ question: "Why this role?", text: "Fictional answer.", citations: [] }],
      }),
    );
    await store.insert(draft("amd_fixture0004", { application_id: "application-2" }));

    expect(await store.get("owner", first.id)).toEqual(first);
    expect(await store.get("other", first.id)).toBeUndefined();
    const ids = async (kind?: SavedApplicationMaterial["kind"], limit?: number) =>
      (
        await store.list("owner", "application-1", {
          ...(kind ? { kind } : {}),
          ...(limit ? { limit } : {}),
        })
      ).map((entry) => entry.id);
    expect(await ids()).toEqual(["amd_fixture0002", "amd_fixture0003", "amd_fixture0001"]);
    expect(await ids("cover-letter")).toEqual(["amd_fixture0002", "amd_fixture0001"]);
    expect(await ids(undefined, 1)).toEqual(["amd_fixture0002"]);
    expect(await store.list("other", "application-1")).toEqual([]);

    expect(await store.delete("other", first.id)).toBe(false);
    expect(await store.delete("owner", first.id)).toBe(true);
    expect(await store.delete("owner", first.id)).toBe(false);
    expect(await ids("cover-letter")).toEqual(["amd_fixture0002"]);
  });

  it("refuses a draft that breaks the schema", async () => {
    const store = createMemorySavedApplicationMaterialStore();
    await expect(store.insert({ ...draft("amd_fixture0005"), items: [] })).rejects.toMatchObject({
      code: "invalid_material",
    });
    expect(() => requireSavedApplicationMaterial({ id: "cis_wrongprefix" })).toThrow(
      "The saved application material is invalid.",
    );
  });
});

import {
  type FactSuggestion,
  type FactSuggestionChange,
  factSuggestionDedupeKey,
  factSuggestionTarget,
} from "@draft-loop/domain/fact-suggestion";
import { expect } from "vitest";

import type { FactSuggestionStore } from "./fact-suggestions.js";

// Fictional facts and quotes only.
const target = factSuggestionTarget({
  id: "fact-1",
  category: "achievement",
  field: "team size",
  value: "Led a team of 5",
  provenance: [],
});

/** A pending suggestion of profile `profile-1`; `value` varies its change and dedupe key. */
export function fixtureFactSuggestion(
  id: string,
  value: string,
  overrides: Partial<FactSuggestion> = {},
): FactSuggestion {
  const change: FactSuggestionChange = { kind: "correct", value };
  return {
    schemaVersion: 1,
    id,
    profileId: "profile-1",
    baseVersionId: "version-1",
    change,
    target,
    quote: `I said ${value}.`,
    speaker: "candidate",
    origin: { kind: "review-edit", applicationId: "app-1", runId: "run-1", round: 1 },
    dedupeKey: factSuggestionDedupeKey(change, target),
    status: "pending",
    createdAt: "2026-11-19T09:00:00.000Z",
    ...overrides,
  };
}

const decision = {
  role: "candidate",
  memberId: "member-1",
  decidedAt: "2026-11-19T10:00:00Z",
} as const;

/**
 * What every fact suggestion store must do; the in-memory and Postgres tests both run it. `other`
 * is a second tenant's store where the implementation has tenants.
 */
export async function expectFactSuggestionStore(
  store: FactSuggestionStore,
  other?: FactSuggestionStore,
): Promise<void> {
  const first = fixtureFactSuggestion("fsg_fixture0001", "Led a team of 8");
  const second = fixtureFactSuggestion("fsg_fixture0002", "Led a team of 9", {
    createdAt: "2026-11-19T09:05:00.000Z",
  });
  const otherProfile = fixtureFactSuggestion("fsg_fixture0003", "Led a team of 8", {
    profileId: "profile-2",
    createdAt: "2026-11-19T09:10:00.000Z",
  });

  expect(await store.list("owner", { limit: 10 })).toEqual([]);
  expect(await store.countPending("owner")).toBe(0);

  await store.insert("owner", first);
  await store.insert("owner", second);
  // The same change on another profile is a separate suggestion.
  await store.insert("owner", otherProfile);
  expect(await store.get("owner", first.id)).toEqual(first);
  expect(await store.get("someone-else", first.id)).toBeUndefined();
  if (other !== undefined) expect(await other.get("owner", first.id)).toBeUndefined();

  // A taken id or a held key is refused; a new suggestion must be pending.
  await expect(store.insert("owner", first)).rejects.toMatchObject({
    code: "duplicate_suggestion",
  });
  await expect(store.insert("owner", { ...first, id: "fsg_fixture0004" })).rejects.toMatchObject({
    code: "duplicate_suggestion",
  });
  await expect(
    store.insert("owner", {
      ...fixtureFactSuggestion("fsg_fixture0005", "Led a team of 10"),
      status: "accepted",
      decision,
    }),
  ).rejects.toMatchObject({ code: "invalid_suggestion" });

  expect((await store.list("owner", { limit: 10 })).map((s) => s.id)).toEqual([
    otherProfile.id,
    second.id,
    first.id,
  ]);
  expect(
    (await store.list("owner", { profileId: "profile-1", limit: 1 })).map((s) => s.id),
  ).toEqual([second.id]);
  expect(await store.countPending("owner")).toBe(3);
  expect(await store.countPending("owner", "profile-1")).toBe(2);

  // A decision keeps every filed field and records only the outcome.
  await store.decide("owner", {
    ...first,
    quote: "A different quote.",
    createdAt: "2030-01-01T00:00:00.000Z",
    status: "rejected",
    decision,
  });
  const rejected = await store.get("owner", first.id);
  expect(rejected).toEqual({ ...first, status: "rejected", decision });
  await expect(
    store.decide("owner", { ...first, status: "accepted", decision }),
  ).rejects.toMatchObject({ code: "suggestion_conflict" });
  await expect(
    store.decide("someone-else", { ...second, status: "accepted", decision }),
  ).rejects.toMatchObject({ code: "suggestion_not_found" });

  // A rejected suggestion still holds its key, so the same change is not filed again.
  expect(await store.holderOfKey("owner", "profile-1", first.dedupeKey)).toEqual(rejected);
  await expect(store.insert("owner", { ...first, id: "fsg_fixture0006" })).rejects.toMatchObject({
    code: "duplicate_suggestion",
  });

  // An edit records the applied change; a stale suggestion frees its key.
  const applied: FactSuggestionChange = { kind: "correct", value: "Led a team of 7" };
  await store.decide("owner", { ...second, status: "edited", decision, appliedChange: applied });
  expect(await store.get("owner", second.id)).toEqual({
    ...second,
    status: "edited",
    decision,
    appliedChange: applied,
  });
  await store.decide("owner", { ...otherProfile, status: "stale" });
  expect(await store.holderOfKey("owner", "profile-2", otherProfile.dedupeKey)).toBeUndefined();
  await store.insert("owner", { ...otherProfile, id: "fsg_fixture0007" });
  expect(await store.countPending("owner")).toBe(1);
  expect((await store.list("owner", { status: "stale", limit: 10 })).map((s) => s.id)).toEqual([
    otherProfile.id,
  ]);

  // A stored suggestion is checked before it is written.
  await expect(
    store.insert("owner", { ...fixtureFactSuggestion("fsg_fixture0008", "x"), dedupeKey: "bad" }),
  ).rejects.toMatchObject({ code: "invalid_suggestion" });
}

import { expect } from "vitest";

import type { AgentConnectionCapStore } from "./agent-connection-caps.js";

/**
 * What every connection cap store must do; the in-memory and Postgres tests both run it. `other`
 * is a second tenant's store where the implementation has tenants.
 */
export async function expectAgentConnectionCapStore(
  store: AgentConnectionCapStore,
  other?: AgentConnectionCapStore,
): Promise<void> {
  const at = "2026-11-11T08:00:00.000Z";
  const assistant = { workspaceId: "owner", clientId: "assistant-a" };
  const reservation = { ...assistant, month: "2026-11", key: "run:key-1", cents: 300 };

  expect(await store.get("owner", "assistant-a")).toBeUndefined();
  expect(await store.reserveSpend(reservation)).toEqual({ outcome: "no_cap" });

  expect(await store.set({ ...assistant, monthlyCapCents: 500, updatedAt: at })).toEqual({
    ...assistant,
    monthlyCapCents: 500,
    updatedAt: at,
  });
  await store.set({
    workspaceId: "owner",
    clientId: "assistant-b",
    monthlyCapCents: 100,
    updatedAt: at,
  });
  await store.set({
    workspaceId: "second",
    clientId: "assistant-a",
    monthlyCapCents: 900,
    updatedAt: at,
  });
  expect((await store.list("owner")).map((cap) => cap.clientId)).toEqual([
    "assistant-a",
    "assistant-b",
  ]);
  if (other !== undefined) {
    expect(await other.get("owner", "assistant-a")).toBeUndefined();
    expect(await other.list("owner")).toEqual([]);
    expect(await other.reserveSpend(reservation)).toEqual({ outcome: "no_cap" });
  }

  // Once per key, never past the cap, and a release gives the cents back.
  expect(await store.reserveSpend(reservation)).toEqual({ outcome: "reserved", spentCents: 300 });
  expect(await store.reserveSpend(reservation)).toEqual({ outcome: "replayed", spentCents: 300 });
  expect(await store.reserveSpend({ ...reservation, key: "run:key-2" })).toEqual({
    outcome: "cap_reached",
    spentCents: 300,
    capCents: 500,
  });
  expect(await store.reserveSpend({ ...reservation, key: "draft:key-3", cents: 200 })).toEqual({
    outcome: "reserved",
    spentCents: 500,
  });
  await store.releaseSpend({ ...reservation, key: "draft:key-3", cents: 200 });
  await store.releaseSpend({ ...reservation, key: "never-reserved" });
  expect((await store.get("owner", "assistant-a"))?.spend).toEqual({
    month: "2026-11",
    cents: 300,
  });

  // A new cap keeps this month's spend; a new month starts from nothing.
  const later = "2026-11-12T08:00:00.000Z";
  expect(await store.set({ ...assistant, monthlyCapCents: 350, updatedAt: later })).toEqual({
    ...assistant,
    monthlyCapCents: 350,
    updatedAt: later,
    spend: { month: "2026-11", cents: 300 },
  });
  expect((await store.reserveSpend({ ...reservation, key: "run:key-4", cents: 100 })).outcome).toBe(
    "cap_reached",
  );
  expect(await store.reserveSpend({ ...reservation, month: "2026-12" })).toEqual({
    outcome: "reserved",
    spentCents: 300,
  });
  // The same key counts again in a new month, and other connections are untouched.
  expect((await store.get("second", "assistant-a"))?.spend).toBeUndefined();

  for (const invalid of [
    { ...assistant, monthlyCapCents: 0, updatedAt: at },
    { ...assistant, monthlyCapCents: 50_001, updatedAt: at },
    { ...assistant, monthlyCapCents: 1.5, updatedAt: at },
    { workspaceId: "owner", clientId: "has space", monthlyCapCents: 100, updatedAt: at },
    { workspaceId: "", clientId: "assistant-a", monthlyCapCents: 100, updatedAt: at },
  ]) {
    await expect(store.set(invalid)).rejects.toMatchObject({ code: "invalid_cap" });
  }

  expect(await store.remove("owner", "assistant-a")).toBe(true);
  expect(await store.remove("owner", "assistant-a")).toBe(false);
  expect(await store.reserveSpend({ ...reservation, key: "run:key-5" })).toEqual({
    outcome: "no_cap",
  });
  // Setting it again starts with no spend: removal erased it.
  expect(
    (await store.set({ ...assistant, monthlyCapCents: 500, updatedAt: later })).spend,
  ).toBeUndefined();
}

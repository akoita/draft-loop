import { describe, expect, it } from "vitest";

import {
  type AgentTokenStore,
  createMemoryAgentTokenStore,
  isAgentTokenActive,
  legacyAgentTokenExpiry,
} from "./agent-tokens.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

/** The store contract; the Postgres store's test checks the same. */
async function expectAgentTokenContract(store: AgentTokenStore): Promise<void> {
  await store.insert({
    id: "dlat_fixture0001",
    workspaceId: "owner",
    label: " Claude Code ",
    createdAt: "2026-11-04T10:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    secretHash: hashA,
  });
  await store.insert({
    id: "dlat_fixture0002",
    workspaceId: "owner",
    label: "Codex",
    createdAt: "2026-11-04T11:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    secretHash: hashB,
  });
  await expect(
    store.insert({
      id: "dlat_fixture0003",
      workspaceId: "owner",
      label: "Copy",
      createdAt: "2026-11-04T12:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      secretHash: hashA,
    }),
  ).rejects.toMatchObject({ code: "duplicate_token" });
  await expect(
    store.insert({
      id: "not-a-token",
      workspaceId: "owner",
      label: "Bad",
      createdAt: "2026-11-04T12:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      secretHash: "c".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "invalid_token" });

  const found = await store.findByHash(hashA);
  expect(found).toEqual({
    id: "dlat_fixture0001",
    workspaceId: "owner",
    label: "Claude Code",
    createdAt: "2026-11-04T10:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
  });
  expect(found).not.toHaveProperty("secretHash");
  expect(await store.findByHash("d".repeat(64))).toBeUndefined();

  expect((await store.list("owner")).map((token) => token.id)).toEqual([
    "dlat_fixture0002",
    "dlat_fixture0001",
  ]);
  expect(await store.list("other")).toEqual([]);

  expect(await store.revoke("other", "dlat_fixture0001", "2026-11-04T13:00:00.000Z")).toBe(false);
  expect(await store.revoke("owner", "dlat_fixture0001", "2026-11-04T13:00:00.000Z")).toBe(true);
  expect(await store.revoke("owner", "dlat_fixture0001", "2026-11-04T14:00:00.000Z")).toBe(false);
  expect(await store.findByHash(hashA)).toMatchObject({ revokedAt: "2026-11-04T13:00:00.000Z" });
}

describe("in-memory agent tokens", () => {
  it("keeps the store contract", async () => {
    await expectAgentTokenContract(createMemoryAgentTokenStore());
  });
});

describe("agent token expiry", () => {
  const base = {
    id: "dlat_fixture0009",
    workspaceId: "owner",
    label: "Claude Code",
    createdAt: "2026-11-04T10:00:00.000Z",
    secretHash: "e".repeat(64),
  };

  it("refuses a token that expires before it is issued or more than a year later", async () => {
    const store = createMemoryAgentTokenStore();
    for (const expiresAt of ["2026-11-04T10:00:00.000Z", "2027-11-05T10:00:00.000Z", "never"]) {
      await expect(store.insert({ ...base, expiresAt }), expiresAt).rejects.toMatchObject({
        code: "invalid_token",
      });
    }
    await store.insert({ ...base, expiresAt: "2027-11-04T10:00:00.000Z" });
  });

  it("counts a token active until its expiry and never once revoked", () => {
    const token = { ...base, expiresAt: "2026-12-04T10:00:00.000Z" };
    expect(isAgentTokenActive(token, new Date("2026-12-04T09:59:59.999Z"))).toBe(true);
    expect(isAgentTokenActive(token, new Date("2026-12-04T10:00:00.000Z"))).toBe(false);
    expect(
      isAgentTokenActive(
        { ...token, revokedAt: "2026-11-05T00:00:00.000Z" },
        new Date(base.createdAt),
      ),
    ).toBe(false);
  });

  it("gives a token stored before expiry existed the default lifetime", () => {
    expect(legacyAgentTokenExpiry("2026-11-04T10:00:00.000Z")).toBe("2027-02-02T10:00:00.000Z");
  });
});

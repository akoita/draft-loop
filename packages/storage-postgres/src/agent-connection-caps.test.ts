import { expectAgentConnectionCapStore } from "@draft-loop/storage/agent-connection-caps-conformance";
import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("Postgres connection caps", () => {
  const url = connectionString ?? "";

  it("meets the store's conformance suite, per tenant", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "agent_connection_caps");
    const tenancy = await openTenancy();
    try {
      await expectAgentConnectionCapStore(
        tenancy.forTenant("tenant-a").agentConnectionCaps,
        tenancy.forTenant("tenant-b").agentConnectionCaps,
      );
    } finally {
      await tenancy.close();
      await drop();
    }
  });

  it("lets only one of two concurrent starts take the last cents", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "agent_connection_caps_race");
    const tenancy = await openTenancy();
    try {
      const store = tenancy.forTenant("tenant-a").agentConnectionCaps;
      const assistant = { workspaceId: "owner", clientId: "assistant-a" };
      await store.set({
        ...assistant,
        monthlyCapCents: 300,
        updatedAt: "2026-11-11T08:00:00.000Z",
      });

      const outcomes = await Promise.all(
        ["run:a", "run:b"].map((key) =>
          store.reserveSpend({ ...assistant, month: "2026-11", key, cents: 300 }),
        ),
      );

      expect(outcomes.map((outcome) => outcome.outcome).sort()).toEqual([
        "cap_reached",
        "reserved",
      ]);
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});

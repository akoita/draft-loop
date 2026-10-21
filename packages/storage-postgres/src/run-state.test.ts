import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("Postgres run state", () => {
  const url = connectionString ?? "";

  it("keeps the latest value of each key to its tenant", async () => {
    const { open, drop } = await createTestSchema(url, "run_state");
    const tenantA = await open("tenant-a");
    const tenantB = await open("tenant-b");
    try {
      await tenantA.set("run:run-1", '{"state":"drafting"}');
      await tenantA.set("run:run-1", '{"state":"reviewing"}');
      await tenantB.set("run:run-1", '{"state":"collecting"}');

      await expect(tenantA.get("run:run-1")).resolves.toBe('{"state":"reviewing"}');
      await expect(tenantB.get("run:run-1")).resolves.toBe('{"state":"collecting"}');
      await expect(tenantA.get("run:run-2")).resolves.toBeUndefined();
    } finally {
      await tenantA.close();
      await tenantB.close();
      await drop();
    }
  });

  it("refuses credential-like keys and values it cannot store faithfully", async () => {
    const { open, drop } = await createTestSchema(url, "run_state");
    const storage = await open("tenant-a");
    try {
      await expect(storage.set("provider-api-key", "value")).rejects.toBeInstanceOf(
        StorageSecurityError,
      );
      await expect(storage.set("run:run-1", "a\u0000b")).rejects.toBeInstanceOf(
        StorageValidationError,
      );
      await expect(storage.get("")).rejects.toThrow();
    } finally {
      await storage.close();
      await drop();
    }
  });
});

import { expectRunSpanStore } from "@draft-loop/storage/run-spans-conformance";
import { describe, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("Postgres run spans", () => {
  const url = connectionString ?? "";

  it("meets the store's conformance suite, per tenant", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "run_spans");
    const tenancy = await openTenancy();
    try {
      await expectRunSpanStore(
        tenancy.forTenant("tenant-a").runSpans,
        tenancy.forTenant("tenant-b").runSpans,
      );
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});

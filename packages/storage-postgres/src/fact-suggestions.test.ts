import {
  expectFactSuggestionStore,
  fixtureFactSuggestion,
} from "@draft-loop/storage/fact-suggestions-conformance";
import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("Postgres fact suggestions", () => {
  const url = connectionString ?? "";

  it("keeps the store contract per tenant and survives a reopened pool", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "fact_suggestions");
    let tenancy = await openTenancy();
    try {
      await expectFactSuggestionStore(
        tenancy.forTenant("tenant-a").factSuggestions,
        tenancy.forTenant("tenant-b").factSuggestions,
      );
      await tenancy.close();
      tenancy = await openTenancy();
      const reopened = tenancy.forTenant("tenant-a").factSuggestions;
      expect(await reopened.get("owner", "fsg_fixture0001")).toMatchObject({ status: "rejected" });
      // Another tenant may file the same suggestion id and key.
      await tenancy
        .forTenant("tenant-b")
        .factSuggestions.insert(
          "owner",
          fixtureFactSuggestion("fsg_fixture0001", "Led a team of 8"),
        );
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});

import { describe, it } from "vitest";

import { createMemoryFactSuggestionStore } from "./fact-suggestions.js";
import { expectFactSuggestionStore } from "./fact-suggestions-conformance.js";

describe("in-memory fact suggestion store", () => {
  it("keeps the store contract", async () => {
    await expectFactSuggestionStore(createMemoryFactSuggestionStore());
  });
});

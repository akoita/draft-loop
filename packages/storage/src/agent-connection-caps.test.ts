import { describe, it } from "vitest";

import { createMemoryAgentConnectionCapStore } from "./agent-connection-caps.js";
import { expectAgentConnectionCapStore } from "./agent-connection-caps-conformance.js";

describe("the in-memory connection cap store", () => {
  it("sets, lists and removes caps and reserves spend once per key within the cap", async () => {
    await expectAgentConnectionCapStore(createMemoryAgentConnectionCapStore());
  });
});

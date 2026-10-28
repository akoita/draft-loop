import type { ContextSnapshot } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { runRequirementTexts } from "./run-context-read.js";

const requirements = [
  { id: "req-1", text: "TypeScript", priority: "critical" },
  { id: "resp-1", text: "Own the ingestion pipeline", priority: "medium" },
] as unknown as ContextSnapshot["requirements"];

describe("runRequirementTexts", () => {
  it("tells a reviewed brief's requirements from its responsibilities", () => {
    expect(runRequirementTexts({ requirements, scoredRequirementIds: ["req-1"] })).toEqual([
      { id: "req-1", text: "TypeScript", kind: "requirement" },
      { id: "resp-1", text: "Own the ingestion pipeline", kind: "responsibility" },
    ]);
  });

  it("records no kind for a run without a reviewed brief", () => {
    expect(runRequirementTexts({ requirements })).toEqual([
      { id: "req-1", text: "TypeScript" },
      { id: "resp-1", text: "Own the ingestion pipeline" },
    ]);
  });
});

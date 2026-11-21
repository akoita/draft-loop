import { describe, expect, it } from "vitest";

import { VertexLocationError, vertexBaseUrl } from "./vertex-location.js";
import {
  vertexClaudeLocation,
  vertexClaudeModelIds,
  vertexLocationServes,
} from "./vertex-models.js";

describe("vertexClaudeLocation", () => {
  it("accepts the eu multi-region, which serves every listed model", () => {
    expect(vertexClaudeLocation("eu")).toBe("eu");
    for (const id of vertexClaudeModelIds) expect(vertexLocationServes("eu", id)).toBe(true);
  });

  it.each(["europe-west1", "europe-west4", "europe-southwest1"])(
    "refuses the region %s and names the eu multi-region instead",
    (location) => {
      expect(() => vertexClaudeLocation(location)).toThrow(VertexLocationError);
      expect(() => vertexClaudeLocation(location)).toThrow(/Use the eu multi-region/u);
    },
  );

  it("says a region serves none of the current Claude models", () => {
    for (const id of vertexClaudeModelIds) {
      expect(vertexLocationServes("europe-west1", id)).toBe(false);
    }
  });

  it.each(["global", "us", "us-east5", ""])("still refuses %j, outside the EU", (location) => {
    expect(() => vertexClaudeLocation(location)).toThrow(/eu multi-region or a europe-\* region/u);
  });
});

describe("vertexBaseUrl", () => {
  it("names each location's own endpoint", () => {
    expect(vertexBaseUrl("eu")).toBe("https://aiplatform.eu.rep.googleapis.com/v1");
    expect(vertexBaseUrl("europe-west1")).toBe("https://europe-west1-aiplatform.googleapis.com/v1");
  });
});

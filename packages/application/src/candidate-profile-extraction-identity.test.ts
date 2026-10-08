import { describe, expect, it } from "vitest";

import {
  canonicalProfileExtractionIdentity,
  canonicalProfileExtractionModel,
} from "./candidate-profile-extraction-identity.js";
import { promptVersion } from "./canonical-profile-provider-request.js";

describe("canonical profile extraction identity", () => {
  it("records company, model, and prompt for a route without an extraction profile", () => {
    const model = canonicalProfileExtractionModel("anthropic", "synthetic-model");

    expect(model).toMatchObject({ role: "author", promptTemplateVersion: promptVersion });
    expect(canonicalProfileExtractionIdentity(model)).toEqual({
      company: "anthropic",
      modelId: "synthetic-model",
      promptTemplateVersion: promptVersion,
    });
  });

  it("adds the extraction profile id and version when the route has one", async () => {
    const { mistralCompany, mistralLarge4ModelId } = await import(
      "@draft-loop/providers/model-identities"
    );
    const identity = canonicalProfileExtractionIdentity(
      canonicalProfileExtractionModel(mistralCompany, mistralLarge4ModelId),
    );

    expect(identity).toMatchObject({
      company: mistralCompany,
      modelId: mistralLarge4ModelId,
      promptTemplateVersion: promptVersion,
    });
    expect(identity.extractionProfile).toEqual({
      id: expect.any(String),
      version: expect.any(Number),
    });
  });
});

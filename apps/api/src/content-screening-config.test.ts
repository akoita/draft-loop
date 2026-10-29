import { describe, expect, it } from "vitest";

import { ApiConfigError } from "./config.js";
import { readScreeningConfig } from "./content-screening-config.js";

const vertex = {
  DRAFT_LOOP_VERTEX_PROJECT_ID: "example-proj",
  DRAFT_LOOP_VERTEX_LOCATION: "europe-west1",
  DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
};

describe("readScreeningConfig", () => {
  it("defaults to the rule screener, with provider data off", () => {
    expect(readScreeningConfig({})).toEqual({ mode: "rules", allowProviderData: false });
    expect(readScreeningConfig({ DRAFT_LOOP_SCREENING: "" })).toEqual({
      mode: "rules",
      allowProviderData: false,
    });
  });

  it.each(["off", "rules"] as const)("reads %s without any model settings", (mode) => {
    expect(readScreeningConfig({ DRAFT_LOOP_SCREENING: mode })).toEqual({
      mode,
      allowProviderData: false,
    });
  });

  it("reads rules+model with its EU Vertex route", () => {
    expect(readScreeningConfig({ DRAFT_LOOP_SCREENING: "rules+model", ...vertex })).toEqual({
      mode: "rules+model",
      allowProviderData: false,
      model: {
        vertexProjectId: "example-proj",
        vertexLocation: "europe-west1",
        vertexPriceFactor: 1.1,
      },
    });
  });

  it("defaults the Vertex location to the eu multi-region", () => {
    const { DRAFT_LOOP_VERTEX_LOCATION: _location, ...withoutLocation } = vertex;
    expect(
      readScreeningConfig({ DRAFT_LOOP_SCREENING: "rules+model", ...withoutLocation }).model
        ?.vertexLocation,
    ).toBe("eu");
  });

  it("reads the deployment's provider data ceiling", () => {
    expect(readScreeningConfig({ DRAFT_LOOP_ALLOW_PROVIDER_DATA: "true" }).allowProviderData).toBe(
      true,
    );
    expect(() => readScreeningConfig({ DRAFT_LOOP_ALLOW_PROVIDER_DATA: "yes" })).toThrow(
      ApiConfigError,
    );
  });

  it("reads rules+model on the direct Claude API route of a self-hosted stack", () => {
    expect(
      readScreeningConfig({
        DRAFT_LOOP_SCREENING: "rules+model",
        DRAFT_LOOP_MODEL_ROUTES: "direct",
      }),
    ).toEqual({
      mode: "rules+model",
      allowProviderData: false,
      direct: { secretsDirectory: "/run/secrets" },
    });
    expect(
      readScreeningConfig({
        DRAFT_LOOP_SCREENING: "rules+model",
        DRAFT_LOOP_MODEL_ROUTES: "direct",
        DRAFT_LOOP_SECRETS_DIR: "/srv/keys",
      }).direct,
    ).toEqual({ secretsDirectory: "/srv/keys" });
    // Rules alone read no route at all.
    expect(
      readScreeningConfig({ DRAFT_LOOP_SCREENING: "rules", DRAFT_LOOP_MODEL_ROUTES: "direct" }),
    ).toEqual({ mode: "rules", allowProviderData: false });
  });

  it.each([
    ["a Vertex project", { DRAFT_LOOP_VERTEX_PROJECT_ID: "example-proj" }],
    ["a relative key directory", { DRAFT_LOOP_SECRETS_DIR: "keys" }],
  ])("refuses rules+model on the direct route with %s", (_label, env) => {
    expect(() =>
      readScreeningConfig({
        DRAFT_LOOP_SCREENING: "rules+model",
        DRAFT_LOOP_MODEL_ROUTES: "direct",
        ...env,
      }),
    ).toThrow(ApiConfigError);
  });

  it.each(["rules+models", "model", "on", "RULES", "true"])(
    "refuses the unknown mode %j instead of falling back",
    (mode) => {
      expect(() => readScreeningConfig({ DRAFT_LOOP_SCREENING: mode })).toThrow(ApiConfigError);
    },
  );

  it.each([
    ["no Vertex project", { ...vertex, DRAFT_LOOP_VERTEX_PROJECT_ID: "" }],
    ["a location outside the EU", { ...vertex, DRAFT_LOOP_VERTEX_LOCATION: "global" }],
    ["no price factor", { ...vertex, DRAFT_LOOP_VERTEX_PRICE_FACTOR: "" }],
    ["a price factor below one", { ...vertex, DRAFT_LOOP_VERTEX_PRICE_FACTOR: "0.5" }],
  ])("refuses rules+model with %s", (_label, env) => {
    expect(() => readScreeningConfig({ DRAFT_LOOP_SCREENING: "rules+model", ...env })).toThrow(
      ApiConfigError,
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { WorkerConfigError } from "./config-error.js";
import { readLocalModelEndpoint, withLocalModels } from "./local-models-config.js";

describe("readLocalModelEndpoint", () => {
  it("reads the operator's endpoint, which need not be loopback", () => {
    expect(readLocalModelEndpoint({})).toBeUndefined();
    expect(
      readLocalModelEndpoint({
        DRAFT_LOOP_LOCAL_MODEL_ENDPOINT: "http://host.docker.internal:11434/v1/",
      }),
    ).toBe("http://host.docker.internal:11434/v1");
  });

  it.each([
    ["not an address", "ollama"],
    ["another scheme", "ftp://models.lan/v1"],
    ["credentials", "http://user:secret@models.lan/v1"],
    ["a query", "http://models.lan/v1?key=1"],
  ])("refuses %s", (_label, value) => {
    expect(() => readLocalModelEndpoint({ DRAFT_LOOP_LOCAL_MODEL_ENDPOINT: value })).toThrow(
      WorkerConfigError,
    );
  });
});

describe("withLocalModels", () => {
  it("sends every local model to the deployment's endpoint, never the workspace's", () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const options = withLocalModels(
      { resolveCredential: async () => undefined },
      "http://host.docker.internal:11434/v1",
      fetchImpl,
    );

    expect(options.providerClientFactories?.local?.("http://127.0.0.1:9999/v1")).toEqual({
      endpoint: "http://host.docker.internal:11434/v1",
      fetch: fetchImpl,
    });
  });

  it("keeps the routes' other clients and refuses a local call without an endpoint", () => {
    const openai = vi.fn();
    const options = withLocalModels(
      { resolveCredential: async () => undefined, providerClientFactories: { openai } },
      undefined,
    );

    expect(options.providerClientFactories?.openai).toBe(openai);
    expect(() => options.providerClientFactories?.local?.(undefined)).toThrow(
      "This deployment has no local model endpoint.",
    );
  });
});

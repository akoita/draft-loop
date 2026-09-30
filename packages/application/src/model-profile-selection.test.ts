import { describe, expect, it } from "vitest";

import {
  listModelProfileRouteSupport,
  type RunProviderAuthModeConfiguration,
  resolveModelProfilePair,
} from "./model-profile-selection.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import { RunModelProfileError } from "./run-model-profiles.js";

const apiKeyModes: RunProviderAuthModeConfiguration = {
  anthropic: "api-key",
  openai: "api-key",
};

describe("application model profile selection", () => {
  it("resolves the exact registered profiles for their requested roles", () => {
    const result = resolveModelProfilePair(
      {
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "standard-openai-critic", version: 2 },
      },
      apiKeyModes,
    );

    expect(result.author).toMatchObject({
      id: "standard-anthropic-author",
      modelId: "claude-opus-5-5",
      roles: ["author"],
    });
    expect(result.critic).toMatchObject({
      id: "standard-openai-critic",
      modelId: "gpt-6.1-sol",
      roles: ["critic"],
    });
  });

  it.each([
    undefined,
    null,
    {},
    { author: { id: "legacy-anthropic-author", version: 1 } },
    {
      author: { id: "legacy-anthropic-author", version: 1, extra: true },
      critic: { id: "legacy-openai-critic", version: 1 },
    },
    {
      author: { id: "legacy-openai-critic", version: 1 },
      critic: { id: "legacy-openai-critic", version: 1 },
    },
    {
      author: { id: "legacy-anthropic-author", version: 1 },
      critic: { id: "legacy-openai-critic", version: Number.MAX_SAFE_INTEGER + 1 },
    },
  ])("rejects malformed or role-incompatible references: %j", (references) => {
    expect(() => resolveModelProfilePair(references, apiKeyModes)).toThrow(RunModelProfileError);
  });

  it("reports every default registry entry using configured route constraints", () => {
    const profiles = defaultModelProfileRegistry.list();
    const apiSupport = listModelProfileRouteSupport(apiKeyModes);
    const sessionSupport = listModelProfileRouteSupport({
      anthropic: "user-session",
      openai: "user-session",
    });

    expect(apiSupport).toEqual(
      profiles.map(({ id, version }) => ({ id, version, supported: true })),
    );
    expect(sessionSupport).toHaveLength(profiles.length);
    expect(sessionSupport.find(({ id }) => id === "legacy-openai-critic")?.supported).toBe(false);
    expect(sessionSupport.find(({ id }) => id === "standard-openai-critic")?.supported).toBe(false);
    expect(sessionSupport.find(({ id }) => id === "legacy-anthropic-author")?.supported).toBe(true);
    expect(sessionSupport.find(({ id }) => id === "standard-anthropic-author")?.supported).toBe(
      true,
    );
  });

  it("returns a detached bounded route support projection", () => {
    const first = listModelProfileRouteSupport(apiKeyModes);
    first[0] = { id: "changed", version: 99, supported: false };
    first.pop();

    expect(listModelProfileRouteSupport(apiKeyModes)).toHaveLength(
      defaultModelProfileRegistry.list().length,
    );
    expect(listModelProfileRouteSupport(apiKeyModes)[0]).not.toMatchObject({ id: "changed" });
  });
});

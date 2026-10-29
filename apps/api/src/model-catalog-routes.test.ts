import { listModelProfileCatalog } from "@draft-loop/application/model-profile-catalog";
import { isVertexClaudeModel } from "@draft-loop/model-gateway";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { hostedDefaultModelPair } from "./hosted-model-catalog.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";

interface Catalog {
  readonly models: readonly {
    readonly id: string;
    readonly version: number;
    readonly company: string;
    readonly model: string;
    readonly roles: readonly string[];
    readonly defaultEffort: string;
    readonly effortLevels: readonly string[];
  }[];
  readonly presets: readonly {
    readonly id: string;
    readonly author: { readonly id: string; readonly version: number };
    readonly critic: { readonly id: string; readonly version: number };
  }[];
  readonly defaultPresetId: string;
  readonly localModels: readonly string[];
}

let app: FastifyInstance;

async function readCatalog(localModels?: readonly string[]): Promise<Catalog> {
  app = await buildApi({
    ownerToken,
    ...(localModels === undefined ? {} : { localModels }),
    application: {
      service: {} as never,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/model-catalog",
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Catalog;
}

afterEach(async () => {
  await app.close();
});

describe("hosted model catalog", () => {
  it("lists only the models the gateway routes, never a desktop-only company", async () => {
    const catalog = await readCatalog();

    expect(catalog.models.length).toBeGreaterThan(0);
    for (const model of catalog.models) {
      expect(["anthropic", "openai"]).toContain(model.company);
      if (model.company === "anthropic") expect(isVertexClaudeModel(model.model)).toBe(true);
    }
    const desktopOnly = listModelProfileCatalog().filter(
      ({ profile }) => profile.provider !== "anthropic" && profile.provider !== "openai",
    );
    expect(desktopOnly.length).toBeGreaterThan(0);
    for (const { profile } of desktopOnly) {
      expect(catalog.models.map(({ id }) => id)).not.toContain(profile.id);
    }
  });

  it("offers the cross-company presets, each naming a served author and critic", async () => {
    const catalog = await readCatalog();
    const served = new Map(catalog.models.map((model) => [`${model.id}@${model.version}`, model]));

    expect(catalog.presets.map(({ id }) => id)).toEqual(["economy", "balanced", "standard"]);
    for (const preset of catalog.presets) {
      const author = served.get(`${preset.author.id}@${preset.author.version}`);
      const critic = served.get(`${preset.critic.id}@${preset.critic.version}`);
      expect(author?.roles).toContain("author");
      expect(critic?.roles).toContain("critic");
      expect(author?.company).not.toBe(critic?.company);
    }
  });

  it("defaults to the balanced preset, with Claude Sonnet as the author", async () => {
    const catalog = await readCatalog();

    expect(catalog.defaultPresetId).toBe("balanced");
    expect(catalog.presets.map(({ id }) => id)).toContain(catalog.defaultPresetId);
    expect(hostedDefaultModelPair()).toEqual({
      author: { company: "anthropic", model: "claude-sonnet-5-5" },
      critic: { company: "openai", model: "gpt-6.1-terra" },
    });
  });

  it("lists each model's default reasoning level and the levels a run may choose", async () => {
    const catalog = await readCatalog();
    const terra = catalog.models.find(({ model }) => model === "gpt-6.1-terra");

    expect(terra).toMatchObject({
      defaultEffort: "low",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
    });
    for (const model of catalog.models) {
      expect(model.effortLevels).not.toContain("provider-default");
      if (model.defaultEffort !== "provider-default") {
        expect(model.effortLevels).toContain(model.defaultEffort);
      }
    }
  });

  it("lists no local model unless the deployment declares them", async () => {
    expect((await readCatalog()).localModels).toEqual([]);
    await app.close();

    const catalog = await readCatalog(["qwen3:32b", "llama-4-scout"]);
    expect(catalog.localModels).toEqual(["qwen3:32b", "llama-4-scout"]);
    expect(catalog.models.map(({ company }) => company)).not.toContain("local");
  });
});

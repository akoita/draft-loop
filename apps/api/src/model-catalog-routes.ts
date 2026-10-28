import {
  choosableModelProfileEfforts,
  isChoosableModelProfileEffort,
} from "@draft-loop/application/model-profile-catalog";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { hostedModelCatalog, isHostedCompany } from "./hosted-model-catalog.js";

const profileReferenceSchema = z.object({ id: z.string(), version: z.number().int() });

const catalogModelSchema = z
  .object({
    id: z.string().describe("The model profile's id; with its version, an exact reference."),
    version: z.number().int(),
    company: z.enum(["anthropic", "openai"]),
    model: z.string().describe("The provider's model id, which the screens name for display."),
    tier: z.enum(["economy", "standard", "premium"]),
    roles: z.array(z.enum(["author", "critic"])),
    qualityStatus: z.literal("unvalidated"),
    defaultEffort: z
      .enum([...choosableModelProfileEfforts, "provider-default"])
      .describe("The reasoning level a run uses when no level is chosen."),
    effortLevels: z
      .array(z.enum(choosableModelProfileEfforts))
      .describe("The reasoning levels a run may choose; empty when only the default is offered."),
    pricing: z
      .object({
        inputUsdPerMillion: z.number(),
        outputUsdPerMillion: z.number(),
        cacheReadUsdPerMillion: z.number().nullable(),
        cacheWriteUsdPerMillion: z.number().nullable(),
        maxInputTokens: z.number().int(),
      })
      .describe("The provider's list price per million tokens, before any location premium."),
  })
  .meta({ id: "CatalogModel" });

const catalogPresetSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    tier: z.enum(["economy", "standard", "premium"]),
    author: profileReferenceSchema,
    critic: profileReferenceSchema,
  })
  .meta({ id: "CatalogPreset" });

const modelCatalogSchema = z
  .object({
    models: z.array(catalogModelSchema),
    presets: z.array(catalogPresetSchema),
    defaultPresetId: z.string().describe("The preset a new workspace gets when it names no model."),
  })
  .meta({ id: "ModelCatalog" });

/**
 * The models the hosted gateway serves and the presets built from them, for the shared model
 * picker (ADR 0011, D9). It reads the same catalog as the desktop, narrowed to what the gateway
 * routes, so the picker never offers a model a run would refuse.
 */
export function registerModelCatalogRoutes(parent: FastifyInstance): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/v1/model-catalog",
    {
      schema: {
        summary: "List the models and presets the hosted service runs",
        response: { 200: modelCatalogSchema },
      },
    },
    async () => {
      const catalog = hostedModelCatalog();
      return {
        models: catalog.models.flatMap(({ profile, qualityStatus, apiPricing, effortLevels }) => {
          const company: string = profile.provider;
          if (!isHostedCompany(company)) return [];
          return [
            {
              id: profile.id,
              version: profile.version,
              company,
              model: profile.modelId,
              tier: profile.tier,
              roles: [...profile.roles],
              qualityStatus,
              defaultEffort: profile.runtime.effort,
              effortLevels: effortLevels.filter(isChoosableModelProfileEffort),
              pricing: {
                inputUsdPerMillion: apiPricing.inputUsdPerMillion,
                outputUsdPerMillion: apiPricing.outputUsdPerMillion,
                cacheReadUsdPerMillion: apiPricing.cacheReadUsdPerMillion ?? null,
                cacheWriteUsdPerMillion: apiPricing.cacheWriteUsdPerMillion ?? null,
                maxInputTokens: apiPricing.maxInputTokens,
              },
            },
          ];
        }),
        presets: catalog.presets.map(({ id, label, tier, author, critic }) => ({
          id,
          label,
          tier,
          author: { ...author },
          critic: { ...critic },
        })),
        defaultPresetId: catalog.defaultPresetId,
      };
    },
  );
}

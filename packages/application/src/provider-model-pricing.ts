import type { ModelSelection } from "@draft-loop/domain";
import type { ModelPricing } from "@draft-loop/providers";
import { listModelProfileCatalog, type ModelProfileCatalogEntry } from "./model-profile-catalog.js";

function adapterPricing({ apiPricing }: ModelProfileCatalogEntry): ModelPricing {
  return {
    inputUsdPerMillionTokens: apiPricing.inputUsdPerMillion,
    outputUsdPerMillionTokens: apiPricing.outputUsdPerMillion,
    // Without a recorded cache-read rate, a cached read is billed as standard input: it never
    // costs more, so the estimate stays an upper bound rather than unknown.
    cachedInputUsdPerMillionTokens:
      apiPricing.cacheReadUsdPerMillion ?? apiPricing.inputUsdPerMillion,
    ...(apiPricing.cacheWriteUsdPerMillion === undefined
      ? {}
      : { cacheWriteInputUsdPerMillionTokens: apiPricing.cacheWriteUsdPerMillion }),
    maxInputTokens: apiPricing.maxInputTokens,
  };
}

function servesModel(entry: ModelProfileCatalogEntry, model: ModelSelection): boolean {
  return entry.profile.provider === model.company && entry.profile.modelId === model.modelId;
}

/**
 * The catalog's API rates for the model a run calls, so each call records an estimated cost.
 * The selected profile decides when it is known; otherwise the model must have one agreed price
 * across the catalog entries that serve the selection's role, since an author's cache write is
 * priced at its five-minute lifetime and a critic's at the hour (#2043). Anything else stays
 * unpriced rather than guessed.
 */
export function catalogModelPricing(
  model: ModelSelection,
  catalog: readonly ModelProfileCatalogEntry[] = listModelProfileCatalog(),
): ModelPricing | undefined {
  const { profile } = model;
  const selected =
    profile === undefined
      ? undefined
      : catalog.find(
          (entry) =>
            entry.profile.id === profile.id &&
            entry.profile.version === profile.version &&
            servesModel(entry, model),
        );
  if (selected !== undefined) return adapterPricing(selected);
  const serving = catalog.filter((entry) => servesModel(entry, model));
  const inRole = serving.filter((entry) => entry.profile.roles.includes(model.role));
  const prices = (inRole.length > 0 ? inRole : serving).map(adapterPricing);
  const [first] = prices;
  if (first === undefined) return undefined;
  const agreed = prices.every((price) => JSON.stringify(price) === JSON.stringify(first));
  return agreed ? first : undefined;
}

import { type VertexEuLocation, VertexLocationError, vertexEuLocation } from "./vertex-location.js";

/**
 * The DraftLoop model ids the gateway may call on Vertex AI. Current Claude models keep their
 * first-party id on Vertex, so run history records the id that was actually called. A model that
 * is not listed is refused, never replaced by another one. Whether a listed model is offered in
 * the deployment's location is confirmed by the manual live check, not assumed.
 */
export const vertexClaudeModelIds = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;

export type VertexClaudeModelId = (typeof vertexClaudeModelIds)[number];

const listed: ReadonlySet<string> = new Set(vertexClaudeModelIds);

export function isVertexClaudeModel(modelId: string): modelId is VertexClaudeModelId {
  return listed.has(modelId);
}

/**
 * The listed models a single `europe-*` region also serves. Vertex AI's regional endpoints serve
 * Claude Sonnet 4.6 and earlier only; every newer model needs the `eu` multi-region, priced 10%
 * above the global endpoint. None of the listed models is regional today.
 */
const regionalModels: ReadonlySet<VertexClaudeModelId> = new Set<VertexClaudeModelId>();

/** Whether the location serves the listed model: `eu` serves every one, a region only older ones. */
export function vertexLocationServes(
  location: VertexEuLocation,
  modelId: VertexClaudeModelId,
): boolean {
  return location === "eu" || regionalModels.has(modelId);
}

/**
 * The deployment's Vertex location for Claude, checked at startup: an EU location that serves
 * every listed model. A single `europe-*` region would only fail on the first run's first call,
 * so it is refused here with the setting to use instead.
 */
export function vertexClaudeLocation(location: string): VertexEuLocation {
  const checked = vertexEuLocation(location);
  const unserved = vertexClaudeModelIds.filter((id) => !vertexLocationServes(checked, id));
  if (unserved.length > 0) {
    throw new VertexLocationError(
      `The Vertex AI region ${checked} does not serve ${unserved.join(", ")}. Use the eu multi-region.`,
    );
  }
  return checked;
}

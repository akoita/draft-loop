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

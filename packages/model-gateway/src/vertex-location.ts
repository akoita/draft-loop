/**
 * A Vertex AI location inside the EU: the `eu` multi-region or one `europe-*` region (ADR 0011,
 * D14). The `global` endpoint and the other multi-regions may process material outside the EU, so
 * they are refused rather than offered as a setting.
 */
export type VertexEuLocation = "eu" | `europe-${string}`;

export class VertexLocationError extends Error {
  override readonly name = "VertexLocationError";
}

const regionPattern = /^europe-[a-z]+[0-9]+$/u;

export function vertexEuLocation(location: string): VertexEuLocation {
  if (location === "eu") return location;
  if (regionPattern.test(location)) return location as VertexEuLocation;
  throw new VertexLocationError(
    "The Vertex AI location must be the eu multi-region or a europe-* region.",
  );
}

/**
 * The location's endpoint, set explicitly so that no environment variable can move the calls to
 * another endpoint.
 */
export function vertexBaseUrl(location: VertexEuLocation): string {
  return location === "eu"
    ? "https://aiplatform.eu.rep.googleapis.com/v1"
    : `https://${location}-aiplatform.googleapis.com/v1`;
}

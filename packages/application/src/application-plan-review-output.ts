import type { JsonObject, ProviderValidationDiagnostic } from "@draft-loop/providers";
import {
  type ApplicationPlan,
  maximumApplicationPlanReviewPoints,
} from "@draft-loop/schemas/application-plan";

/** The schema's limit on one review point; the provider's structured output does not enforce it. */
const maximumPointCharacters = 240;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shortens a point at a word boundary, so a long point keeps its sense instead of failing. */
function shortenedPoint(text: string): string {
  if (text.length <= maximumPointCharacters) return text;
  const room = text.slice(0, maximumPointCharacters - 1);
  const lastSpace = room.lastIndexOf(" ");
  return `${(lastSpace > maximumPointCharacters / 2 ? room.slice(0, lastSpace) : room).trimEnd()}…`;
}

/**
 * Brings a critic's plan review within the limits the schema enforces but the provider's structured
 * output drops: point length, point count, and theme ranks the plan holds. A Claude critic writes
 * longer and more points than the reviewers these limits were tuned on, and one point over a limit
 * used to reject the whole review (#1983). Anything else stays as returned, so the schema still
 * rejects a malformed review.
 */
export function normalizeApplicationPlanReviewOutput(
  output: JsonObject,
  plan: ApplicationPlan,
): JsonObject {
  if (!Array.isArray(output.points)) return output;
  const points = output.points
    .map((point) => {
      if (!isRecord(point) || typeof point.text !== "string") return point;
      const rank = point.themeRank;
      const inPlan =
        typeof rank === "number" &&
        Number.isInteger(rank) &&
        rank >= 1 &&
        rank <= plan.themes.length;
      return {
        ...point,
        text: shortenedPoint(point.text.trim()),
        themeRank: rank === null || inPlan ? rank : null,
      };
    })
    .filter((point) => !isRecord(point) || point.text !== "")
    .slice(0, maximumApplicationPlanReviewPoints);
  return { ...output, points } as JsonObject;
}

/** Content-free diagnostics of a rejected review: issue codes and paths, never the text. */
export function planReviewDiagnostics(
  issues: readonly { readonly code: string; readonly path: readonly PropertyKey[] }[],
): ProviderValidationDiagnostic[] {
  return issues.slice(0, 10).map(({ code, path }) => ({
    code: String(code),
    path: path.map(String).join("."),
  }));
}

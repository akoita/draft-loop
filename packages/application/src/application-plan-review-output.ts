import type { JsonObject, ProviderValidationDiagnostic } from "@draft-loop/providers";
import {
  type ApplicationPlan,
  maximumApplicationPlanReviewPoints,
  maximumApplicationPlanThemes,
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

/**
 * Makes a theme's gap flag agree with its evidence. A gap that cites approved evidence is read by
 * the plan's own leads: a core area built on it means the author found support, so it stops being a
 * gap; otherwise it stays a gap and cites nothing. A theme that cites nothing is a gap. A Haiku
 * author marked a theme as a gap yet cited chunks for it, which rejected every plan attempt on prod.
 * The cited ids are still checked against the request afterwards.
 */
function consistentTheme(theme: unknown, servedByCoreArea: boolean): unknown {
  if (!isRecord(theme) || !Array.isArray(theme.evidenceChunkIds)) return theme;
  if (theme.gap === true && theme.evidenceChunkIds.length > 0) {
    return servedByCoreArea ? { ...theme, gap: false } : { ...theme, evidenceChunkIds: [] };
  }
  if (theme.gap === false && theme.evidenceChunkIds.length === 0) {
    return { ...theme, gap: true };
  }
  return theme;
}

/**
 * Keeps an author's plan within the limits the provider's structured output drops. Themes come most
 * important first, so past the theme limit the extra ones are the least important, and core areas
 * that served only those themes go with them. A Haiku author listing six themes failed every plan
 * attempt on prod. Each theme's gap flag is made to agree with its evidence. Anything else stays as
 * returned, so the schema and the plan checks still reject a malformed plan.
 */
export function normalizeApplicationPlanOutput(output: JsonObject): JsonObject {
  const returned = output.themes;
  if (!Array.isArray(returned)) return output;
  const leads = output.leads;
  const coreAreas =
    isRecord(leads) && Array.isArray(leads.coreAreas)
      ? leads.coreAreas.filter(
          (area) =>
            !isRecord(area) ||
            typeof area.themeRank !== "number" ||
            area.themeRank <= maximumApplicationPlanThemes,
        )
      : undefined;
  const servedRanks = new Set(
    (coreAreas ?? []).flatMap((area) => (isRecord(area) ? [area.themeRank] : [])),
  );
  const themes = returned
    .slice(0, maximumApplicationPlanThemes)
    .map((theme, index) => consistentTheme(theme, servedRanks.has(index + 1)));
  const changed = themes.some((theme, index) => theme !== returned[index]);
  if (!changed && returned.length <= maximumApplicationPlanThemes) return output;
  if (!isRecord(leads) || coreAreas === undefined) return { ...output, themes } as JsonObject;
  return { ...output, themes, leads: { ...leads, coreAreas } } as JsonObject;
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

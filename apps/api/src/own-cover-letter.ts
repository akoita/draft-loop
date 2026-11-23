import type { SavedApplicationMaterial } from "@draft-loop/schemas/saved-application-material";

/**
 * A cover letter the candidate writes in their own words beside a writing kit (#3279). It is
 * saved through the material versions route, based on the kit or on their earlier letter, as a
 * `cover-letter` version marked `written_by: candidate`: every paragraph is theirs, nothing is
 * cited and no model call is made.
 */

/** True when a new version of this saved material is the candidate's own letter. */
export function isOwnLetterBase(base: SavedApplicationMaterial): boolean {
  return base.kind === "cover-letter-kit" || base.written_by === "candidate";
}

/** The candidate's letter, one item per paragraph, as a new version based on `base`. */
export function ownCoverLetterVersion(
  base: SavedApplicationMaterial,
  paragraphs: readonly string[],
  version: { readonly id: string; readonly createdAt: string },
): SavedApplicationMaterial {
  return {
    id: version.id,
    workspace_id: base.workspace_id,
    application_id: base.application_id,
    kind: "cover-letter",
    items: paragraphs.map((text) => ({ question: "", text, edited: true, citations: [] })),
    based_on: base.id,
    written_by: "candidate",
    // The model that prepared the kit; the letter's text is the candidate's.
    model: base.model,
    prompt_version: base.prompt_version,
    cost_usd: 0,
    created_at: version.createdAt,
  };
}

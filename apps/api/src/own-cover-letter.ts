import type { SavedApplicationMaterial } from "@draft-loop/schemas/saved-application-material";

/**
 * A cover letter the candidate writes in their own words beside a writing kit (#3279) or an
 * annotated draft (#3281). It is saved through the material versions route, based on the kit,
 * the drafted letter they rewrote or their earlier letter, as a
 * `cover-letter` version marked `written_by: candidate`: every paragraph is theirs, nothing is
 * cited and no model call is made.
 */

/** True for a saved cover letter or writing kit, which a letter of the candidate's may follow. */
export function isLetterBase(base: SavedApplicationMaterial): boolean {
  return base.kind === "cover-letter" || base.kind === "cover-letter-kit";
}

/**
 * True when a new version of this saved material is the candidate's own letter: based on a kit or
 * on their own letter, or on a drafted letter they rewrote beside it in the annotated draft
 * (#3281), which the request marks `written_by: candidate`.
 */
export function isOwnLetterBase(base: SavedApplicationMaterial, writtenBy?: "candidate"): boolean {
  return (
    base.kind === "cover-letter-kit" ||
    base.written_by === "candidate" ||
    (writtenBy === "candidate" && base.kind === "cover-letter")
  );
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
    // The model that prepared the kit or the draft; the letter's text is the candidate's.
    model: base.model,
    prompt_version: base.prompt_version,
    cost_usd: 0,
    created_at: version.createdAt,
  };
}

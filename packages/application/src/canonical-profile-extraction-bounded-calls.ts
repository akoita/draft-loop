import type { JsonObject, ModelRequest } from "@draft-loop/providers";
import { canonicalCandidateProfileExtractionProposalJsonSchema } from "@draft-loop/schemas";

import type { CanonicalCandidateProfileExtractionRequest } from "./candidate-profile-extraction.js";
import type { CanonicalProfileExtractionPlannedCall } from "./canonical-profile-extraction-plan.js";

const outputName = "canonical_candidate_profile_extraction";

export const canonicalProfileBoundedCallInstructions =
  "This is one bounded extraction call. input.sources contains one complete source, or one contiguous window of a longer source described by input.extractionWindow using UTF-16 offsets into the original source. Other sources and windows are extracted by separate calls, and conflicts and duplicates across them are detected locally. Extract every supported entry-level fact (one fact per source entry, keeping its numbers and context together) whose evidence is in the supplied text. Propose conflict or duplicate issues only between facts grounded in the supplied text; never invent counterfacts for material that is not supplied. Every evidence quote must be exact contiguous text from the supplied text and must contain the entire fact value. Preserve all existing evidence, key, and schema rules.";

const headingPathInstructions =
  "When input.extractionWindow.headingPath is present, it lists the headings that enclose the supplied text, outermost first. Use it only as context for who, where, and when; it is not part of the source text, so never quote it as evidence and never take a fact value from it.";

export const groundingCorrectionInstructions = [
  "This is one bounded corrective extraction request after local evidence-grounding diagnostics.",
  "Return a complete replacement proposal using all supplied source records; no prior proposal is included, so do not refer to one.",
  "Use input.groundingRecovery counts only to check likely error types; the counts contain no failed values, quotes, or source locations.",
  "Re-extract every source-supported entry-level fact and preserve grounded conflicting claims as separate facts and issue relationships; do not drop all affected facts as a shortcut.",
  "Copy each fact value literally from an exact contiguous evidence quote, preserving Markdown punctuation, hyphens, dashes, and date wording.",
  "For example, the source phrase 'from Jan 2020 to Jun 2024' does not support the synthesized value '2020–2024'; use literal wording from the source.",
  "Keep one fact per source entry: when a value is not literal, use the entry's own wording as the value rather than splitting the entry into several facts or synthesizing a combined value.",
].join(" ");

export interface BoundedCallControls {
  readonly model: ModelRequest<JsonObject>["model"];
  readonly systemPrompt: string;
  readonly maxOutputTokens: number;
  readonly dataPolicy: ModelRequest<JsonObject>["dataPolicy"];
}

/** Build a request that carries only the planned call's own source or window text. */
export function buildBoundedCallRequest(
  request: CanonicalCandidateProfileExtractionRequest,
  controls: BoundedCallControls,
  plannedCall: CanonicalProfileExtractionPlannedCall,
  groundingRecovery: CanonicalCandidateProfileExtractionRequest["groundingRecovery"],
): ModelRequest<JsonObject> {
  const source = request.sources.find((candidate) => candidate.id === plannedCall.sourceId);
  if (source === undefined) throw new Error("The planned extraction source is unavailable.");
  const { window } = plannedCall;
  const input = JSON.parse(
    JSON.stringify({
      sources:
        window === undefined
          ? [source]
          : [
              {
                id: source.id,
                mediaType: source.mediaType,
                ...(source.evidenceKind === undefined ? {} : { evidenceKind: source.evidenceKind }),
                text: window.text,
              },
            ],
      ...(window === undefined
        ? {}
        : {
            extractionWindow: {
              sourceId: source.id,
              start: window.start,
              end: window.end,
              sourceLength: source.text.length,
              ...(window.headingPath === undefined ? {} : { headingPath: window.headingPath }),
            },
          }),
      ...(groundingRecovery === undefined ? {} : { groundingRecovery }),
    }),
  ) as JsonObject;
  return {
    contextSnapshotId: request.operationId,
    model: controls.model,
    systemPrompt: [
      controls.systemPrompt,
      canonicalProfileBoundedCallInstructions,
      ...(window?.headingPath === undefined ? [] : [headingPathInstructions]),
      ...(groundingRecovery === undefined ? [] : [groundingCorrectionInstructions]),
    ].join(" "),
    input,
    outputSchema: canonicalCandidateProfileExtractionProposalJsonSchema as JsonObject,
    outputName,
    maxOutputTokens: controls.maxOutputTokens,
    dataPolicy: controls.dataPolicy,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  };
}

import type {
  CanonicalCandidateProfileExtractionIdentity,
  ModelCompany,
  ModelSelection,
} from "@draft-loop/domain";

import { canonicalExtractionProfileFor } from "./canonical-extraction-profile.js";
import { promptVersion } from "./canonical-profile-provider-request.js";

/** The author route that extracts a canonical profile, with its detached extraction profile. */
export function canonicalProfileExtractionModel(
  company: ModelCompany,
  modelId: string,
): ModelSelection {
  const extractionProfile = canonicalExtractionProfileFor(company, modelId);
  return {
    company,
    modelId,
    role: "author",
    promptTemplateVersion: promptVersion,
    ...(extractionProfile === undefined ? {} : { profile: extractionProfile }),
  };
}

/** The path-free identity persisted with a profile version so later runs can match the route. */
export function canonicalProfileExtractionIdentity(
  model: ModelSelection,
): CanonicalCandidateProfileExtractionIdentity {
  return {
    company: model.company,
    modelId: model.modelId,
    promptTemplateVersion: model.promptTemplateVersion,
    ...(model.profile === undefined
      ? {}
      : { extractionProfile: { id: model.profile.id, version: model.profile.version } }),
  };
}

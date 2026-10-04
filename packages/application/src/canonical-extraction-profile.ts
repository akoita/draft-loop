import type { ModelProfile } from "@draft-loop/domain/model-profile";
import {
  googleGeminiProfileVersionFor,
  isGoogleGeminiModel,
} from "./gemini-development-profile.js";
import { createGoogleGeminiExtractionProfile } from "./gemini-extraction-profile.js";
import { createGLMExtractionProfile, isDeepInfraGLMModel } from "./glm-extraction-profile.js";

/** Return the detached extraction profile for a development author route, if one exists. */
export function canonicalExtractionProfileFor(
  company: string,
  modelId: string,
): ModelProfile | undefined {
  if (isDeepInfraGLMModel(company, modelId)) return createGLMExtractionProfile();
  if (isGoogleGeminiModel(company, modelId)) {
    const version = googleGeminiProfileVersionFor(modelId);
    return version === undefined ? undefined : createGoogleGeminiExtractionProfile(version);
  }
  return undefined;
}

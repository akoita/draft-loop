/**
 * Dependency-free provider and model identity constants. Renderer-reachable modules import
 * these through `@draft-loop/providers/model-identities` so they never load provider SDKs or
 * Node-only transport code.
 */
export const deepInfraGLMProvider = "deepinfra" as const;
export const deepInfraGLMCompany = "zai" as const;
export const deepInfraGLMModelId = "zai-org/GLM-5.3-Flash" as const;

export const googleGeminiProvider = "google" as const;
export const googleGeminiCompany = "google" as const;
export const googleGemini37FlashModelId = "gemini-3.7-flash" as const;
export const googleGemini38FlashModelId = "gemini-3.8-flash" as const;
export const googleGemini4HydrogenModelId = "gemini-4-hydrogen" as const;
export const googleGemini4CarbonModelId = "gemini-4-carbon" as const;
export const googleGemini4ArgonModelId = "gemini-4-argon" as const;
/** The development preset's default Gemini model. */
export const googleGeminiModelId = googleGemini38FlashModelId;
/** Gemini 4 models: thinking is always on, so a request picks a level and never disables it. */
export const googleGemini4ModelIds = [
  googleGemini4HydrogenModelId,
  googleGemini4CarbonModelId,
  googleGemini4ArgonModelId,
] as const;
/** Exact Gemini models the adapter accepts; 3.7 stays so existing runs can resume. */
export const googleGeminiSupportedModelIds = [
  googleGemini37FlashModelId,
  googleGemini38FlashModelId,
  ...googleGemini4ModelIds,
] as const;

export function isGoogleGemini4ModelId(modelId: string): boolean {
  return (googleGemini4ModelIds as readonly string[]).includes(modelId);
}

export function isGoogleGeminiSupportedModelId(modelId: string): boolean {
  return (googleGeminiSupportedModelIds as readonly string[]).includes(modelId);
}

export const mistralProvider = "mistral" as const;
export const mistralCompany = "mistral" as const;
export const mistralLarge4ModelId = "mistral-large-4" as const;

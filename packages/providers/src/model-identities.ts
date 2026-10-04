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
/** The development preset's default Gemini model. */
export const googleGeminiModelId = googleGemini38FlashModelId;
/** Exact Gemini models the adapter accepts; 3.7 stays so existing runs can resume. */
export const googleGeminiSupportedModelIds = [
  googleGemini37FlashModelId,
  googleGemini38FlashModelId,
] as const;

export function isGoogleGeminiSupportedModelId(modelId: string): boolean {
  return (googleGeminiSupportedModelIds as readonly string[]).includes(modelId);
}

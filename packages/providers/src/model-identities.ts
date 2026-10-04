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
export const googleGeminiModelId = "gemini-3.7-flash" as const;

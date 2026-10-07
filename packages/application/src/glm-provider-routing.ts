import type { DataExposurePolicy } from "@draft-loop/providers";

export type ProviderCredentialName = "anthropic" | "openai" | "deepinfra" | "google" | "mistral";
export type ProviderCredentialResolver = (
  provider: ProviderCredentialName,
) => Promise<string | undefined>;

export const supportedModelCompanies = [
  "anthropic",
  "openai",
  "local",
  "zai",
  "google",
  "mistral",
] as const;
export type SupportedModelCompany = (typeof supportedModelCompanies)[number];

/**
 * Output ceiling for opportunity extraction. Mistral Large 4 writes long structured
 * responses and overran 4,096 tokens on a short job posting in a live run.
 */
export function opportunityExtractionMaxOutputTokens(company: string): number {
  return company === "mistral" ? 16384 : 4096;
}

export const providerAuthModes = ["api-key", "user-session"] as const;
export type ProviderAuthMode = (typeof providerAuthModes)[number];
export type ProviderAuthModeConfiguration = Readonly<
  Record<"anthropic" | "openai", ProviderAuthMode>
>;

export function isProviderAuthMode(value: unknown): value is ProviderAuthMode {
  return typeof value === "string" && providerAuthModes.includes(value as ProviderAuthMode);
}

export function resolveProviderAuthMode(value: string | undefined): ProviderAuthMode {
  if (value === undefined) return "api-key";
  if (isProviderAuthMode(value)) return value;
  throw new Error(`Unsupported provider authentication mode: ${value}`);
}

export function resolveProviderAuthModes(
  value: string | undefined,
  anthropicValue?: string,
  openAIValue?: string,
): ProviderAuthModeConfiguration {
  const fallback = resolveProviderAuthMode(value);
  return {
    anthropic: anthropicValue === undefined ? fallback : resolveProviderAuthMode(anthropicValue),
    openai: openAIValue === undefined ? fallback : resolveProviderAuthMode(openAIValue),
  };
}

export const environmentCredentialResolver: ProviderCredentialResolver = async (provider) => {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "deepinfra") return process.env.DEEPINFRA_API_KEY;
  if (provider === "google") return process.env.GEMINI_API_KEY;
  if (provider === "mistral") return process.env.MISTRAL_API_KEY;
  return undefined;
};

export function providerDataPolicy(
  company: string,
  allowProviderData: boolean,
  providerAuthModeConfiguration: ProviderAuthModeConfiguration,
): DataExposurePolicy {
  return {
    allowTransmission: allowProviderData,
    allowedCompanies:
      company === "zai"
        ? ["deepinfra"]
        : company === "google"
          ? ["google"]
          : company === "mistral"
            ? ["mistral"]
            : supportedModelCompanies,
    sensitiveData: true,
    sensitiveDataAcknowledged: allowProviderData,
    requestedRetention:
      (company === "anthropic" || company === "openai") &&
      providerAuthModeConfiguration[company] === "user-session"
        ? "provider-default"
        : "ephemeral-request",
  };
}

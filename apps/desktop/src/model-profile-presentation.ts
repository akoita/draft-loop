import type { ModelProfilePreset } from "@draft-loop/application/model-profile-catalog";

const modelNames: Readonly<Record<string, string>> = {
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-fable-5-1": "Claude Fable 5.1",
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-5": "GPT-5",
  "gpt-6-sol": "GPT-6 Sol",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6-astra": "GPT-6 Astra",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "zai-org/GLM-5.3-Flash": "GLM-5.3 Flash",
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
};

const providerNames: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  zai: "Z.ai via DeepInfra",
  google: "Google",
  local: "Local model",
};

const unvalidatedSuffix = " — unvalidated";

export function modelDisplayName(modelId: string): string {
  return modelNames[modelId] ?? modelId;
}

export function providerDisplayName(company: string): string {
  return providerNames[company] ?? company;
}

export function presetDisplayName(label: string): string {
  return label.endsWith(unvalidatedSuffix) ? label.slice(0, -unvalidatedSuffix.length) : label;
}

/** Formats a USD-per-million-token rate with at least two decimals when fractional. */
export function formatUsdPerMillion(value: number): string {
  if (Number.isInteger(value)) return `$${value}`;
  const twoDecimals = value.toFixed(2);
  if (value >= 0.1 || Number(twoDecimals) === value) return `$${twoDecimals}`;
  return `$${value.toFixed(3).replace(/0+$/, "")}`;
}

export function isDevelopmentPreset(preset: Pick<ModelProfilePreset, "id">): boolean {
  return preset.id.startsWith("development-");
}

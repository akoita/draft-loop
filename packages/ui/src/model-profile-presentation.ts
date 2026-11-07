import type { ModelProfilePreset } from "@draft-loop/application/model-profile-catalog";
import { t } from "@lingui/core/macro";

const modelNames = (): Readonly<Record<string, string>> => ({
  "claude-haiku-5-5": t`Claude Haiku 5.5`,
  "claude-sonnet-5-5": t`Claude Sonnet 5.5`,
  "claude-opus-5-5": t`Claude Opus 5.5`,
  "claude-fable-5-1": t`Claude Fable 5.1`,
  "claude-sonnet-4-5": t`Claude Sonnet 4.5`,
  "gpt-6-luna": t`GPT-6 Luna`,
  "gpt-5": "GPT-5",
  "gpt-6-sol": t`GPT-6 Sol`,
  "gpt-6.1-sol": t`GPT-6.1 Sol`,
  "gpt-6.1-terra": t`GPT-6.1 Terra`,
  "gpt-6-astra": t`GPT-6 Astra`,
  "gpt-5.6-luna": t`GPT-5.6 Luna`,
  "zai-org/GLM-5.3-Flash": t`GLM-5.3 Flash`,
  "gemini-3.7-flash": t`Gemini 3.7 Flash`,
  "gemini-3.8-flash": t`Gemini 3.8 Flash`,
  "mistral-large-4": t`Mistral Large 4 (preview)`,
});

const providerNames = (): Readonly<Record<string, string>> => ({
  anthropic: t`Anthropic`,
  openai: "OpenAI",
  zai: "Z.ai via DeepInfra",
  google: t`Google`,
  mistral: t`Mistral`,
  local: t`Local model`,
});

const unvalidatedSuffix = " — unvalidated";

export function modelDisplayName(modelId: string): string {
  return modelNames()[modelId] ?? modelId;
}

export function providerDisplayName(company: string): string {
  return providerNames()[company] ?? company;
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

const effortDisplayNames = (): Readonly<Record<string, string>> => ({
  low: t`Low`,
  medium: t`Medium`,
  high: t`High`,
  xhigh: t`Extra high`,
  max: t`Max`,
  "provider-default": t`Provider default`,
});

/** A reasoning level's name for the screens, such as "Extra high" for `xhigh`. */
export function effortDisplayName(effort: string): string {
  return effortDisplayNames()[effort] ?? effort;
}

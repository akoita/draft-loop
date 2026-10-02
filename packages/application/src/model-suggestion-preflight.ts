import type { ModelSelection } from "@draft-loop/domain";
import type { ModelProfile } from "@draft-loop/domain/model-profile";
import {
  type JsonObject,
  ProviderAdapterError,
  type ProviderErrorCode,
} from "@draft-loop/providers";
import { isDeepInfraGLMAuthorProfile } from "./glm-development-profile.js";
import {
  createProviderAdapter,
  type ProviderClientFactories,
  type ProviderCredentialResolver,
  type ProviderUserSessionRunners,
} from "./local-provider-adapter.js";
import {
  listModelProfileCatalog,
  listModelProfilePresets,
  type ModelProfileCatalogEntry,
  type ModelProfilePreset,
} from "./model-profile-catalog.js";
import type { RunProviderAuthModeConfiguration } from "./model-profile-selection.js";

export const modelSuggestionPreflightMaxOutputTokens = 1024;
export const modelSuggestionPreflightTimeoutMs = 60_000;

export type ModelSuggestionProvider = "anthropic" | "openai";
export type ModelSuggestionRole = "author" | "critic";
export type ModelSuggestionFailureCode = ProviderErrorCode;

export interface ModelSuggestionProfileReference {
  readonly id: string;
  readonly version: number;
}

export interface ModelSuggestionPlanRow {
  readonly provider: ModelSuggestionProvider;
  readonly modelId: string;
  readonly role: ModelSuggestionRole;
  readonly profileRefs: readonly ModelSuggestionProfileReference[];
  readonly required: boolean;
  readonly authMode: "api-key" | "user-session";
  readonly maxOutputTokens: 1024;
  readonly timeoutMs: 60_000;
  readonly profileControls: false;
  readonly generationCap: "enforced" | "post-response-only";
}

export interface ModelSuggestionPreflightPlan {
  readonly authModes: RunProviderAuthModeConfiguration;
  readonly rows: readonly ModelSuggestionPlanRow[];
}

export interface ModelSuggestionPreflightRowResult extends ModelSuggestionPlanRow {
  readonly status: "available" | "unavailable";
  readonly reason: ModelSuggestionFailureCode | null;
}

export interface ModelSuggestionPreflightResult {
  readonly passed: boolean;
  readonly checkedAtISO: string;
  readonly authModes: RunProviderAuthModeConfiguration;
  readonly rows: readonly ModelSuggestionPreflightRowResult[];
  readonly optionalFailures: readonly {
    readonly provider: ModelSuggestionProvider;
    readonly modelId: string;
    readonly role: ModelSuggestionRole;
    readonly profileRefs: readonly ModelSuggestionProfileReference[];
  }[];
}

export class ModelSuggestionPreflightInputError extends Error {
  constructor() {
    super("Model-suggestion preflight configuration is invalid.");
    this.name = "ModelSuggestionPreflightInputError";
  }
}

interface PlanDependencies {
  readonly catalog?: readonly ModelProfileCatalogEntry[];
  readonly presets?: readonly ModelProfilePreset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAuthModes(value: unknown): RunProviderAuthModeConfiguration {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    Object.keys(value).some((key) => key !== "anthropic" && key !== "openai") ||
    (value.anthropic !== "api-key" && value.anthropic !== "user-session") ||
    (value.openai !== "api-key" && value.openai !== "user-session")
  ) {
    throw new ModelSuggestionPreflightInputError();
  }
  return { anthropic: value.anthropic, openai: value.openai };
}

function referenceKey(role: ModelSuggestionRole, id: string, version: number): string {
  return JSON.stringify([role, id, version]);
}

function selectionKey(
  provider: ModelSuggestionProvider,
  modelId: string,
  role: ModelSuggestionRole,
): string {
  return JSON.stringify([provider, modelId, role]);
}

function profileReference(profile: ModelProfile): ModelSuggestionProfileReference {
  if (
    typeof profile.id !== "string" ||
    profile.id.trim() === "" ||
    !Number.isSafeInteger(profile.version) ||
    profile.version <= 0
  ) {
    throw new ModelSuggestionPreflightInputError();
  }
  return { id: profile.id, version: profile.version };
}

function presetRequiredReferences(presets: readonly ModelProfilePreset[]): Set<string> {
  const required = new Set<string>();
  const included = new Set<string>();
  for (const preset of presets) {
    if (!isRecord(preset)) throw new ModelSuggestionPreflightInputError();
    if (preset.id !== "economy" && preset.id !== "standard") continue;
    included.add(preset.id);
    if (
      !isRecord(preset.author) ||
      !isRecord(preset.critic) ||
      typeof preset.author.id !== "string" ||
      preset.author.id.trim() === "" ||
      !Number.isSafeInteger(preset.author.version) ||
      preset.author.version <= 0 ||
      typeof preset.critic.id !== "string" ||
      preset.critic.id.trim() === "" ||
      !Number.isSafeInteger(preset.critic.version) ||
      preset.critic.version <= 0
    ) {
      throw new ModelSuggestionPreflightInputError();
    }
    required.add(referenceKey("author", preset.author.id, preset.author.version));
    required.add(referenceKey("critic", preset.critic.id, preset.critic.version));
  }
  if (!included.has("economy") || !included.has("standard") || required.size !== 4) {
    throw new ModelSuggestionPreflightInputError();
  }
  return required;
}

/** Project current catalog entries to one bounded check per exact provider/model/role. */
export function buildModelSuggestionPreflightPlan(
  authModesInput: RunProviderAuthModeConfiguration,
  dependencies: PlanDependencies = {},
): ModelSuggestionPreflightPlan {
  const authModes = validateAuthModes(authModesInput);
  const catalog = dependencies.catalog ?? listModelProfileCatalog();
  const presets = dependencies.presets ?? listModelProfilePresets();
  if (!Array.isArray(catalog) || !Array.isArray(presets)) {
    throw new ModelSuggestionPreflightInputError();
  }
  const requiredReferences = presetRequiredReferences(presets);
  const grouped = new Map<
    string,
    {
      provider: ModelSuggestionProvider;
      modelId: string;
      role: ModelSuggestionRole;
      refs: Map<string, ModelSuggestionProfileReference>;
    }
  >();
  const availableReferences = new Set<string>();

  for (const entry of catalog) {
    if (!isRecord(entry) || !isRecord(entry.profile)) {
      throw new ModelSuggestionPreflightInputError();
    }
    const profile = entry.profile as unknown as ModelProfile;
    if (
      profile.provider === "zai" &&
      Array.isArray(profile.roles) &&
      isRecord(profile.runtime) &&
      isRecord(profile.runtime.thinking) &&
      isRecord(profile.knownLimits) &&
      isDeepInfraGLMAuthorProfile(profile)
    ) {
      continue;
    }
    if (
      !isRecord(profile) ||
      (profile.provider !== "anthropic" && profile.provider !== "openai") ||
      typeof profile.modelId !== "string" ||
      profile.modelId.trim() === "" ||
      !Array.isArray(profile.roles) ||
      profile.roles.length === 0 ||
      new Set(profile.roles).size !== profile.roles.length
    ) {
      throw new ModelSuggestionPreflightInputError();
    }
    const provider: ModelSuggestionProvider =
      profile.provider === "anthropic" ? "anthropic" : "openai";
    const ref = profileReference(profile);
    for (const role of profile.roles) {
      if (role !== "author" && role !== "critic") {
        throw new ModelSuggestionPreflightInputError();
      }
      const key = selectionKey(provider, profile.modelId, role);
      const group = grouped.get(key) ?? {
        provider,
        modelId: profile.modelId,
        role,
        refs: new Map<string, ModelSuggestionProfileReference>(),
      };
      if (!grouped.has(key)) grouped.set(key, group);
      group.refs.set(referenceKey(role, ref.id, ref.version), ref);
      availableReferences.add(referenceKey(role, ref.id, ref.version));
    }
  }

  for (const required of requiredReferences) {
    if (!availableReferences.has(required)) throw new ModelSuggestionPreflightInputError();
  }

  const rows = [...grouped.values()].map((group): ModelSuggestionPlanRow => {
    const refs = [...group.refs.values()];
    const required = refs.some((ref) =>
      requiredReferences.has(referenceKey(group.role, ref.id, ref.version)),
    );
    return {
      provider: group.provider,
      modelId: group.modelId,
      role: group.role,
      profileRefs: refs,
      required,
      authMode: authModes[group.provider],
      maxOutputTokens: modelSuggestionPreflightMaxOutputTokens,
      timeoutMs: modelSuggestionPreflightTimeoutMs,
      profileControls: false,
      generationCap:
        group.provider === "openai" && authModes.openai === "user-session"
          ? "post-response-only"
          : "enforced",
    };
  });

  return { authModes, rows };
}

const systemPrompt =
  'This is a synthetic model-availability check. Return exactly {"ready":true} and nothing else. Do not use tools.';
const input: JsonObject = Object.freeze({ check: "model-suggestion-preflight" });
const outputSchema: JsonObject = Object.freeze({
  type: "object",
  properties: Object.freeze({ ready: Object.freeze({ type: "boolean" }) }),
  required: Object.freeze(["ready"]),
  additionalProperties: false,
});

const safeFailureCodes = new Set<ProviderErrorCode>([
  "authentication",
  "permission",
  "rate-limit",
  "quota-exhausted",
  "timeout",
  "cancelled",
  "transient",
  "invalid-request",
  "invalid-response",
  "policy",
  "unknown",
]);

function failureCode(error: unknown): ProviderErrorCode {
  return error instanceof ProviderAdapterError && safeFailureCodes.has(error.code)
    ? error.code
    : "unknown";
}

function exactReady(value: unknown): boolean {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    value.ready === true
  );
}

export interface RunModelSuggestionPreflightOptions {
  readonly authModes: RunProviderAuthModeConfiguration;
  readonly resolveCredential?: ProviderCredentialResolver;
  readonly providerClientFactories?: ProviderClientFactories;
  readonly userSessionRunners?: ProviderUserSessionRunners;
  readonly planDependencies?: PlanDependencies;
  readonly checkedAt?: () => Date;
}

/** Sequentially checks each registered destination once and returns content-free results. */
export async function runModelSuggestionPreflight(
  options: RunModelSuggestionPreflightOptions,
): Promise<ModelSuggestionPreflightResult> {
  const plan = buildModelSuggestionPreflightPlan(options.authModes, options.planDependencies);
  const outcomes: ModelSuggestionPreflightRowResult[] = [];

  for (const row of plan.rows) {
    const model: ModelSelection = {
      company: row.provider,
      modelId: row.modelId,
      role: row.role,
      promptTemplateVersion: "model-suggestion-preflight-v1",
    };
    let outcome: ModelSuggestionPreflightRowResult;
    try {
      const adapter = await createProviderAdapter(
        { retry: { maxRetries: 0 } },
        model,
        true,
        options.resolveCredential ?? (async () => undefined),
        options.providerClientFactories,
        plan.authModes,
        options.userSessionRunners,
        row.timeoutMs,
      );
      const response = await adapter.execute({
        contextSnapshotId: "model-suggestion-preflight",
        model,
        systemPrompt,
        input,
        outputSchema,
        outputName: "model_suggestion_preflight",
        maxOutputTokens: row.maxOutputTokens,
        dataPolicy: {
          allowTransmission: true,
          allowedCompanies: [row.provider],
          sensitiveData: false,
          sensitiveDataAcknowledged: false,
        },
        signal: AbortSignal.timeout(row.timeoutMs),
      });
      outcome = {
        ...row,
        status: exactReady(response.output) ? "available" : "unavailable",
        reason: exactReady(response.output) ? null : "invalid-response",
      };
    } catch (error) {
      outcome = { ...row, status: "unavailable", reason: failureCode(error) };
    }
    outcomes.push(outcome);
  }

  const checkedAtISO = (options.checkedAt?.() ?? new Date()).toISOString();
  const optionalFailures = outcomes
    .filter((row) => !row.required && row.status === "unavailable")
    .map(({ provider, modelId, role, profileRefs }) => ({ provider, modelId, role, profileRefs }));
  return {
    passed: outcomes.every((row) => !row.required || row.status === "available"),
    checkedAtISO,
    authModes: plan.authModes,
    rows: outcomes,
    optionalFailures,
  };
}

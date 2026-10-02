import type { ModelCompany } from "@draft-loop/domain";
import {
  type ContextSnapshot,
  createContextSnapshot,
  type ModelConfigurationInput,
  type ModelSelection,
} from "@draft-loop/domain";
import type { ModelProfile } from "@draft-loop/domain/model-profile";
import type { RunBudget } from "@draft-loop/orchestrator";
import { modelProfileSchema } from "@draft-loop/schemas/model-profile";
import { isDeepInfraGLMAuthorProfile } from "./glm-development-profile.js";
import type {
  CandidateProfileSelection,
  ModelProfileReferences,
  OpportunityBriefSelection,
  ResumeRunCommand,
  StartRunCommand,
} from "./index.js";
import type {
  ProviderClientFactories,
  ProviderCredentialResolver,
  ProviderUserSessionRunners,
} from "./local-provider-adapter.js";
import type { ModelProfileRegistry } from "./model-profiles.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";

export type RunProviderAuthMode = "api-key" | "user-session";
export type RunProviderAuthModeConfiguration = Readonly<
  Record<"anthropic" | "openai", RunProviderAuthMode>
>;

/** Options shared by begin, start, and resume; profile references are start-only. */
export interface RunOptions {
  readonly runId?: string;
  readonly allowProviderData?: boolean;
  readonly opportunityBrief?: OpportunityBriefSelection;
  readonly candidateProfile?: CandidateProfileSelection;
  readonly modelProfiles?: ModelProfileReferences;
  readonly modelProfileRegistry?: ModelProfileRegistry;
  readonly writingPolicyOverrideChecksum?: string;
  readonly resolveCredential?: ProviderCredentialResolver;
  readonly providerClientFactories?: ProviderClientFactories;
  readonly providerAuthMode?: RunProviderAuthMode;
  readonly providerAuthModeConfiguration?: RunProviderAuthModeConfiguration;
  readonly userSessionRunners?: ProviderUserSessionRunners;
  readonly userSessionTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly authorProposalCaptureDirectory?: string;
  readonly localClaudeCategoryCaptureParent?: string;
}

export type BeginStartRunOptions = Omit<
  RunOptions,
  "runId" | "signal" | "writingPolicyOverrideChecksum"
>;
export type ResumeRunOptions = Omit<
  RunOptions,
  | "opportunityBrief"
  | "candidateProfile"
  | "modelProfiles"
  | "modelProfileRegistry"
  | "writingPolicyOverrideChecksum"
>;

/** Keep command projection beside the extracted run option contract. */
export function projectStartRunOptions(
  command: StartRunCommand,
  providerOptions: Omit<
    BeginStartRunOptions,
    | "allowProviderData"
    | "opportunityBrief"
    | "candidateProfile"
    | "modelProfiles"
    | "writingPolicyOverrideChecksum"
  >,
): BeginStartRunOptions {
  return {
    ...(command.allowProviderData === undefined
      ? {}
      : { allowProviderData: command.allowProviderData }),
    ...(command.modelProfiles === undefined ? {} : { modelProfiles: command.modelProfiles }),
    ...(command.opportunityBrief === undefined
      ? {}
      : { opportunityBrief: command.opportunityBrief }),
    ...(command.candidateProfile === undefined
      ? {}
      : { candidateProfile: command.candidateProfile }),
    ...(command.writingPolicyOverrideChecksum === undefined
      ? {}
      : { writingPolicyOverrideChecksum: command.writingPolicyOverrideChecksum }),
    ...providerOptions,
  };
}

export function projectResumeRunOptions(
  command: ResumeRunCommand,
  providerOptions: Omit<ResumeRunOptions, "runId" | "allowProviderData" | "signal">,
): ResumeRunOptions {
  return {
    ...(command.runId === undefined ? {} : { runId: command.runId }),
    ...(command.allowProviderData === undefined
      ? {}
      : { allowProviderData: command.allowProviderData }),
    ...(command.signal === undefined ? {} : { signal: command.signal }),
    ...providerOptions,
  };
}

export class RunModelProfileError extends Error {
  constructor() {
    super("The selected model profiles are invalid or unsupported for the configured route.");
    this.name = "RunModelProfileError";
  }
}

export interface ResolvedRunModelProfiles {
  readonly author: ModelProfile;
  readonly critic: ModelProfile;
}

const maximumProfileOutputTokens = 32_768;
const verifiedSonnet45ModelIds = new Set(["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"]);

export function validateProfileRoute(
  profile: ModelProfile,
  authModes: RunProviderAuthModeConfiguration,
): void {
  if (profile.runtime.maxOutputTokens > maximumProfileOutputTokens) {
    throw new RunModelProfileError();
  }
  if (profile.provider === "zai") {
    if (!isDeepInfraGLMAuthorProfile(profile)) throw new RunModelProfileError();
    return;
  }
  if (profile.provider !== "anthropic" && profile.provider !== "openai") {
    throw new RunModelProfileError();
  }
  if (profile.provider === "openai" && profile.runtime.thinking.mode !== "provider-default") {
    throw new RunModelProfileError();
  }
  if (
    profile.provider === "anthropic" &&
    profile.runtime.thinking.mode === "budgeted" &&
    (profile.runtime.thinking.maxTokens < 1024 ||
      profile.runtime.thinking.maxTokens >= profile.runtime.maxOutputTokens)
  ) {
    throw new RunModelProfileError();
  }
  if (profile.provider === "openai" && authModes.openai === "user-session") {
    throw new RunModelProfileError();
  }
  if (profile.provider === "anthropic" && authModes.anthropic === "user-session") {
    const verifiedSonnet45 = verifiedSonnet45ModelIds.has(profile.modelId);
    if (
      (profile.runtime.thinking.mode !== "provider-default" && !verifiedSonnet45) ||
      (verifiedSonnet45 && profile.runtime.effort !== "provider-default")
    ) {
      throw new RunModelProfileError();
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveOneProfile(
  reference: unknown,
  role: "author" | "critic",
  registry: ModelProfileRegistry,
): ModelProfile {
  if (
    !isRecord(reference) ||
    Object.keys(reference).some((key) => key !== "id" && key !== "version") ||
    typeof reference.id !== "string" ||
    !Number.isSafeInteger(reference.version) ||
    (reference.version as number) <= 0
  ) {
    throw new RunModelProfileError();
  }

  try {
    const parsed = modelProfileSchema.safeParse(
      registry.resolve(reference.id, reference.version as number, role),
    );
    if (
      !parsed.success ||
      parsed.data.id !== reference.id ||
      parsed.data.version !== reference.version ||
      !parsed.data.roles.includes(role)
    ) {
      throw new RunModelProfileError();
    }
    return parsed.data;
  } catch {
    throw new RunModelProfileError();
  }
}

/** Resolve once and reject profiles the selected provider/auth route cannot honor. */
export function resolveRunModelProfiles(
  references: unknown,
  registry: ModelProfileRegistry,
  authModes: RunProviderAuthModeConfiguration,
): ResolvedRunModelProfiles {
  if (
    !isRecord(references) ||
    Object.keys(references).some((key) => key !== "author" && key !== "critic")
  ) {
    throw new RunModelProfileError();
  }

  const resolved = {
    author: resolveOneProfile(references.author, "author", registry),
    critic: resolveOneProfile(references.critic, "critic", registry),
  };
  validateProfileRoute(resolved.author, authModes);
  validateProfileRoute(resolved.critic, authModes);
  return resolved;
}

export function resolveRequestedRunModelProfiles(
  references: unknown,
  registry: ModelProfileRegistry | undefined,
  authModes: RunProviderAuthModeConfiguration,
): ResolvedRunModelProfiles | undefined {
  return references === undefined
    ? undefined
    : resolveRunModelProfiles(references, registry ?? defaultModelProfileRegistry, authModes);
}

function bindSelection(selection: ModelSelection, profile: ModelProfile): ModelSelection {
  const sameIdentity =
    selection.company === profile.provider && selection.modelId === profile.modelId;
  const { lineage, ...withoutLineage } = selection;
  return {
    ...withoutLineage,
    company: profile.provider,
    modelId: profile.modelId,
    ...(sameIdentity && lineage !== undefined ? { lineage } : {}),
    profile,
  };
}

/** Build a detached context snapshot without changing the workspace pairing. */
export function bindRunModelProfiles(
  context: ContextSnapshot,
  profiles: ResolvedRunModelProfiles,
): ContextSnapshot {
  const configuration: ModelConfigurationInput = {
    ...context.modelConfiguration,
    author: bindSelection(context.modelConfiguration.author, profiles.author),
    critic: bindSelection(context.modelConfiguration.critic, profiles.critic),
  };
  return createContextSnapshot({ ...context, modelConfiguration: configuration });
}

/** Recheck the saved route against current auth settings without consulting a registry. */
export function validateRecordedRunProfileRoute(
  context: ContextSnapshot,
  authModes: RunProviderAuthModeConfiguration,
): void {
  const authorSelection = context.modelConfiguration.author;
  const criticSelection = context.modelConfiguration.critic;
  const authorProfile = authorSelection.profile;
  const criticProfile = criticSelection.profile;
  if (authorProfile === undefined && criticProfile === undefined) return;
  if (authorProfile === undefined || criticProfile === undefined) {
    throw new RunModelProfileError();
  }

  for (const [selection, profile, role] of [
    [authorSelection, authorProfile, "author"],
    [criticSelection, criticProfile, "critic"],
  ] as const) {
    const parsed = modelProfileSchema.safeParse(profile);
    if (
      !parsed.success ||
      parsed.data.provider !== selection.company ||
      parsed.data.modelId !== selection.modelId ||
      !parsed.data.roles.includes(role)
    ) {
      throw new RunModelProfileError();
    }
    validateProfileRoute(parsed.data, authModes);
  }
}

export function runModelIdentity(
  configured: { readonly company: ModelCompany; readonly modelId: string },
  selection: ModelSelection,
): { readonly company: string; readonly modelId: string } {
  return selection.profile === undefined
    ? configured
    : { company: selection.company, modelId: selection.modelId };
}

export function runProviderPairingSummary(
  configured: {
    readonly author: { readonly company: string; readonly modelId: string };
    readonly critic: { readonly company: string; readonly modelId: string };
  },
  context?: ContextSnapshot,
): string {
  const author =
    context === undefined
      ? configured.author
      : runModelIdentity(configured.author, context.modelConfiguration.author);
  const critic =
    context === undefined
      ? configured.critic
      : runModelIdentity(configured.critic, context.modelConfiguration.critic);
  return `Provider pairing: author ${author.company}/${author.modelId}; critic ${critic.company}/${critic.modelId}`;
}

export function writeRunPreflight(
  config: {
    readonly authorCompany: string;
    readonly authorModel: string;
    readonly criticCompany: string;
    readonly criticModel: string;
    readonly fixtureMode: boolean;
  },
  write: (line: string) => void,
  runBudget: RunBudget,
  context?: ContextSnapshot,
): void {
  write(
    runProviderPairingSummary(
      {
        author: { company: config.authorCompany, modelId: config.authorModel },
        critic: { company: config.criticCompany, modelId: config.criticModel },
      },
      context,
    ),
  );
  write(
    `Budget: maxRounds=${runBudget.maxRounds}${runBudget.maxCostUsd === undefined ? "" : `, maxCostUsd=${runBudget.maxCostUsd}`}${runBudget.maxDurationMs === undefined ? "" : `, maxDurationMs=${runBudget.maxDurationMs}`}`,
  );
  write(
    `Provider transmission: ${config.fixtureMode ? "disabled (offline fixture mode)" : "enabled only with --allow-provider-data"}`,
  );
}

export function criticOutputBudget(selection: ModelSelection): number {
  return selection.profile?.runtime.maxOutputTokens ?? 16_384;
}

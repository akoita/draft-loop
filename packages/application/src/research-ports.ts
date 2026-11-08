import type { ModelSelection } from "@draft-loop/domain";
import { createRuleContentScreener } from "@draft-loop/ingestion/content-screening-rules";

import type { ApplicationMaterialModelExecutor } from "./application-material-model.js";
import { guardCallCost } from "./call-cost-guard.js";
import { type ContentScreener, screenWith } from "./content-screening.js";
import {
  environmentCredentialResolver,
  providerDataPolicy,
  resolveProviderAuthModes,
} from "./glm-provider-routing.js";
import type { LocalApplicationDriverOptions } from "./local.js";
import { createProviderAdapter } from "./local-provider-adapter.js";
import {
  createModelResearchFindings,
  type ResearchFindingsPort,
  type ResearchScreen,
  researchPromptVersion,
} from "./research-run.js";

/**
 * The model side of one research run (#2560): Claude writes the findings over the host's provider
 * routes, under its own cap, and every source is screened by the rule screener first.
 */

/** The findings model: the sources are short cited passages, so the cheapest current Claude does it. */
export const researchFindingsModelId = "claude-haiku-5-5";
/** The findings call's own cap; the searches spend the rest of the run's US$0.20. */
export const defaultResearchFindingsMaxCostUsd = 0.08;

export interface ResearchFindingsPortsOptions {
  readonly applicationId: string;
  /** The deployment's ceiling on sending material to a provider. */
  readonly allowProviderData: boolean;
  readonly maxCostUsd?: number;
  readonly local?: LocalApplicationDriverOptions;
  readonly signal?: AbortSignal;
  /** Each call's tokens and cost, for the host's log; never the sources. */
  readonly onCall?: (call: {
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  }) => void;
}

export interface ResearchFindingsPorts {
  readonly findings: ResearchFindingsPort;
  /** What the findings call cost so far, in US dollars. */
  readonly spentUsd: () => number;
}

export function researchFindingsPorts(
  options: ResearchFindingsPortsOptions,
): ResearchFindingsPorts {
  const local = options.local ?? {};
  const authModes =
    local.providerAuthModeConfiguration ?? resolveProviderAuthModes(local.providerAuthMode);
  let spent = 0;
  const executor = guardCallCost(
    {
      execute: async (request: Parameters<ApplicationMaterialModelExecutor["execute"]>[0]) => {
        const adapter = await createProviderAdapter(
          {},
          request.model as ModelSelection,
          options.allowProviderData,
          local.resolveCredential ?? environmentCredentialResolver,
          local.providerClientFactories,
          authModes,
          local.userSessionRunners,
          local.userSessionTimeoutMs,
        );
        const response = await adapter.execute(request as never);
        const costUsd = response.cost.estimatedUsd ?? 0;
        spent += costUsd;
        options.onCall?.({
          model: response.modelId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd,
        });
        return response;
      },
    },
    options.maxCostUsd ?? defaultResearchFindingsMaxCostUsd,
  ) as unknown as ApplicationMaterialModelExecutor;
  const model = {
    company: "anthropic",
    modelId: researchFindingsModelId,
    role: "author",
    promptTemplateVersion: researchPromptVersion,
  } as ModelSelection;
  return {
    findings: createModelResearchFindings({
      executor,
      model,
      dataPolicy: providerDataPolicy("anthropic", options.allowProviderData, authModes),
      applicationId: options.applicationId,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
    spentUsd: () => spent,
  };
}

/**
 * Screens each source as an untrusted job page: clear only when every screener says so. A
 * screener that cannot decide leaves the text unscreened, which counts as flagged.
 */
export function researchScreen(
  screeners: readonly ContentScreener[] = [createRuleContentScreener()],
): ResearchScreen {
  return async (text) =>
    (await screenWith(screeners, { text, kind: "job-source" })).verdict === "clear";
}

import type { ModelSelection } from "@draft-loop/domain";

import type { ApplicationMaterialPort } from "./application-material.js";
import {
  type ApplicationMaterialModelExecutor,
  applicationMaterialPromptVersion,
  createModelApplicationMaterialWriter,
} from "./application-material-model.js";
import { guardCallCost } from "./call-cost-guard.js";
import {
  environmentCredentialResolver,
  providerDataPolicy,
  resolveProviderAuthModes,
} from "./glm-provider-routing.js";
import type { LocalApplicationDriverOptions } from "./local.js";
import { createProviderAdapter } from "./local-provider-adapter.js";
import {
  createModelMaterialCritic,
  type MaterialCriticPort,
  materialCriticPromptVersion,
} from "./material-critic.js";

/**
 * The models of one critic pass (#2525): the author that wrote the draft and the workspace's
 * critic, from another company, over the host's provider routes. Both share one cost cap.
 */

/** The default cap on one pass: a short critic call and one Sonnet revision stay well below it. */
export const defaultMaterialReviewMaxCostUsd = 0.3;

export interface MaterialReviewPortsOptions {
  /** The company and model that wrote the draft, as the saved draft records them. */
  readonly author: { readonly company: string; readonly model: string };
  /** The workspace's critic. */
  readonly critic: { readonly company: string; readonly model: string };
  readonly applicationId: string;
  /** The deployment's ceiling on sending candidate material to a provider. */
  readonly allowProviderData: boolean;
  readonly maxCostUsd?: number;
  readonly local?: LocalApplicationDriverOptions;
  readonly signal?: AbortSignal;
  /** Each call's tokens and cost, for the host's log; never the material. */
  readonly onCall?: (call: MaterialReviewCall) => void;
}

export interface MaterialReviewCall {
  readonly role: "author" | "critic";
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface MaterialReviewPorts {
  readonly author: ApplicationMaterialPort;
  readonly critic: MaterialCriticPort;
  /** What the pass's calls cost so far, in US dollars. */
  readonly spentUsd: () => number;
}

export function materialReviewPorts(options: MaterialReviewPortsOptions): MaterialReviewPorts {
  const local = options.local ?? {};
  const authModes =
    local.providerAuthModeConfiguration ?? resolveProviderAuthModes(local.providerAuthMode);
  let spent = 0;
  // One executor for both models, so the pass's cap covers the author and the critic together.
  const executor = guardCallCost(
    {
      execute: async (request: Parameters<ApplicationMaterialModelExecutor["execute"]>[0]) => {
        const model = request.model as ModelSelection;
        const adapter = await createProviderAdapter(
          {},
          model,
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
          role: model.role === "critic" ? "critic" : "author",
          model: response.modelId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd,
        });
        return response;
      },
    },
    options.maxCostUsd ?? defaultMaterialReviewMaxCostUsd,
  ) as unknown as ApplicationMaterialModelExecutor;
  const policyFor = (company: string) =>
    providerDataPolicy(company, options.allowProviderData, authModes);
  const signal = options.signal === undefined ? {} : { signal: options.signal };

  const authorModel: ModelSelection = {
    company: options.author.company,
    modelId: options.author.model,
    role: "author",
    promptTemplateVersion: applicationMaterialPromptVersion,
  } as ModelSelection;
  const criticModel: ModelSelection = {
    company: options.critic.company,
    modelId: options.critic.model,
    role: "critic",
    promptTemplateVersion: materialCriticPromptVersion,
  } as ModelSelection;
  return {
    author: createModelApplicationMaterialWriter({
      executor,
      model: authorModel,
      dataPolicy: policyFor(authorModel.company),
      applicationId: options.applicationId,
      ...signal,
    }),
    critic: createModelMaterialCritic({
      executor,
      model: criticModel,
      dataPolicy: policyFor(criticModel.company),
      applicationId: options.applicationId,
      ...signal,
    }),
    spentUsd: () => spent,
  };
}

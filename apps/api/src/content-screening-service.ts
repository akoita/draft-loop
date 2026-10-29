import {
  type ContentScreener,
  type ContentScreeningKind,
  catalogModelPricing,
  screenWith,
} from "@draft-loop/application";
import { createRuleContentScreener } from "@draft-loop/ingestion/content-screening-rules";
import {
  type AnthropicRouteBuilder,
  contentScreeningModelId,
  createDirectAnthropicRoute,
  createFileCredentialResolver,
  createHostedAnthropicRoute,
  createHostedContentScreener,
  type HostedContentScreenerOptions,
  type ModelScreeningUsage,
} from "@draft-loop/model-gateway";
import {
  type ContentScreeningStore,
  ContentScreeningStoreError,
  type ContentScreeningSubject,
  type StoredContentScreeningResult,
} from "@draft-loop/storage/content-screening";

import type { ScreeningConfig, ScreeningMode } from "./content-screening-config.js";

/** The log lines screening writes: content-free, so they carry ids, counts and cost only. */
export interface ScreeningLog {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

/** Builds the model screener for one call, with the data policy that call's material allows. */
export type ModelScreenerFactory = (
  options: Pick<HostedContentScreenerOptions, "dataPolicy" | "onUsage">,
) => ContentScreener;

/** What a deployment screens with. The tenant's service is built over it and the tenant's store. */
export interface ContentScreeningSetup {
  readonly mode: ScreeningMode;
  /** The deployment's ceiling on sending candidate material to a provider. */
  readonly allowProviderData: boolean;
  readonly rules: ContentScreener;
  /** Present with `rules+model`. */
  readonly model?: ModelScreenerFactory;
  readonly now?: () => string;
}

/** The rule screener alone, for compositions that name no screening. */
export function rulesScreeningSetup(): ContentScreeningSetup {
  return { mode: "rules", allowProviderData: false, rules: createRuleContentScreener() };
}

/** The route the model screener calls, or none when the configuration names no model. */
function screeningRoute(
  config: ScreeningConfig,
  dependencies: ScreeningRouteDependencies,
): AnthropicRouteBuilder | undefined {
  const { model, direct } = config;
  if (direct !== undefined) {
    // A self-hosted stack: the Claude API with the operator's key, read from its file per call.
    return createDirectAnthropicRoute({
      resolveCredential: createFileCredentialResolver({ directory: direct.secretsDirectory }),
      ...(dependencies.anthropicApiClient === undefined
        ? {}
        : { anthropicApiClient: dependencies.anthropicApiClient }),
    });
  }
  if (model === undefined) return undefined;
  return createHostedAnthropicRoute({
    vertex: {
      projectId: model.vertexProjectId,
      location: model.vertexLocation,
      locationPriceFactor: model.vertexPriceFactor,
    },
    // The direct Claude API processes material outside the EU, and the API holds no provider key.
    anthropicFallback: false,
    resolveCredential: async () => undefined,
  });
}

export interface ScreeningRouteDependencies {
  /** A scripted Claude API client for the direct route, for tests. */
  readonly anthropicApiClient?: Parameters<
    typeof createDirectAnthropicRoute
  >[0]["anthropicApiClient"];
}

/**
 * The deployment's screening from its configuration. `rules+model` builds its route once: the EU
 * Vertex route, whose location factor applies to each price, or the self-hosted Claude API route.
 * Haiku 5.5's catalog rates price each call.
 */
export function contentScreeningSetup(
  config: ScreeningConfig,
  dependencies: ScreeningRouteDependencies = {},
): ContentScreeningSetup {
  const rules = createRuleContentScreener();
  const { mode, allowProviderData } = config;
  const route = screeningRoute(config, dependencies);
  if (route === undefined) return { mode, allowProviderData, rules };
  const pricing = catalogModelPricing({
    company: "anthropic",
    modelId: contentScreeningModelId,
    role: "critic",
    promptTemplateVersion: "content-screening-v1",
  });
  return {
    mode,
    allowProviderData,
    rules,
    model: (options) =>
      createHostedContentScreener(route, {
        ...options,
        ...(pricing === undefined ? {} : { pricing }),
      }),
  };
}

export interface ScreenTextInput {
  readonly subject: ContentScreeningSubject;
  /** The text to screen; undefined when none could be read, which leaves it unscreened. */
  readonly text: string | undefined;
  readonly kind: ContentScreeningKind;
  /**
   * Whether the candidate record's current provider transmission consent names Anthropic. Only a
   * candidate source needs it: a job post is third-party content and always gets the model.
   */
  readonly candidateConsent: boolean;
  readonly log: ScreeningLog;
}

/** One tenant's screening: the store its results and quarantine live in, and how text is screened. */
export interface HostedContentScreening {
  readonly mode: ScreeningMode;
  readonly store: ContentScreeningStore;
  /**
   * Screens one text and stores the result against its subject. A screener that fails leaves the
   * text `unscreened`, which is quarantined; nothing here throws for a screener. With screening
   * off nothing is screened or stored, and the answer is undefined.
   */
  screen(input: ScreenTextInput): Promise<StoredContentScreeningResult | undefined>;
}

/** A screener that stands in for one that could not read the text, so its identity is recorded. */
function unavailable(screener: ContentScreener): ContentScreener {
  return {
    identity: screener.identity,
    screen: async () => {
      throw new Error("There is no text to screen.");
    },
  };
}

/** What a model may be sent: a job post is third-party text, a candidate source is not. */
function dataPolicy(kind: ContentScreeningKind, allowed: boolean) {
  const candidate = kind === "candidate-source";
  return {
    allowTransmission: allowed,
    allowedCompanies: ["anthropic" as const],
    sensitiveData: candidate,
    sensitiveDataAcknowledged: candidate && allowed,
    requestedRetention: "ephemeral-request" as const,
  };
}

export interface HostedContentScreeningParts {
  readonly store: ContentScreeningStore;
  readonly tenantId: string;
  readonly setup: ContentScreeningSetup;
}

export function createHostedContentScreening(
  parts: HostedContentScreeningParts,
): HostedContentScreening {
  const { store, tenantId, setup } = parts;

  const modelFor = (input: ScreenTextInput): ContentScreener | undefined => {
    if (setup.mode !== "rules+model" || setup.model === undefined) return undefined;
    // Candidate material reaches Anthropic only under the deployment's ceiling and the record's
    // own consent, as a run's does; a job post needs neither.
    const allowed =
      input.kind === "job-source" || (input.candidateConsent && setup.allowProviderData);
    if (!allowed) return undefined;
    return setup.model({
      dataPolicy: dataPolicy(input.kind, allowed),
      onUsage: (usage) => logUsage(input.log, tenantId, usage),
    });
  };

  return {
    mode: setup.mode,
    store,
    screen: async (input) => {
      if (setup.mode === "off") return undefined;
      const model = modelFor(input);
      const screeners = [setup.rules, ...(model === undefined ? [] : [model])];
      const result =
        input.text === undefined
          ? await screenWith(screeners.map(unavailable), { text: "", kind: input.kind }, setup.now)
          : await screenWith(screeners, { text: input.text, kind: input.kind }, setup.now);
      const stored = await store.recordResult(input.subject, result);
      logQuarantine(input.log, tenantId, stored);
      return stored;
    },
  };
}

/**
 * One `WARNING` for a result that quarantines its text, flagged or unscreened (ADR 0011, D16), so
 * the owner can be alerted: ids and closed codes only, never the text, a file name or a title.
 */
function logQuarantine(
  log: ScreeningLog,
  tenantId: string,
  stored: StoredContentScreeningResult,
): void {
  const { verdict, signals } = stored.result;
  if (verdict === "clear") return;
  log.warn(
    {
      screening: {
        tenantId,
        resultId: stored.id,
        subjectKind: stored.subject.kind,
        verdict,
        signals: [...signals],
      },
    },
    "material quarantined",
  );
}

/** One content-free line per answered model call: the tenant, the model and the cost. */
function logUsage(log: ScreeningLog, tenantId: string, usage: ModelScreeningUsage): void {
  log.info(
    {
      usage: {
        purpose: "content_screening",
        tenantId,
        provider: usage.provider,
        model: usage.modelId,
        route: usage.route,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedUsd: usage.estimatedUsd,
      },
    },
    "content screening model call",
  );
}

/**
 * Screening that is off and holds nothing, for an application composed without any: the run check
 * finds nothing quarantined, and a release finds no result.
 */
export const noContentScreening: HostedContentScreening = {
  mode: "off",
  store: {
    recordResult: async () => {
      throw new ContentScreeningStoreError("invalid_input", "Screening is not available.");
    },
    latestFor: async () => undefined,
    resultById: async () => undefined,
    quarantined: async () => [],
    release: async () => {
      throw new ContentScreeningStoreError("result_not_found", "No such screening result.");
    },
    listForRecord: async () => [],
    listForKnowledgeBase: async () => [],
  },
  screen: async () => undefined,
};

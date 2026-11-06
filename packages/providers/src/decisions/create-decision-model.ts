import {
  assertDecisionAnswersMatch,
  assertDecisionDataAllowed,
  assertDecisionQuestionsValid,
  type DecisionModel,
  DecisionModelError,
  type DecisionRequest,
  type DecisionResult,
  type DecisionVendor,
  defaultDecisionVendor,
} from "./decision-model.js";
import {
  type DecisionFetch,
  defaultDecisionTimeoutMs,
  postDecisionRequest,
} from "./decision-transport.js";
import {
  openAIDecisionsRequestBody,
  parseOpenAIDecisionsResponse,
} from "./openai-decisions-wire.js";
import {
  type ParsedDecisionResponse,
  parseSystemOneResponse,
  systemOneRequestBody,
} from "./systemone-wire.js";

/** The model each vendor uses when the configuration names none. */
export const defaultDecisionModels: Readonly<
  Record<Exclude<DecisionVendor, "microsoft-decision-1">, string>
> = Object.freeze({ "typesafe-jev": "jev-latest", "openai-decisions": "gpt-6-luna" });

export const defaultJevEndpoint = "https://api.typesafe.ai/v1/systemone";
export const defaultOpenAIBaseUrl = "https://api.openai.com/v1";

interface CommonDecisionModelOptions {
  /** Test seam and proxy hook; defaults to the global `fetch`. */
  readonly fetch?: DecisionFetch;
  readonly timeoutMs?: number;
}

export interface JevDecisionModelOptions extends CommonDecisionModelOptions {
  /** Omitted means Jev, the default vendor. */
  readonly vendor?: "typesafe-jev";
  readonly apiKey: string;
  /** Defaults to `jev-latest`; the result records the versioned model that answered. */
  readonly model?: string;
  /** Defaults to TypeSafe's API; a gateway that serves Jev can stand in. */
  readonly endpoint?: string;
}

export interface OpenAIDecisionModelOptions extends CommonDecisionModelOptions {
  readonly vendor: "openai-decisions";
  readonly apiKey: string;
  /** Defaults to `gpt-6-luna`. */
  readonly model?: string;
  /** Defaults to `https://api.openai.com/v1`; a regional endpoint can stand in. */
  readonly baseUrl?: string;
}

export interface MicrosoftDecisionModelOptions extends CommonDecisionModelOptions {
  readonly vendor: "microsoft-decision-1";
  /** The Foundry resource endpoint, such as `https://<resource>.services.ai.azure.com`. */
  readonly endpoint: string;
  /** The deployment name of Microsoft-Decision-1 in that resource. */
  readonly deployment: string;
  /** A Microsoft Entra ID bearer token for the Cognitive Services scope; called on every request. */
  readonly getAccessToken: () => Promise<string>;
}

export type DecisionModelOptions =
  | JevDecisionModelOptions
  | OpenAIDecisionModelOptions
  | MicrosoftDecisionModelOptions;

function httpsUrl(vendor: DecisionVendor, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DecisionModelError(
      vendor,
      "invalid-request",
      "The decision endpoint is not a valid URL.",
    );
  }
  if (url.protocol !== "https:") {
    throw new DecisionModelError(
      vendor,
      "invalid-request",
      "The decision endpoint must use https.",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

function requireSecret(vendor: DecisionVendor, value: string, what: string): string {
  if (value.trim() === "") {
    throw new DecisionModelError(vendor, "authentication", `The decision vendor needs ${what}.`);
  }
  return value;
}

interface Route {
  readonly vendor: DecisionVendor;
  readonly model: string;
  readonly url: string;
  readonly requestIdHeader: string;
  headers(): Promise<Record<string, string>>;
  body(request: DecisionRequest): unknown;
  parse(request: DecisionRequest, json: unknown, requestId: string | null): ParsedDecisionResponse;
}

function routeFor(options: DecisionModelOptions): Route {
  const vendor = options.vendor ?? defaultDecisionVendor;
  switch (options.vendor) {
    case "openai-decisions": {
      const apiKey = requireSecret(vendor, options.apiKey, "an API key");
      const model = options.model ?? defaultDecisionModels["openai-decisions"];
      return {
        vendor,
        model,
        url: `${httpsUrl(vendor, options.baseUrl ?? defaultOpenAIBaseUrl)}/decisions`,
        requestIdHeader: "x-request-id",
        headers: async () => ({ authorization: `Bearer ${apiKey}` }),
        body: (request) => openAIDecisionsRequestBody(model, request),
        parse: (request, json, requestId) =>
          parseOpenAIDecisionsResponse(request.questions, json, requestId),
      };
    }
    case "microsoft-decision-1": {
      const deployment = options.deployment.trim();
      if (deployment === "") {
        throw new DecisionModelError(
          vendor,
          "invalid-request",
          "Microsoft Decision 1 needs a deployment name.",
        );
      }
      const getAccessToken = options.getAccessToken;
      return {
        vendor,
        model: deployment,
        url: `${httpsUrl(vendor, options.endpoint)}/providers/microsoft/v1/systemone`,
        requestIdHeader: "x-request-id",
        headers: async () => {
          let token: string;
          try {
            token = await getAccessToken();
          } catch {
            throw new DecisionModelError(
              vendor,
              "authentication",
              "No access token for Microsoft Decision 1.",
            );
          }
          return { authorization: `Bearer ${requireSecret(vendor, token, "an access token")}` };
        },
        body: (request) => systemOneRequestBody(deployment, request),
        parse: (request, json, requestId) =>
          parseSystemOneResponse(vendor, request.questions, json, requestId),
      };
    }
    // Jev, the default vendor: `vendor` omitted or "typesafe-jev".
    default: {
      const apiKey = requireSecret(vendor, options.apiKey, "an API key");
      const model = options.model ?? defaultDecisionModels["typesafe-jev"];
      return {
        vendor,
        model,
        url: httpsUrl(vendor, options.endpoint ?? defaultJevEndpoint),
        requestIdHeader: "x-typesafe-request-id",
        headers: async () => ({ authorization: `Bearer ${apiKey}` }),
        body: (request) => systemOneRequestBody(model, request),
        parse: (request, json, requestId) =>
          parseSystemOneResponse(vendor, request.questions, json, requestId),
      };
    }
  }
}

/**
 * Builds the decision model a configuration names. Jev is the default vendor. Each call checks
 * the data policy and the questions before anything is sent, then checks that the answers match
 * the questions asked.
 */
export function createDecisionModel(options: DecisionModelOptions): DecisionModel {
  const route = routeFor(options);
  const fetchImpl: DecisionFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? defaultDecisionTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new DecisionModelError(
      route.vendor,
      "invalid-request",
      "The decision timeout must be a positive integer.",
    );
  }
  return {
    identity: Object.freeze({ vendor: route.vendor, model: route.model }),
    async decide(request: DecisionRequest): Promise<DecisionResult> {
      assertDecisionDataAllowed(route.vendor, request.dataPolicy);
      assertDecisionQuestionsValid(route.vendor, request.questions);
      const { json, requestId } = await postDecisionRequest({
        vendor: route.vendor,
        url: route.url,
        headers: await route.headers(),
        body: route.body(request),
        fetch: fetchImpl,
        timeoutMs,
        signal: request.signal,
        requestIdHeader: route.requestIdHeader,
      });
      const parsed = route.parse(request, json, requestId);
      assertDecisionAnswersMatch(route.vendor, request.questions, parsed.answers, requestId);
      return {
        vendor: route.vendor,
        model: parsed.model,
        answers: parsed.answers,
        usage: parsed.usage,
        requestId,
      };
    },
  };
}

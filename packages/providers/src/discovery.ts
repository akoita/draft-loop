/**
 * Listing the exact model ids a configured credential can actually reach.
 *
 * Model ids are free text everywhere else in the system, and the lineage
 * derived from one decides whether a run counts as independently reviewed. A
 * typo therefore does not fail loudly: it produces a different lineage that
 * quietly satisfies the independence check. Discovery exists so a caller can
 * offer the ids the provider itself reports instead of asking a person to
 * retype one.
 *
 * Discovery is deliberately *not* a method on the adapters. Listing models is
 * not executing one, and `ProviderAdapterOptions` requires the
 * `configuredModel` that does not exist yet at the moment someone is choosing
 * it. These are standalone functions with an injectable `fetch`, mirroring
 * `LocalClient`, so no test and no caller is one mistake away from a real
 * network call.
 *
 * What comes back is untrusted. A provider — above all a "local" server, which
 * is any process a person happened to start on this machine — can answer with
 * anything at all, and whatever it answers is a candidate for the workspace
 * configuration. Everything here is bounded and anything malformed is dropped
 * rather than passed on.
 */

import { normalizeProviderError, ProviderAdapterError, type ProviderId } from "./index.js";

/** The companies whose catalogue can be listed. */
export type DiscoverableProvider = "anthropic" | "openai" | "local";

/**
 * The most models one call will report.
 *
 * OpenAI's list is the longest of the three and sits under a hundred entries;
 * this leaves room to grow while keeping the worst case a caller must hold —
 * and hand to a renderer — at a few tens of kilobytes. A response with more
 * entries is truncated, not rejected: a long catalogue is a plausible provider
 * answer, and the ids that did arrive are still usable.
 */
export const maximumDiscoveredModels = 200;

/**
 * The longest model id that will be accepted.
 *
 * This matches the desktop bridge's own `modelId` bound so a discovered id is
 * one the rest of the system will accept; an id it would later refuse is not a
 * choice worth offering.
 */
export const maximumDiscoveredModelIdLength = 128;

/**
 * The charset a model id may use, matching what the workspace configuration
 * and the desktop bridge accept. Anything else — a slash, a space, a control
 * character, HTML — is dropped. Real ids (`claude-sonnet-4-5`, `gpt-5`,
 * `us.anthropic.claude-3`, `llama3.2:3b`) fit inside it.
 */
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * The largest response body that will be parsed.
 *
 * `JSON.parse` on an unbounded body is an easy way for a hostile or broken
 * local server to make the caller spend memory it did not agree to spend. A
 * megabyte is far more than any honest models list.
 */
const maximumResponseCharacters = 1_048_576;

/** How long a discovery call may take before it is abandoned. */
export const defaultModelDiscoveryTimeoutMs = 10_000;

const anthropicBaseUrl = "https://api.anthropic.com/v1";
const openaiBaseUrl = "https://api.openai.com/v1";
const anthropicVersion = "2023-06-01";

/** A model a provider reports as available to the credential that asked. */
export interface DiscoveredModel {
  readonly id: string;
}

export interface ModelCatalogue {
  readonly provider: ProviderId;
  readonly models: readonly DiscoveredModel[];
  /**
   * Whether the provider had more to say than this list carries, either
   * because it reported another page or because its answer exceeded the cap.
   */
  readonly truncated: boolean;
}

/** A hosted provider reached with an API key. The base URL is not overridable:
 * a caller-supplied host would be a way to send the key somewhere else. */
export interface HostedDiscoveryClient {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}

/**
 * A local OpenAI-compatible server.
 *
 * The endpoint is required rather than defaulted: the caller has already had
 * to name the address in order to check that it is really on this machine, so
 * a default here would only be one more place for the address to drift. That
 * loopback check stays with the caller because the rule lives in the
 * application layer and this package sits below it.
 */
export interface LocalDiscoveryClient {
  readonly endpoint: string;
  readonly fetch?: typeof fetch;
}

export interface ModelDiscoveryOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

function requireApiKey(provider: ProviderId, apiKey: string | undefined): string {
  const normalized = apiKey?.trim() ?? "";
  if (normalized === "") {
    throw new ProviderAdapterError(
      provider,
      "authentication",
      "No provider credential is configured.",
      { retryable: false },
    );
  }
  return normalized;
}

function invalidResponse(provider: ProviderId, code: string, path: string): ProviderAdapterError {
  return new ProviderAdapterError(
    provider,
    "invalid-response",
    "The provider returned a model list that could not be validated.",
    { retryable: false, diagnostics: [{ code, path }] },
  );
}

function resolveTimeoutMs(provider: ProviderId, value: number | undefined): number {
  const resolved = value ?? defaultModelDiscoveryTimeoutMs;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 120_000) {
    throw new ProviderAdapterError(
      provider,
      "invalid-request",
      "The discovery timeout is invalid.",
      {
        retryable: false,
        diagnostics: [{ code: "invalid_timeout", path: "timeoutMs" }],
      },
    );
  }
  return resolved;
}

/**
 * One bounded GET, returning the parsed body.
 *
 * The timeout is explicit rather than inherited from the platform: a local
 * server that accepts the connection and then says nothing must not hang the
 * caller's window forever.
 */
async function getJson(
  provider: ProviderId,
  url: string,
  headers: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch,
  options: ModelDiscoveryOptions | undefined,
): Promise<unknown> {
  const timeoutMs = resolveTimeoutMs(provider, options?.timeoutMs);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => {
    controller.abort(options?.signal?.reason);
  };
  if (options?.signal?.aborted === true) abortFromCaller();
  options?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("The provider did not answer in time."));
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { ...headers, accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw normalizeProviderError(provider, {
        status: response.status,
        headers: response.headers,
      });
    }
    const declaredLength = Number(headerValue(response, "content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > maximumResponseCharacters) {
      throw invalidResponse(provider, "response_too_large", "content-length");
    }
    const body = await response.text();
    if (body.length > maximumResponseCharacters) {
      throw invalidResponse(provider, "response_too_large", "body");
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw invalidResponse(provider, "invalid_json", "body");
    }
  } catch (error) {
    if (timedOut) {
      throw new ProviderAdapterError(
        provider,
        "timeout",
        "The provider did not answer the model list in time.",
      );
    }
    throw normalizeProviderError(provider, error);
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Reads one response header, tolerating a transport that supplies none. */
function headerValue(response: Response, name: string): string | undefined {
  const value = (response.headers as Headers | undefined)?.get(name);
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns a provider's `data` array into ids we are willing to repeat.
 *
 * Entries that are not well-formed are skipped rather than failing the whole
 * call: one junk row in an otherwise usable catalogue should not deny a person
 * the models that were fine. A body that is not a list at all is a different
 * matter and is refused.
 */
function parseModelList(provider: ProviderId, body: unknown): ModelCatalogue {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw invalidResponse(provider, "missing_data", "data");
  }
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const entry of body.data) {
    if (models.length >= maximumDiscoveredModels) break;
    if (!isRecord(entry)) continue;
    const id = entry.id;
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (trimmed.length > maximumDiscoveredModelIdLength || !modelIdPattern.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    models.push({ id: trimmed });
  }
  return {
    provider,
    models,
    truncated: body.data.length > maximumDiscoveredModels,
  };
}

/** Lists the Anthropic models the supplied key can reach. */
export async function listAnthropicModels(
  client: HostedDiscoveryClient,
  options?: ModelDiscoveryOptions,
): Promise<ModelCatalogue> {
  const provider: ProviderId = "anthropic";
  const apiKey = requireApiKey(provider, client.apiKey);
  const body = await getJson(
    provider,
    `${anthropicBaseUrl}/models?limit=${maximumDiscoveredModels}`,
    { "x-api-key": apiKey, "anthropic-version": anthropicVersion },
    client.fetch ?? globalThis.fetch,
    options,
  );
  const catalogue = parseModelList(provider, body);
  // Anthropic paginates. One page is deliberate — the cap is the point — so a
  // further page is reported as truncation rather than followed.
  const hasMore = isRecord(body) && body.has_more === true;
  return hasMore ? { ...catalogue, truncated: true } : catalogue;
}

/** Lists the OpenAI models the supplied key can reach. */
export async function listOpenAIModels(
  client: HostedDiscoveryClient,
  options?: ModelDiscoveryOptions,
): Promise<ModelCatalogue> {
  const provider: ProviderId = "openai";
  const apiKey = requireApiKey(provider, client.apiKey);
  const body = await getJson(
    provider,
    `${openaiBaseUrl}/models`,
    { authorization: `Bearer ${apiKey}` },
    client.fetch ?? globalThis.fetch,
    options,
  );
  return parseModelList(provider, body);
}

/**
 * Lists the models an OpenAI-compatible server on this machine reports.
 *
 * No credential is sent: a local server is reached because it is local, and a
 * key would be a secret leaving the app for a process we know nothing about.
 */
export async function listLocalModels(
  client: LocalDiscoveryClient,
  options?: ModelDiscoveryOptions,
): Promise<ModelCatalogue> {
  const provider: ProviderId = "local";
  const endpoint = client.endpoint.trim().replace(/\/+$/u, "");
  const body = await getJson(
    provider,
    `${endpoint}/models`,
    {},
    client.fetch ?? globalThis.fetch,
    options,
  );
  return parseModelList(provider, body);
}

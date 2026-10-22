import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

/** The one call the credential source needs from a Secret Manager client. */
export interface SecretVersionReader {
  readonly accessSecretVersion: (request: {
    readonly name: string;
  }) => Promise<
    readonly [
      { readonly payload?: { readonly data?: Uint8Array | string | null } | null },
      ...unknown[],
    ]
  >;
}

/** A provider key resolver, in the shape the application driver takes. */
export type CredentialResolver = (provider: string) => Promise<string | undefined>;

export class ProviderCredentialError extends Error {
  override readonly name = "ProviderCredentialError";
  readonly provider: string;

  constructor(provider: string) {
    // Content-free: neither the secret's value nor the client's error text is repeated.
    super(`The ${provider} key could not be read from Secret Manager.`);
    this.provider = provider;
  }
}

const versionPattern =
  /^projects\/[^/]+\/secrets\/[A-Za-z0-9_-]{1,255}\/versions\/(?:latest|[0-9]+)$/u;

export interface SecretManagerCredentialOptions {
  /**
   * The secret version of each provider's key, such as
   * `projects/<project>/secrets/<name>/versions/latest`. The names come from the deployment's
   * configuration, never from this repository. A provider not listed has no key here.
   */
  readonly secrets: Readonly<Record<string, string>>;
  readonly client?: SecretVersionReader;
  /** How long a key read stays in memory; a rotated key takes effect within it. Five minutes. */
  readonly ttlMs?: number;
  readonly now?: () => number;
}

interface CachedKey {
  readonly expiresAt: number;
  readonly value: Promise<string>;
}

function keyText(data: Uint8Array | string | null | undefined): string | undefined {
  if (data === null || data === undefined) return undefined;
  const text = (typeof data === "string" ? data : new TextDecoder().decode(data)).trim();
  return text === "" ? undefined : text;
}

/**
 * Reads provider keys from Secret Manager at call time (ADR 0011, D5 and D14), so they never sit
 * in an image or an environment file. Keys stay in memory for a short time, concurrent reads of
 * one key share one request, and a failed read is not cached. Vertex AI needs no key.
 */
export function createSecretManagerCredentialResolver(
  options: SecretManagerCredentialOptions,
): CredentialResolver {
  for (const name of Object.values(options.secrets)) {
    if (!versionPattern.test(name)) {
      throw new RangeError("Each provider key must name a Secret Manager secret version.");
    }
  }
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const now = options.now ?? Date.now;
  let client = options.client;
  const cache = new Map<string, CachedKey>();

  async function read(provider: string, name: string): Promise<string> {
    client ??= new SecretManagerServiceClient() as unknown as SecretVersionReader;
    let data: Uint8Array | string | null | undefined;
    try {
      const [response] = await client.accessSecretVersion({ name });
      data = response.payload?.data;
    } catch {
      throw new ProviderCredentialError(provider);
    }
    const value = keyText(data);
    if (value === undefined) throw new ProviderCredentialError(provider);
    return value;
  }

  return async (provider) => {
    const name = options.secrets[provider];
    if (name === undefined) return undefined;
    const at = now();
    const cached = cache.get(provider);
    if (cached !== undefined && cached.expiresAt > at) return cached.value;
    const value = read(provider, name);
    cache.set(provider, { expiresAt: at + ttlMs, value });
    try {
      return await value;
    } catch (error) {
      if (cache.get(provider)?.value === value) cache.delete(provider);
      throw error;
    }
  };
}

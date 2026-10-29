import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { CredentialResolver } from "./secret-credentials.js";

/** Where a self-hosted stack keeps provider keys: Docker's secrets mount. */
export const defaultSecretsDirectory = "/run/secrets";

export class ProviderKeyFileError extends Error {
  override readonly name = "ProviderKeyFileError";
  readonly provider: string;

  constructor(provider: string, reason: "unreadable" | "shared" | "empty") {
    // Content-free: neither the file's content nor the system's error text is repeated.
    super(
      reason === "shared"
        ? `The ${provider} key file is readable by other users; restrict it to its owner (chmod 600).`
        : reason === "empty"
          ? `The ${provider} key file is empty.`
          : `The ${provider} key file could not be read.`,
    );
    this.provider = provider;
  }
}

export interface FileCredentialOptions {
  /** An absolute directory holding one `<provider>_api_key` file per provider that has a key. */
  readonly directory: string;
  /** How long a key read stays in memory; a replaced file takes effect within it. Five minutes. */
  readonly ttlMs?: number;
  readonly now?: () => number;
}

interface CachedKey {
  readonly expiresAt: number;
  readonly value: Promise<string | undefined>;
}

const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/**
 * Reads provider keys from files at call time, for a self-hosted stack with no Secret Manager
 * (ADR 0011, D5 and D15): `<directory>/anthropic_api_key`, `<directory>/openai_api_key` and so on,
 * mounted as Docker secrets so a key is never in an image or the environment. A provider with no
 * file has no key. A file other users can read is refused rather than used, since the key would
 * already be exposed on the host. Keys stay in memory for a short time; a missing file and a
 * failed read are not cached.
 */
export function createFileCredentialResolver(options: FileCredentialOptions): CredentialResolver {
  if (options.directory.trim() === "" || !isAbsolute(options.directory)) {
    throw new RangeError("The provider key directory must be an absolute path.");
  }
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CachedKey>();

  async function read(provider: string): Promise<string | undefined> {
    const path = join(options.directory, `${provider}_api_key`);
    let content: string;
    try {
      // Others' read bit only: Docker Desktop and some hosts widen group bits on mounted files.
      if (((await stat(path)).mode & 0o004) !== 0) {
        throw new ProviderKeyFileError(provider, "shared");
      }
      content = await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof ProviderKeyFileError) throw error;
      if (isMissing(error)) return undefined;
      throw new ProviderKeyFileError(provider, "unreadable");
    }
    const value = content.trim();
    if (value === "") throw new ProviderKeyFileError(provider, "empty");
    return value;
  }

  return async (provider) => {
    if (!providerPattern.test(provider)) return undefined;
    const at = now();
    const cached = cache.get(provider);
    if (cached !== undefined && cached.expiresAt > at) return cached.value;
    const value = read(provider);
    cache.set(provider, { expiresAt: at + ttlMs, value });
    try {
      const key = await value;
      // A key file added later is read on the next call, not after the time to live.
      if (key === undefined && cache.get(provider)?.value === value) cache.delete(provider);
      return key;
    } catch (error) {
      if (cache.get(provider)?.value === value) cache.delete(provider);
      throw error;
    }
  };
}

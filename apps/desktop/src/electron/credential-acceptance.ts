import { writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";

import {
  type CredentialProtection,
  type CredentialProvider,
  credentialProviders,
} from "../bridge.js";
import { type NativeCredentialStore, resolveCredential } from "./host.js";

export type CredentialAcceptancePhase = "prepare" | "verify";

export interface CredentialAcceptanceOptions {
  readonly store: NativeCredentialStore;
  readonly phase: CredentialAcceptancePhase;
  readonly evidencePath: string;
  readonly appVersion: string;
  readonly safeStorageAvailable: boolean;
  readonly selectedStorageBackend: string | null;
  readonly credentials: Readonly<
    Record<
      CredentialProvider,
      { readonly initial: string; readonly replacement: string; readonly environment: string }
    >
  >;
}

function requireMatch(actual: unknown, expected: unknown, step: string): void {
  if (actual !== expected) throw new Error(`Credential acceptance failed at ${step}.`);
}

function requireAppProtection(value: CredentialProtection): void {
  if (!["os-backed", "basic-text", "local-aes-gcm"].includes(value)) {
    throw new Error("Credential acceptance did not report a persistent storage backend.");
  }
}

export async function runCredentialAcceptance(options: CredentialAcceptanceOptions): Promise<void> {
  process.env.ANTHROPIC_API_KEY = options.credentials.anthropic.environment;
  process.env.OPENAI_API_KEY = options.credentials.openai.environment;

  if (options.phase === "prepare") {
    for (const provider of credentialProviders) {
      const values = options.credentials[provider];
      const initialStatus = await options.store.status(provider);
      requireMatch(initialStatus.source, "env", `${provider} initial environment fallback`);
      requireMatch(
        await resolveCredential(options.store, provider),
        values.environment,
        `${provider} fallback use`,
      );

      requireMatch(await options.store.set(provider, values.initial), true, `${provider} set`);
      const appStatus = await options.store.status(provider);
      requireMatch(appStatus.source, "app", `${provider} app precedence`);
      requireAppProtection(appStatus.protection);
      requireMatch(
        await resolveCredential(options.store, provider),
        values.initial,
        `${provider} app use`,
      );

      requireMatch(
        await options.store.set(provider, values.replacement),
        true,
        `${provider} replace`,
      );
      requireMatch(
        await resolveCredential(options.store, provider),
        values.replacement,
        `${provider} replacement use`,
      );
    }
    return;
  }

  const protections = {} as Record<CredentialProvider, CredentialProtection>;
  for (const provider of credentialProviders) {
    const values = options.credentials[provider];
    const restarted = await options.store.status(provider);
    requireMatch(restarted.source, "app", `${provider} restart persistence`);
    requireAppProtection(restarted.protection);
    protections[provider] = restarted.protection;
    requireMatch(
      await resolveCredential(options.store, provider),
      values.replacement,
      `${provider} restart use`,
    );
    requireMatch(await options.store.remove(provider), true, `${provider} remove`);
    const removed = await options.store.status(provider);
    requireMatch(removed.source, "env", `${provider} post-removal environment fallback`);
    requireMatch(
      removed.protection,
      "environment",
      `${provider} environment protection projection`,
    );
    requireMatch(
      await resolveCredential(options.store, provider),
      values.environment,
      `${provider} post-removal environment use`,
    );
  }

  await writeFile(
    options.evidencePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        appVersion: options.appVersion,
        platform: platform(),
        osRelease: release(),
        architecture: arch(),
        electronSafeStorage: {
          available: options.safeStorageAvailable,
          selectedBackend: options.selectedStorageBackend,
        },
        protection: protections,
        checks: {
          set: true,
          status: true,
          restart: true,
          use: true,
          replace: true,
          remove: true,
          appPrecedence: true,
          environmentFallback: true,
        },
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

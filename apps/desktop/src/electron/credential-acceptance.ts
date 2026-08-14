import { writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";

import type { CredentialProtection } from "../bridge.js";
import { type NativeCredentialStore, resolveCredential } from "./host.js";

export type CredentialAcceptancePhase = "prepare" | "verify";

export interface CredentialAcceptanceOptions {
  readonly store: NativeCredentialStore;
  readonly phase: CredentialAcceptancePhase;
  readonly evidencePath: string;
  readonly appVersion: string;
  readonly initial: string;
  readonly replacement: string;
  readonly environment: string;
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
  process.env.ANTHROPIC_API_KEY = options.environment;

  if (options.phase === "prepare") {
    const initialStatus = await options.store.status("anthropic");
    requireMatch(initialStatus.source, "env", "initial environment fallback");
    requireMatch(
      await resolveCredential(options.store, "anthropic"),
      options.environment,
      "fallback use",
    );

    requireMatch(await options.store.set("anthropic", options.initial), true, "set");
    const appStatus = await options.store.status("anthropic");
    requireMatch(appStatus.source, "app", "app precedence");
    requireAppProtection(appStatus.protection);
    requireMatch(await resolveCredential(options.store, "anthropic"), options.initial, "app use");

    requireMatch(await options.store.set("anthropic", options.replacement), true, "replace");
    requireMatch(
      await resolveCredential(options.store, "anthropic"),
      options.replacement,
      "replacement use",
    );
    return;
  }

  const restarted = await options.store.status("anthropic");
  requireMatch(restarted.source, "app", "restart persistence");
  requireAppProtection(restarted.protection);
  requireMatch(
    await resolveCredential(options.store, "anthropic"),
    options.replacement,
    "restart use",
  );
  requireMatch(await options.store.remove("anthropic"), true, "remove");
  const removed = await options.store.status("anthropic");
  requireMatch(removed.source, "env", "post-removal environment fallback");
  requireMatch(removed.protection, "environment", "environment protection projection");
  requireMatch(
    await resolveCredential(options.store, "anthropic"),
    options.environment,
    "post-removal environment use",
  );

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
        protection: restarted.protection,
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

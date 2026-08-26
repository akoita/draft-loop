import { type FileHandle, mkdir, open, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  isProviderAuthMode,
  type ProviderAuthMode,
  type ProviderAuthModeConfiguration,
  resolveProviderAuthModes,
} from "@draft-loop/application";

const maximumPreferenceBytes = 4 * 1024;
const providerAuthModeProviders = ["anthropic", "openai"] as const;

export type ProviderAuthModeProvider = (typeof providerAuthModeProviders)[number];
export interface ProviderAuthModePreferences {
  readonly anthropic?: ProviderAuthMode | undefined;
  readonly openai?: ProviderAuthMode | undefined;
}

export const providerAuthModePreferenceFilename = "provider-auth-mode.json";

interface PersistedProviderAuthModePreference {
  readonly schemaVersion: 1;
  readonly modes: Readonly<Record<ProviderAuthModeProvider, ProviderAuthMode>>;
}

export interface ProviderAuthModePreferenceStore {
  readonly get: (provider: ProviderAuthModeProvider) => Promise<ProviderAuthMode | undefined>;
  readonly set: (provider: ProviderAuthModeProvider, mode: ProviderAuthMode) => Promise<void>;
}

export interface ProviderAuthModeEnvironmentValues {
  readonly shared?: string | undefined;
  readonly anthropic?: string | undefined;
  readonly openai?: string | undefined;
}

export interface ProviderAuthModeStartupResolution {
  readonly configuration: ProviderAuthModeConfiguration;
  readonly environmentOverrides: Readonly<Record<"anthropic" | "openai", boolean>>;
}

async function readBoundedText(filename: string): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filename, "r");
    const chunks: Buffer[] = [];
    let bytesReadTotal = 0;
    while (bytesReadTotal <= maximumPreferenceBytes) {
      const chunk = Buffer.alloc(Math.min(1024, maximumPreferenceBytes + 1 - bytesReadTotal));
      const result = await handle.read(chunk, 0, chunk.length, null);
      if (result.bytesRead === 0) break;
      chunks.push(chunk.subarray(0, result.bytesRead));
      bytesReadTotal += result.bytesRead;
      if (bytesReadTotal > maximumPreferenceBytes) return undefined;
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

function parsePreference(
  value: unknown,
): Readonly<Record<ProviderAuthModeProvider, ProviderAuthMode>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || record.schemaVersion !== 1) return undefined;
  const modes = record.modes;
  if (typeof modes !== "object" || modes === null || Array.isArray(modes)) return undefined;
  const modeRecord = modes as Record<string, unknown>;
  if (
    Object.keys(modeRecord).length !== providerAuthModeProviders.length ||
    !providerAuthModeProviders.every((provider) => provider in modeRecord) ||
    !providerAuthModeProviders.every((provider) => isProviderAuthMode(modeRecord[provider]))
  ) {
    return undefined;
  }
  return {
    anthropic: modeRecord.anthropic as ProviderAuthMode,
    openai: modeRecord.openai as ProviderAuthMode,
  };
}

function validateMode(mode: unknown): ProviderAuthMode {
  if (!isProviderAuthMode(mode)) {
    throw new Error("Unsupported provider authentication mode.");
  }
  return mode;
}

function validateProvider(provider: unknown): ProviderAuthModeProvider {
  if (
    typeof provider !== "string" ||
    !providerAuthModeProviders.includes(provider as ProviderAuthModeProvider)
  ) {
    throw new Error("Unsupported provider for authentication mode preference.");
  }
  return provider as ProviderAuthModeProvider;
}

export function createProviderAuthModePreferenceStore(
  filename: string,
): ProviderAuthModePreferenceStore {
  const readPreference = async (): Promise<
    Readonly<Record<ProviderAuthModeProvider, ProviderAuthMode>> | undefined
  > => {
    const text = await readBoundedText(filename);
    if (text === undefined) return undefined;
    try {
      return parsePreference(JSON.parse(text));
    } catch {
      return undefined;
    }
  };

  return {
    get: async (provider) => (await readPreference())?.[validateProvider(provider)],
    set: async (provider, mode) => {
      const validatedProvider = validateProvider(provider);
      const validated = validateMode(mode);
      const current = await readPreference();
      const value: PersistedProviderAuthModePreference = {
        schemaVersion: 1,
        modes: {
          anthropic: current?.anthropic ?? "api-key",
          openai: current?.openai ?? "api-key",
          [validatedProvider]: validated,
        },
      };
      await mkdir(dirname(filename), { recursive: true });
      await writeFile(filename, `${JSON.stringify(value)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    },
  };
}

export function createMemoryProviderAuthModePreferenceStore(
  initial: ProviderAuthModePreferences = {},
): ProviderAuthModePreferenceStore {
  let modes: ProviderAuthModePreferences = { ...initial };
  return {
    get: async (provider) => modes[validateProvider(provider)],
    set: async (provider, next) => {
      const validatedProvider = validateProvider(provider);
      modes = { ...modes, [validatedProvider]: validateMode(next) };
    },
  };
}

/**
 * Applies the desktop startup precedence without changing the application
 * driver's provider-mode contract: provider-specific env, shared env, saved
 * preference, then the API-key default.
 */
export function resolveProviderAuthModeStartup(
  environment: ProviderAuthModeEnvironmentValues,
  persistedModes: ProviderAuthModePreferences,
): ProviderAuthModeStartupResolution {
  const shared = environment.shared;
  const resolveProvider = (
    provider: ProviderAuthModeProvider,
    providerValue: string | undefined,
    persistedMode: ProviderAuthMode | undefined,
  ): ProviderAuthMode =>
    resolveProviderAuthModes(providerValue ?? shared ?? persistedMode)[provider];
  return {
    configuration: {
      anthropic: resolveProvider("anthropic", environment.anthropic, persistedModes.anthropic),
      openai: resolveProvider("openai", environment.openai, persistedModes.openai),
    },
    environmentOverrides: {
      anthropic: environment.shared !== undefined || environment.anthropic !== undefined,
      openai: environment.shared !== undefined || environment.openai !== undefined,
    },
  };
}

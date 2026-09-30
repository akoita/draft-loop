import {
  listModelProfileRouteSupport,
  type ModelProfileReferences,
  type ModelProfileRouteSupport,
  type RunProviderAuthModeConfiguration,
} from "@draft-loop/application/model-profile-selection";

export interface ModelProfileSupportInput {
  readonly workspaceId: string;
}

export interface ModelProfileSupportResult {
  readonly workspaceId: string;
  readonly authModes: RunProviderAuthModeConfiguration;
  readonly profiles: readonly ModelProfileRouteSupport[];
}

/** Fixed bridge-boundary failure that safeBridgeError maps to invalid-input. */
export class ModelProfileBridgeValidationError extends Error {
  readonly code = "invalid-input" as const;

  constructor() {
    super("The model profile bridge payload is invalid.");
    this.name = "ModelProfileBridgeValidationError";
  }
}

const authModes = ["api-key", "user-session"] as const;
const maximumProfileIdentifierLength = 128;
const maximumProfileSupportEntries = 256;

function invalidInput(): never {
  throw new ModelProfileBridgeValidationError();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const parsed = record(value);
  if (parsed === undefined || Object.keys(parsed).some((key) => !keys.includes(key))) {
    return invalidInput();
  }
  return parsed;
}

function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim() ||
    value.length > maximumProfileIdentifierLength ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
    })
  ) {
    return invalidInput();
  }
  return value;
}

function safeVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return invalidInput();
  }
  return value;
}

function mode(value: unknown): RunProviderAuthModeConfiguration["anthropic"] {
  if (value !== authModes[0] && value !== authModes[1]) return invalidInput();
  return value;
}

export function parseModelProfileReferences(value: unknown): ModelProfileReferences {
  const refs = exactRecord(value, ["author", "critic"]);
  const parseReference = (reference: unknown) => {
    const fields = exactRecord(reference, ["id", "version"]);
    return { id: identifier(fields.id), version: safeVersion(fields.version) };
  };
  return { author: parseReference(refs.author), critic: parseReference(refs.critic) };
}

export function parseModelProfileSupportInput(value: unknown): ModelProfileSupportInput {
  const input = exactRecord(value, ["workspaceId"]);
  return { workspaceId: identifier(input.workspaceId) };
}

export function projectModelProfileSupport(
  workspaceId: string,
  configuredAuthModes: RunProviderAuthModeConfiguration,
): ModelProfileSupportResult {
  return {
    workspaceId: identifier(workspaceId),
    authModes: {
      anthropic: mode(configuredAuthModes.anthropic),
      openai: mode(configuredAuthModes.openai),
    },
    profiles: listModelProfileRouteSupport(configuredAuthModes).map(
      ({ id, version, supported }) => ({
        id: identifier(id),
        version: safeVersion(version),
        supported,
      }),
    ),
  };
}

export function parseModelProfileSupportResult(
  value: unknown,
  expectedWorkspaceId?: string,
): ModelProfileSupportResult {
  const result = exactRecord(value, ["workspaceId", "authModes", "profiles"]);
  const workspaceId = identifier(result.workspaceId);
  if (expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId)
    return invalidInput();

  const modes = exactRecord(result.authModes, ["anthropic", "openai"]);
  if (
    !Array.isArray(result.profiles) ||
    result.profiles.length === 0 ||
    result.profiles.length > maximumProfileSupportEntries
  ) {
    return invalidInput();
  }
  const seen = new Set<string>();
  const profiles = result.profiles.map((entry) => {
    const profile = exactRecord(entry, ["id", "version", "supported"]);
    const id = identifier(profile.id);
    const version = safeVersion(profile.version);
    if (typeof profile.supported !== "boolean") return invalidInput();
    const key = `${id}@${version}`;
    if (seen.has(key)) return invalidInput();
    seen.add(key);
    return { id, version, supported: profile.supported };
  });

  return {
    workspaceId,
    authModes: { anthropic: mode(modes.anthropic), openai: mode(modes.openai) },
    profiles,
  };
}

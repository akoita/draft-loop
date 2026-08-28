import {
  type BridgeCommand,
  type BridgeResult,
  bridgeCapabilities,
  bridgeError,
  type CapabilityPort,
  createCapabilityPort,
  type ModelCandidate,
  type ModelCompany,
  type ModelDiscoveryProvider,
  type ModelsListResult,
  type ModelsPreviewIndependenceResult,
  type NativeBridge,
  type OpportunityCreateInput,
  type OpportunityEditInput,
  type OpportunityListResult,
  type OpportunityRecordResult,
  type ProviderAuthMode,
  type ProviderAuthModeResult,
  type ProviderAuthModeStatus,
  type WorkspaceCreateInput,
} from "./bridge.js";
import {
  createFixtureReviewPort,
  type DesktopReviewPort,
  type DesktopReviewState,
  type ReviewAction,
} from "./model.js";

export type { NativeBridge } from "./bridge.js";

/**
 * What a person chose for a workspace before it existed.
 *
 * A subset of `WorkspaceCreateInput`, holding only the fields the setup form
 * collects. Every field is optional and an omitted one keeps the workspace
 * default, so a caller that names nothing still creates the workspace the
 * single create button always created.
 */
export interface WorkspaceModelSelection {
  readonly authorCompany?: ModelCompany;
  readonly authorModel?: string;
  readonly criticCompany?: ModelCompany;
  readonly criticModel?: string;
  readonly localEndpoint?: string;
  readonly independenceOverrideRationale?: string;
  readonly maxRounds?: number;
}

/**
 * The setup form's own view of a port: choosing models, and asking about them.
 *
 * `createWorkspace` is widened here rather than in `DesktopReviewPort` so that
 * a fixture port written against the narrower signature stays assignable; a
 * function that ignores the second argument satisfies one that offers it.
 * `listModels` and `previewIndependence` are present only when the host
 * actually offers the capability, so an absent one is a fact the form can
 * report rather than a call that fails later.
 */
export interface WorkspaceSetupCapabilities {
  readonly createWorkspace?: (
    name: string,
    selection?: WorkspaceModelSelection,
  ) => Promise<DesktopReviewState>;
  readonly listModels?: (provider: ModelDiscoveryProvider) => Promise<ModelsListResult>;
  readonly previewIndependence?: (
    author: ModelCandidate,
    critic: ModelCandidate,
  ) => Promise<ModelsPreviewIndependenceResult>;
}

export interface DesktopOpportunityCapabilities {
  readonly createOpportunity?: (
    input: Omit<OpportunityCreateInput, "workspaceId">,
  ) => Promise<OpportunityRecordResult>;
  readonly getOpportunity?: (briefId: string, version?: number) => Promise<OpportunityRecordResult>;
  readonly listOpportunityVersions?: (briefId: string) => Promise<OpportunityListResult>;
  readonly editOpportunity?: (
    input: Omit<OpportunityEditInput, "workspaceId">,
  ) => Promise<OpportunityRecordResult>;
  readonly reviewOpportunity?: (
    briefId: string,
    expectedVersion: number,
  ) => Promise<OpportunityRecordResult>;
}

export type DesktopSetupPort = Omit<DesktopReviewPort, "createWorkspace"> &
  WorkspaceSetupCapabilities &
  DesktopOpportunityCapabilities & {
    readonly getProviderAuthModeStatus?: (
      provider: "anthropic" | "openai",
    ) => Promise<ProviderAuthModeStatus>;
    readonly setProviderAuthMode?: (
      provider: "anthropic" | "openai",
      mode: ProviderAuthMode,
    ) => Promise<ProviderAuthModeResult>;
  };

/**
 * Fills `workspace.create` in from a form's strings.
 *
 * A field left blank means "keep the workspace default", so a blank is dropped
 * rather than sent as an empty string the boundary would refuse. Trimming
 * happens here because a person typing a model id into a form leaves spaces
 * behind and the boundary's `modelId` rule does not forgive them.
 */
export function workspaceCreateInput(
  name: string,
  selection?: WorkspaceModelSelection,
): WorkspaceCreateInput {
  const named = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? undefined : trimmed;
  };
  const authorModel = named(selection?.authorModel);
  const criticModel = named(selection?.criticModel);
  const localEndpoint = named(selection?.localEndpoint);
  const rationale = named(selection?.independenceOverrideRationale);
  return {
    name: name.trim(),
    mode: "real",
    ...(selection?.authorCompany === undefined ? {} : { authorCompany: selection.authorCompany }),
    ...(authorModel === undefined ? {} : { authorModel }),
    ...(selection?.criticCompany === undefined ? {} : { criticCompany: selection.criticCompany }),
    ...(criticModel === undefined ? {} : { criticModel }),
    ...(localEndpoint === undefined ? {} : { localEndpoint }),
    ...(rationale === undefined ? {} : { independenceOverrideRationale: rationale }),
    ...(selection?.maxRounds === undefined ? {} : { maxRounds: selection.maxRounds }),
  };
}

/**
 * Browser mode is intentionally capability-empty. It does not emulate a file
 * picker with browser filesystem APIs and it never accepts arbitrary paths.
 */
export function createBrowserNativeBridge(): NativeBridge {
  return Object.freeze({
    capabilities: Object.freeze([]),
    invoke: async (command: BridgeCommand): Promise<BridgeResult<unknown>> => ({
      ok: false,
      error: bridgeError("capability-unavailable", command.type),
    }),
  });
}

export function createNativeCapabilityPort(nativeBridge: NativeBridge): CapabilityPort {
  return createCapabilityPort(nativeBridge);
}

/** A deterministic, capability-empty port for the Vite/browser shell. */
export function createBrowserCapabilityPort(): CapabilityPort {
  return createCapabilityPort(createBrowserNativeBridge());
}

export class DesktopBridgeError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopBridgeError";
    this.code = code;
  }
}

function unwrap<Value>(result: BridgeResult<Value>): Value {
  if (result.ok) return result.value;
  throw new DesktopBridgeError(result.error.code, result.error.message);
}

export function createBridgeReviewPort(capabilityPort: CapabilityPort): DesktopSetupPort {
  const load = async (): Promise<DesktopReviewState> => {
    const result = await capabilityPort.execute({ type: "review.load", input: {} });
    return unwrap(result);
  };
  const ensureRun = async (workspaceId: string): Promise<DesktopReviewState> => {
    const status = unwrap(
      await capabilityPort.execute({ type: "run.status", input: { workspaceId } }),
    );
    if (status.runId === null) {
      unwrap(await capabilityPort.execute({ type: "run.start", input: { workspaceId } }));
    }
    return load();
  };
  const refresh = async (): Promise<DesktopReviewState> => load();
  return {
    load,
    openWorkspace: async () => {
      unwrap(
        await capabilityPort.execute({
          type: "workspace.open",
          input: { selection: "native-dialog" },
        }),
      );
      return refresh();
    },
    createWorkspace: async (name, selection) => {
      unwrap(
        await capabilityPort.execute({
          type: "workspace.create",
          input: workspaceCreateInput(name, selection),
        }),
      );
      return refresh();
    },
    createDemoWorkspace: async (name) => {
      const result = unwrap(
        await capabilityPort.execute({ type: "workspace.create", input: { name, mode: "demo" } }),
      );
      return ensureRun(result.workspace.id);
    },
    selectFiles: async (target) => {
      const state = await load();
      unwrap(
        await capabilityPort.execute({
          type: "file.select",
          input: {
            workspaceId: state.workspaceId,
            target,
            ...(target === "job-description" ||
            target === "writing-policy" ||
            target === "writing-policy-override"
              ? { multiple: false }
              : {}),
            ...(target === "writing-policy" || target === "writing-policy-override"
              ? { extensions: [".md", ".markdown", ".txt", ".text"] as const }
              : {}),
          },
        }),
      );
      return refresh();
    },
    addUrl: async (target, url) => {
      const state = await load();
      unwrap(
        await capabilityPort.execute({
          type: "source.add-url",
          input: { workspaceId: state.workspaceId, target, url, approved: true },
        }),
      );
      return refresh();
    },
    dispatch: async (state: DesktopReviewState, action: ReviewAction) => {
      const result = await capabilityPort.execute({
        type: "review.dispatch",
        input: { workspaceId: state.workspaceId, runId: state.runId, action },
      });
      return unwrap(result);
    },
    getCredentialStatus: async (provider) => {
      const result = await capabilityPort.execute({
        type: "credential.status",
        input: { provider },
      });
      return unwrap(result);
    },
    setCredential: async (provider, apiKey) => {
      const result = await capabilityPort.execute({
        type: "credential.set",
        input: { provider, apiKey },
      });
      return unwrap(result);
    },
    removeCredential: async (provider) => {
      const result = await capabilityPort.execute({
        type: "credential.remove",
        input: { provider },
      });
      return unwrap(result);
    },
    ...(capabilityPort.hasCapability("provider-auth.status")
      ? {
          getProviderAuthModeStatus: async (provider: "anthropic" | "openai") =>
            unwrap(
              await capabilityPort.execute({
                type: "provider-auth.status",
                input: { provider },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("provider-auth.set")
      ? {
          setProviderAuthMode: async (provider: "anthropic" | "openai", mode: ProviderAuthMode) =>
            unwrap(
              await capabilityPort.execute({
                type: "provider-auth.set",
                input: { provider, mode },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("models.list")
      ? {
          listModels: async (provider: ModelDiscoveryProvider) =>
            unwrap(await capabilityPort.execute({ type: "models.list", input: { provider } })),
        }
      : {}),
    ...(capabilityPort.hasCapability("models.preview-independence")
      ? {
          previewIndependence: async (author: ModelCandidate, critic: ModelCandidate) =>
            unwrap(
              await capabilityPort.execute({
                type: "models.preview-independence",
                input: { author, critic },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.create")
      ? {
          createOpportunity: async (input: Omit<OpportunityCreateInput, "workspaceId">) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.create",
                input: { workspaceId: state.workspaceId, ...input },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.get")
      ? {
          getOpportunity: async (briefId: string, version?: number) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.get",
                input: {
                  workspaceId: state.workspaceId,
                  briefId,
                  ...(version === undefined ? {} : { version }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.list")
      ? {
          listOpportunityVersions: async (briefId: string) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.list",
                input: { workspaceId: state.workspaceId, briefId },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.edit")
      ? {
          editOpportunity: async (input: Omit<OpportunityEditInput, "workspaceId">) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.edit",
                input: { workspaceId: state.workspaceId, ...input },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.review")
      ? {
          reviewOpportunity: async (briefId: string, expectedVersion: number) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.review",
                input: { workspaceId: state.workspaceId, briefId, expectedVersion },
              }),
            );
          },
        }
      : {}),
  };
}

/** Uses a host-backed review port when available and a fixture only in browser mode. */
export function createDesktopReviewPort(): DesktopSetupPort {
  const capabilityPort = createNativeCapabilityPort(getNativeBridge());
  return capabilityPort.hasCapability("review.load") &&
    capabilityPort.hasCapability("review.dispatch")
    ? createBridgeReviewPort(capabilityPort)
    : createFixtureReviewPort();
}

const nativeBridgeGlobalKey = "__DRAFT_LOOP_NATIVE_BRIDGE__";

function isNativeBridge(value: unknown): value is NativeBridge {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    readonly capabilities?: unknown;
    readonly invoke?: unknown;
  };
  if (!Array.isArray(candidate.capabilities) || typeof candidate.invoke !== "function") {
    return false;
  }
  return candidate.capabilities.every((capability) =>
    (bridgeCapabilities as readonly string[]).includes(capability as string),
  );
}

/**
 * Resolves an optional host-injected bridge, falling back to browser mode.
 * The Electron preload installs a NativeBridge at this key after the host has
 * applied its permission, filesystem-scope, and user-gesture checks.
 */
export function getNativeBridge(): NativeBridge {
  const candidate = (globalThis as Record<string, unknown>)[nativeBridgeGlobalKey];
  return isNativeBridge(candidate) ? candidate : createBrowserNativeBridge();
}

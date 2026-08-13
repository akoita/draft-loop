import {
  type BridgeCommand,
  type BridgeResult,
  bridgeCapabilities,
  bridgeError,
  type CapabilityPort,
  createCapabilityPort,
  type NativeBridge,
} from "./bridge.js";
import {
  createFixtureReviewPort,
  type DesktopReviewPort,
  type DesktopReviewState,
  type ReviewAction,
} from "./model.js";

export type { NativeBridge } from "./bridge.js";

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

export function createBridgeReviewPort(capabilityPort: CapabilityPort): DesktopReviewPort {
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
    createWorkspace: async (name) => {
      unwrap(
        await capabilityPort.execute({ type: "workspace.create", input: { name, mode: "real" } }),
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
            ...(target === "job-description" ? { multiple: false } : {}),
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
  };
}

/** Uses a host-backed review port when available and a fixture only in browser mode. */
export function createDesktopReviewPort(): DesktopReviewPort {
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

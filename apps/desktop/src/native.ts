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
  return {
    load: async () => {
      const result = await capabilityPort.execute({ type: "review.load", input: {} });
      return unwrap(result);
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
 * A future Electron/Tauri preload may install a NativeBridge at this key after
 * applying its own host-side permission and user-gesture checks.
 */
export function getNativeBridge(): NativeBridge {
  const candidate = (globalThis as Record<string, unknown>)[nativeBridgeGlobalKey];
  return isNativeBridge(candidate) ? candidate : createBrowserNativeBridge();
}

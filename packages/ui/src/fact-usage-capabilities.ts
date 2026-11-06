/**
 * What the profile can do with usage levels, built from the capability port only when the host
 * offers both commands. A host without them gets no usage controls.
 */
import type { BridgeResult, CapabilityPort } from "./bridge.js";
import type { FactUsageChangeView, FactUsageView } from "./fact-usage-contract.js";

export interface FactUsageCapabilities {
  readonly getFactUsage: (workspaceId: string) => Promise<FactUsageView>;
  /** Sets or clears one level; resolves with every level after the change. */
  readonly setFactUsage: (
    workspaceId: string,
    change: FactUsageChangeView,
  ) => Promise<FactUsageView>;
}

export function createFactUsageCapabilities(
  port: CapabilityPort,
  unwrap: <Value>(result: BridgeResult<Value>) => Value,
): FactUsageCapabilities | undefined {
  if (!port.hasCapability("fact-usage.get") || !port.hasCapability("fact-usage.set")) {
    return undefined;
  }
  return {
    getFactUsage: async (workspaceId) =>
      unwrap(await port.execute({ type: "fact-usage.get", input: { workspaceId } })).usage,
    setFactUsage: async (workspaceId, change) =>
      unwrap(await port.execute({ type: "fact-usage.set", input: { workspaceId, change } })).usage,
  };
}

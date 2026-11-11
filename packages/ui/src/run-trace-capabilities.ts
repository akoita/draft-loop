/**
 * Reading a run's trace, built from the capability port only when the host offers the command.
 * A host without it gets no Steps section in Run details.
 */
import type { BridgeResult, CapabilityPort } from "./bridge.js";
import type { RunTraceSpanView } from "./run-trace-contract.js";

export interface RunTraceCapabilities {
  /** The run's spans in start order; empty for a run that recorded none. */
  readonly getRunTrace: (
    workspaceId: string,
    runId: string,
  ) => Promise<readonly RunTraceSpanView[]>;
}

export function createRunTraceCapabilities(
  port: CapabilityPort,
  unwrap: <Value>(result: BridgeResult<Value>) => Value,
): RunTraceCapabilities | undefined {
  if (!port.hasCapability("run.trace")) return undefined;
  return {
    getRunTrace: async (workspaceId, runId) =>
      unwrap(await port.execute({ type: "run.trace", input: { workspaceId, runId } })).spans,
  };
}

/**
 * Reading a run's requirement evidence, built from the capability port only when the host offers
 * the command. A host without it gets no "Evidence for each requirement" section in Run details.
 */
import type { BridgeResult, CapabilityPort } from "./bridge.js";
import type { RunRequirementEvidenceView } from "./run-requirement-evidence-contract.js";

export interface RunRequirementEvidenceCapabilities {
  /** The run's map; null when the run recorded none. */
  readonly getRunRequirementEvidence: (
    workspaceId: string,
    runId: string,
  ) => Promise<RunRequirementEvidenceView | null>;
}

export function createRunRequirementEvidenceCapabilities(
  port: CapabilityPort,
  unwrap: <Value>(result: BridgeResult<Value>) => Value,
): RunRequirementEvidenceCapabilities | undefined {
  if (!port.hasCapability("run.requirement-evidence")) return undefined;
  return {
    getRunRequirementEvidence: async (workspaceId, runId) =>
      unwrap(
        await port.execute({ type: "run.requirement-evidence", input: { workspaceId, runId } }),
      ).evidence,
  };
}

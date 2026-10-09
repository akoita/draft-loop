import type { ManagedCandidateKnowledgeWriteInterruptionBoundary } from "./knowledge-store-types.js";

/** The failure a test-only interruption boundary raises inside a managed write. */
export class SimulatedManagedWriteInterruption extends Error {
  public constructor(boundary: ManagedCandidateKnowledgeWriteInterruptionBoundary) {
    super(`Simulated managed candidate knowledge write interruption at ${boundary}.`);
    this.name = "SimulatedManagedWriteInterruption";
  }
}

export async function interruptManagedWriteAt(
  input: {
    readonly interruptAt?: ManagedCandidateKnowledgeWriteInterruptionBoundary;
  },
  boundary: ManagedCandidateKnowledgeWriteInterruptionBoundary,
): Promise<void> {
  if (input.interruptAt === boundary) {
    throw new SimulatedManagedWriteInterruption(boundary);
  }
}

export const workflowStates = [
  "collecting",
  "ingesting",
  "drafting",
  "reviewing",
  "revising",
  "awaiting-approval",
  "approved",
  "exported",
  "paused",
  "stopped",
  "budget-exhausted",
] as const;

export type WorkflowState = (typeof workflowStates)[number];

export interface Workspace {
  readonly id: string;
  readonly state: WorkflowState;
}

export function createWorkspace(id: string): Workspace {
  if (id.trim() === "") {
    throw new Error("A workspace id is required.");
  }

  return { id, state: "collecting" };
}

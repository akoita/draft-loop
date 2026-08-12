import type { Workspace } from "@draft-loop/domain";
import type { WorkspaceInput } from "@draft-loop/schemas";

export interface OrchestrationRequest {
  readonly workspace: Workspace;
  readonly input: WorkspaceInput;
  readonly maxRounds: number;
}

export interface OrchestrationPort {
  readonly run: (request: OrchestrationRequest) => Promise<never>;
}

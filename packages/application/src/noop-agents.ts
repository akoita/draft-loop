import type { AuthorAgent, CriticAgent } from "@draft-loop/orchestrator";

import { CliUserError } from "./cli-user-error.js";

/** Agents for commands that open the engine without running a model. */
export function noopAgents(): { readonly author: AuthorAgent; readonly critic: CriticAgent } {
  return {
    author: {
      execute: async () => {
        throw new CliUserError("This command does not execute the author.");
      },
    },
    critic: {
      execute: async () => {
        throw new CliUserError("This command does not execute the critic.");
      },
    },
  };
}

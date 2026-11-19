/**
 * What the profile can do with suggested updates (#3069), built from the capability port only
 * when the host offers all three commands. A host without them gets no Suggested updates box.
 */
import type { BridgeResult, CapabilityPort } from "./bridge.js";
import type {
  FactSuggestionAcceptItem,
  FactSuggestionAcceptResult,
  FactSuggestionListResult,
} from "./fact-suggestions-contract.js";

export interface FactSuggestionCapabilities {
  readonly listFactSuggestions: (
    workspaceId: string,
    profileId: string,
  ) => Promise<FactSuggestionListResult>;
  readonly acceptFactSuggestions: (
    workspaceId: string,
    profileId: string,
    items: readonly FactSuggestionAcceptItem[],
  ) => Promise<FactSuggestionAcceptResult>;
  readonly rejectFactSuggestion: (
    workspaceId: string,
    profileId: string,
    suggestionId: string,
  ) => Promise<void>;
}

export const factSuggestionCommands = [
  "fact-suggestions.list",
  "fact-suggestions.accept",
  "fact-suggestions.reject",
] as const;

export function createFactSuggestionCapabilities(
  port: CapabilityPort,
  unwrap: <Value>(result: BridgeResult<Value>) => Value,
): FactSuggestionCapabilities | undefined {
  if (!factSuggestionCommands.every((command) => port.hasCapability(command))) return undefined;
  return {
    listFactSuggestions: async (workspaceId, profileId) =>
      unwrap(
        await port.execute({ type: "fact-suggestions.list", input: { workspaceId, profileId } }),
      ),
    acceptFactSuggestions: async (workspaceId, profileId, items) =>
      unwrap(
        await port.execute({
          type: "fact-suggestions.accept",
          input: { workspaceId, profileId, items },
        }),
      ),
    rejectFactSuggestion: async (workspaceId, profileId, suggestionId) => {
      unwrap(
        await port.execute({
          type: "fact-suggestions.reject",
          input: { workspaceId, profileId, suggestionId },
        }),
      );
    },
  };
}

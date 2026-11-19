import type { BridgeCommand } from "@draft-loop/ui/bridge";

import type { ApiClient } from "./api-client.js";

/** The suggested profile update commands the hosted service serves (#3069). */
export const hostedFactSuggestionCapabilities = [
  "fact-suggestions.list",
  "fact-suggestions.accept",
  "fact-suggestions.reject",
] as const;

type FactSuggestionCommandType = (typeof hostedFactSuggestionCapabilities)[number];
export type FactSuggestionCommand = Extract<BridgeCommand, { type: FactSuggestionCommandType }>;

export function isFactSuggestionCommand(command: BridgeCommand): command is FactSuggestionCommand {
  return (hostedFactSuggestionCapabilities as readonly string[]).includes(command.type);
}

type FactSuggestionChange = NonNullable<
  Extract<
    FactSuggestionCommand,
    { type: "fact-suggestions.accept" }
  >["input"]["items"][number]["edit"]
>;

/** The change as the API takes it: an absent subject is left out, never sent as undefined. */
function apiChange(change: FactSuggestionChange) {
  if (change.kind !== "add") return change;
  const { subjectId, ...rest } = change;
  return subjectId === undefined ? rest : { ...rest, subjectId };
}

/** Answers the suggested update commands over `/profiles/{profileId}/suggestions`. */
export function createFactSuggestionAnswers(client: ApiClient) {
  return async (command: FactSuggestionCommand): Promise<unknown> => {
    const { workspaceId, profileId } = command.input;
    switch (command.type) {
      case "fact-suggestions.list": {
        const listed = await client.call(
          "GET /v1/workspaces/{workspaceId}/profiles/{profileId}/suggestions",
          { path: { workspaceId, profileId }, query: { status: "pending", limit: 200 } },
        );
        return {
          workspaceId,
          profileId,
          pending: listed.pending,
          suggestions: listed.suggestions.map((suggestion) => ({
            id: suggestion.id,
            profileId: suggestion.profileId,
            change: suggestion.change,
            ...(suggestion.target === undefined ? {} : { target: suggestion.target }),
            quote: suggestion.quote,
            speaker: suggestion.speaker,
            origin: {
              kind: suggestion.origin.kind,
              ...(suggestion.origin.applicationId === undefined
                ? {}
                : { applicationId: suggestion.origin.applicationId }),
              ...(suggestion.origin.round === undefined ? {} : { round: suggestion.origin.round }),
            },
            status: suggestion.status,
            createdAt: suggestion.createdAt,
          })),
        };
      }
      case "fact-suggestions.accept":
        return client.call(
          "POST /v1/workspaces/{workspaceId}/profiles/{profileId}/suggestions/accept",
          {
            path: { workspaceId, profileId },
            body: {
              items: command.input.items.map((item) =>
                item.edit === undefined
                  ? { id: item.id }
                  : { id: item.id, edit: apiChange(item.edit) },
              ),
            },
          },
        );
      case "fact-suggestions.reject": {
        const { suggestionId } = command.input;
        await client.call(
          "POST /v1/workspaces/{workspaceId}/profiles/{profileId}/suggestions/{suggestionId}/reject",
          { path: { workspaceId, profileId, suggestionId } },
        );
        return { suggestionId };
      }
    }
  };
}

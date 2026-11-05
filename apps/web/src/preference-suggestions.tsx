import {
  type PreferenceDecision,
  PreferenceSuggestionsPanel,
  type PreferenceSuggestionView,
} from "@draft-loop/ui/preference-suggestions-panel";
import { useCallback, useEffect, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import { useRecordId } from "./record-context.js";

/** Sends one decision to its route; resolves with a problem to show, or undefined once saved. */
export async function decidePreferenceSuggestion(
  client: Pick<ApiClient, "call">,
  workspaceId: string,
  suggestionId: string,
  decision: PreferenceDecision,
): Promise<string | undefined> {
  try {
    const path = { workspaceId, suggestionId };
    if (decision === "accept") {
      await client.call(
        "POST /v1/workspaces/{workspaceId}/preference-suggestions/{suggestionId}/accept",
        { path },
      );
    } else {
      await client.call(
        "POST /v1/workspaces/{workspaceId}/preference-suggestions/{suggestionId}/dismiss",
        { path },
      );
    }
    return undefined;
  } catch (error) {
    return `The preference could not be saved. ${describeError(error)}`;
  }
}

export interface PreferenceSuggestionsSectionProps {
  readonly client: ApiClient;
}

/**
 * The web host's suggested preferences (#2265): reads them through the API and sends each
 * decision to its route. A failed read shows nothing; the policy itself is unaffected.
 */
export function PreferenceSuggestionsSection({ client }: PreferenceSuggestionsSectionProps) {
  const workspaceId = useRecordId();
  const [suggestions, setSuggestions] = useState<readonly PreferenceSuggestionView[] | undefined>(
    undefined,
  );

  const reload = useCallback(async () => {
    try {
      const listed = await client.call("GET /v1/workspaces/{workspaceId}/preference-suggestions", {
        path: { workspaceId },
      });
      setSuggestions(listed.suggestions);
    } catch {
      setSuggestions(undefined);
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const decide = async (suggestionId: string, decision: PreferenceDecision) => {
    const problem = await decidePreferenceSuggestion(client, workspaceId, suggestionId, decision);
    if (problem === undefined) await reload();
    return problem;
  };

  return <PreferenceSuggestionsPanel suggestions={suggestions} onDecide={decide} />;
}

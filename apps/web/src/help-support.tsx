import { HelpButton, type HelpSupport } from "@draft-loop/ui/help-panel";
import { useContext, useMemo } from "react";

import type { ApiClient } from "./api-client.js";
import { RecordContext } from "./record-context.js";

/**
 * The support assistant's routes for the Help panel (#2883), on the record the screen shows.
 * Only sign-in mode hands a conversation to a person: owner-token mode has no organisation.
 */
export function webHelpSupport(
  client: ApiClient,
  workspaceId: string,
  mode: "owner" | "sign-in",
): HelpSupport {
  const path = { workspaceId };
  return {
    start: async () => {
      const opened = await client.call("POST /v1/workspaces/{workspaceId}/support/conversations", {
        path,
      });
      return {
        conversationId: opened.conversation_id,
        assistantAvailable: opened.assistant_available,
      };
    },
    ask: async ({ conversationId, question, language, history }) => {
      const reply = await client.call(
        "POST /v1/workspaces/{workspaceId}/support/conversations/{conversationId}/messages",
        {
          path: { ...path, conversationId },
          body: { question, language, history: [...history] },
        },
      );
      return {
        mode: reply.mode,
        outcome: reply.outcome,
        text: reply.text,
        sections: reply.sections.map(({ id, title }) => ({ id, title })),
      };
    },
    ...(mode === "sign-in"
      ? {
          handoff: async ({ conversationId, transcript }) => {
            await client.call(
              "POST /v1/workspaces/{workspaceId}/support/conversations/{conversationId}/handoff",
              {
                path: { ...path, conversationId },
                body: { consent: true, transcript: [...transcript] },
              },
            );
          },
        }
      : {}),
  };
}

/** The header's Help button, with the support assistant on the record in view. */
export function WebHelpButton({
  client,
  mode,
}: {
  readonly client: ApiClient;
  readonly mode: "owner" | "sign-in";
}) {
  const recordId = useContext(RecordContext);
  const support = useMemo(() => webHelpSupport(client, recordId, mode), [client, recordId, mode]);
  return <HelpButton support={support} />;
}

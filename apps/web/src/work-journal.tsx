import { AgentSetup } from "@draft-loop/ui/agent-setup";
import type { AgentTokenView } from "@draft-loop/ui/agent-setup-model";
import { workJournalFragment, workJournalPanelId } from "@draft-loop/ui/shared-link";
import type {
  WorkJournalReviewAction,
  WorkJournalReviewNote,
} from "@draft-loop/ui/work-journal-model";
import { workJournalRefusal } from "@draft-loop/ui/work-journal-model";
import { WorkJournalPanel } from "@draft-loop/ui/work-journal-panel";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { useRecordId } from "./record-context.js";

/**
 * The web host's Work journal (#2024): reads the record's notes and intake switch through the
 * API and sends each review to the review route. The server checks, merges and publishes.
 */

export interface WorkJournalSectionProps {
  readonly client: ApiClient;
  /** The record's selected knowledge bases, the first preselected; undefined until read. */
  readonly bases: readonly ApiSchemas["KnowledgeBase"][] | undefined;
}

/** What to tell the candidate when a work journal call is refused. */
export function workJournalProblem(error: unknown): string {
  return error instanceof ApiRequestError
    ? workJournalRefusal(error.code, error.message)
    : describeError(error);
}

export function WorkJournalSection({ client, bases }: WorkJournalSectionProps) {
  const workspaceId = useRecordId();
  const [intake, setIntake] = useState<boolean | undefined>(undefined);
  const [notes, setNotes] = useState<readonly WorkJournalReviewNote[] | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [agentTokensServed, setAgentTokensServed] = useState<boolean | undefined>(undefined);
  const [agentTokens, setAgentTokens] = useState<readonly AgentTokenView[] | undefined>(undefined);

  const reloadAgentTokens = useCallback(async () => {
    const listed = await client.call("GET /v1/workspaces/{workspaceId}/agent-tokens", {
      path: { workspaceId },
    });
    setAgentTokens(listed.tokens);
  }, [client, workspaceId]);

  const reload = useCallback(async () => {
    try {
      const [readIntake, listed] = await Promise.all([
        client.call("GET /v1/workspaces/{workspaceId}/work-journal/intake", {
          path: { workspaceId },
        }),
        client.call("GET /v1/workspaces/{workspaceId}/work-journal/notes", {
          path: { workspaceId },
          query: { status: "pending", fields: "summary", limit: 50 },
        }),
      ]);
      setIntake(readIntake.enabled);
      setAgentTokensServed(readIntake.agent_tokens);
      setNotes(listed.full ?? []);
      setProblem(undefined);
      if (readIntake.agent_tokens) await reloadAgentTokens().catch(() => undefined);
    } catch (error) {
      setProblem(t`The work journal could not be read. ${workJournalProblem(error)}`);
    }
  }, [client, workspaceId, reloadAgentTokens]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A shared link to the work journal scrolls to the panel once its notes are read (#2149).
  const scrolled = useRef(false);
  useEffect(() => {
    if (notes === undefined || scrolled.current) return;
    scrolled.current = true;
    if (window.location.hash !== workJournalFragment) return;
    document.getElementById(workJournalPanelId)?.scrollIntoView?.({ block: "start" });
  }, [notes]);

  return (
    <WorkJournalPanel
      intake={intake}
      notes={notes}
      problem={problem}
      knowledgeBases={(bases ?? []).map((base) => ({ id: base.id, name: base.displayName }))}
      agentSetup={
        <AgentSetup
          available={agentTokensServed}
          serverUrl={globalThis.location?.origin ?? ""}
          workspaceId={workspaceId}
          tokens={agentTokens}
          onIssue={async (label) => {
            try {
              const issued = await client.call("POST /v1/workspaces/{workspaceId}/agent-tokens", {
                path: { workspaceId },
                body: { label },
              });
              await reloadAgentTokens().catch(() => undefined);
              return issued;
            } catch (error) {
              return { problem: workJournalProblem(error) };
            }
          }}
          onRevoke={async (tokenId) => {
            try {
              await client.call("DELETE /v1/workspaces/{workspaceId}/agent-tokens/{tokenId}", {
                path: { workspaceId, tokenId },
              });
              await reloadAgentTokens();
              return undefined;
            } catch (error) {
              return workJournalProblem(error);
            }
          }}
        />
      }
      onSetIntake={async (enabled) => {
        try {
          const saved = await client.call("PUT /v1/workspaces/{workspaceId}/work-journal/intake", {
            path: { workspaceId },
            body: { enabled },
          });
          setIntake(saved.enabled);
          return undefined;
        } catch (error) {
          return workJournalProblem(error);
        }
      }}
      onReview={async (noteId, action: WorkJournalReviewAction) => {
        try {
          await client.call(
            "POST /v1/workspaces/{workspaceId}/work-journal/notes/{noteId}/review",
            {
              path: { workspaceId, noteId },
              body: action as ApiSchemas["WorkJournalReviewInput"],
            },
          );
          await reload();
          return undefined;
        } catch (error) {
          return workJournalProblem(error);
        }
      }}
    />
  );
}

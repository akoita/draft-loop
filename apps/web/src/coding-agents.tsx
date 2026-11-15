import {
  AgentConnectionCaps,
  type AgentConnectionCapView,
} from "@draft-loop/ui/agent-connection-caps";
import { AgentSetup } from "@draft-loop/ui/agent-setup";
import type { AgentTokenView } from "@draft-loop/ui/agent-setup-model";
import {
  codingAgentsFragment,
  codingAgentsSectionId,
  workJournalFragment,
  workJournalPanelId,
} from "@draft-loop/ui/shared-link";
import { WorkJournalIntake } from "@draft-loop/ui/work-journal-intake";
import { pendingNoteCountLimit } from "@draft-loop/ui/work-journal-pending";
import { useCallback, useEffect, useState } from "react";

import type { ApiClient } from "./api-client.js";
import { useRecordId } from "./record-context.js";
import { workJournalProblem } from "./work-journal.js";

/**
 * The web host's Agents section in Workspace settings (#2439): issues scoped agent tokens,
 * lists and revokes them. With the owner token the server says whether it issues them; signed-in
 * accounts get none, so the section shows what their connected assistants may spend instead
 * (#2657), where the server keeps those limits. With the owner token it also holds the work
 * journal's "Accept notes from agents" switch (#2625), with a link to the notes that wait.
 */
export function CodingAgentsSection({
  client,
  mode,
  openEvidence,
}: {
  readonly client: ApiClient;
  readonly mode: "owner" | "sign-in";
  /** Opens the Career evidence page, where the Work journal is. */
  readonly openEvidence?: (() => void) | undefined;
}) {
  const workspaceId = useRecordId();
  const [served, setServed] = useState<boolean | undefined>(mode === "owner" ? undefined : false);
  const [tokens, setTokens] = useState<readonly AgentTokenView[] | undefined>(undefined);
  const [intake, setIntake] = useState<boolean | undefined>(undefined);
  const [pending, setPending] = useState<number | undefined>(undefined);
  const [connections, setConnections] = useState<readonly AgentConnectionCapView[] | undefined>(
    undefined,
  );
  const [open, setOpen] = useState(() => globalThis.location?.hash === codingAgentsFragment);

  const reloadTokens = useCallback(async () => {
    const listed = await client.call("GET /v1/workspaces/{workspaceId}/agent-tokens", {
      path: { workspaceId },
    });
    setTokens(listed.tokens);
  }, [client, workspaceId]);

  useEffect(() => {
    if (mode !== "owner") return;
    void (async () => {
      try {
        const intake = await client.call("GET /v1/workspaces/{workspaceId}/work-journal/intake", {
          path: { workspaceId },
        });
        setIntake(intake.enabled);
        setServed(intake.agent_tokens);
        void client
          .call("GET /v1/workspaces/{workspaceId}/work-journal/notes", {
            path: { workspaceId },
            query: { status: "pending", limit: pendingNoteCountLimit },
          })
          .then((listed) => setPending(listed.notes?.length ?? 0))
          .catch(() => undefined);
        if (intake.agent_tokens) await reloadTokens().catch(() => undefined);
      } catch {
        setServed(false);
      }
    })();
  }, [client, mode, workspaceId, reloadTokens]);

  const reloadConnections = useCallback(async () => {
    const listed = await client.call("GET /v1/workspaces/{workspaceId}/agent-connections", {
      path: { workspaceId },
    });
    setConnections(listed.connections);
  }, [client, workspaceId]);

  // A server that keeps no limits answers 404, and the section then says agents cannot connect.
  useEffect(() => {
    if (mode !== "sign-in") return;
    void reloadConnections().catch(() => undefined);
  }, [mode, reloadConnections]);

  // A link from the Work journal panel names the section in the fragment; open and show it once
  // the section is drawn, which waits for the server's answer.
  useEffect(() => {
    if (served === undefined) return;
    const show = () => {
      if (window.location.hash !== codingAgentsFragment) return;
      setOpen(true);
      document.getElementById(codingAgentsSectionId)?.scrollIntoView?.({ block: "start" });
    };
    show();
    window.addEventListener("hashchange", show);
    return () => window.removeEventListener("hashchange", show);
  }, [served]);

  return (
    <AgentSetup
      available={served}
      open={open}
      serverUrl={globalThis.location?.origin ?? ""}
      workspaceId={workspaceId}
      tokens={tokens}
      workJournal={
        mode !== "owner" || (intake === undefined && served === false) ? undefined : (
          <WorkJournalIntake
            enabled={intake}
            pending={pending}
            onSet={async (enabled) => {
              try {
                const saved = await client.call(
                  "PUT /v1/workspaces/{workspaceId}/work-journal/intake",
                  { path: { workspaceId }, body: { enabled } },
                );
                setIntake(saved.enabled);
                return undefined;
              } catch (error) {
                return workJournalProblem(error);
              }
            }}
            onReview={
              openEvidence === undefined
                ? undefined
                : () => {
                    // The fragment makes the panel scroll into view once it reads its notes.
                    window.history.replaceState(null, "", workJournalFragment);
                    openEvidence();
                    window.requestAnimationFrame(() =>
                      document
                        .getElementById(workJournalPanelId)
                        ?.scrollIntoView?.({ block: "start" }),
                    );
                  }
            }
          />
        )
      }
      connections={
        connections === undefined ? undefined : (
          <AgentConnectionCaps
            connections={connections}
            onSet={async (clientId, monthlyCapUsd) => {
              try {
                await client.call("PUT /v1/workspaces/{workspaceId}/agent-connections", {
                  path: { workspaceId },
                  body: { client_id: clientId, monthly_cap_usd: monthlyCapUsd },
                });
                await reloadConnections();
                return undefined;
              } catch (error) {
                return workJournalProblem(error);
              }
            }}
            onRemove={async (clientId) => {
              try {
                await client.call("DELETE /v1/workspaces/{workspaceId}/agent-connections", {
                  path: { workspaceId },
                  query: { client_id: clientId },
                });
                await reloadConnections();
                return undefined;
              } catch (error) {
                return workJournalProblem(error);
              }
            }}
          />
        )
      }
      onIssue={async (label, scopes, monthlyCapUsd) => {
        try {
          const issued = await client.call("POST /v1/workspaces/{workspaceId}/agent-tokens", {
            path: { workspaceId },
            body: {
              label,
              scopes: [...scopes],
              ...(monthlyCapUsd === undefined ? {} : { monthly_cap_usd: monthlyCapUsd }),
            },
          });
          await reloadTokens().catch(() => undefined);
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
          await reloadTokens();
          return undefined;
        } catch (error) {
          return workJournalProblem(error);
        }
      }}
    />
  );
}

import { AgentSetup } from "@draft-loop/ui/agent-setup";
import type { AgentTokenView } from "@draft-loop/ui/agent-setup-model";
import { codingAgentsFragment, codingAgentsSectionId } from "@draft-loop/ui/shared-link";
import { useCallback, useEffect, useState } from "react";

import type { ApiClient } from "./api-client.js";
import { useRecordId } from "./record-context.js";
import { workJournalProblem } from "./work-journal.js";

/**
 * The web host's Agents section in Workspace settings (#2439): issues scoped agent tokens,
 * lists and revokes them. With the owner token the server says whether it issues them; signed-in
 * accounts get none yet, so the section says so.
 */
export function CodingAgentsSection({
  client,
  mode,
}: {
  readonly client: ApiClient;
  readonly mode: "owner" | "sign-in";
}) {
  const workspaceId = useRecordId();
  const [served, setServed] = useState<boolean | undefined>(mode === "owner" ? undefined : false);
  const [tokens, setTokens] = useState<readonly AgentTokenView[] | undefined>(undefined);
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
        setServed(intake.agent_tokens);
        if (intake.agent_tokens) await reloadTokens().catch(() => undefined);
      } catch {
        setServed(false);
      }
    })();
  }, [client, mode, workspaceId, reloadTokens]);

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

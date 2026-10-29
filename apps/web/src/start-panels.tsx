import type { StartDialogContext } from "@draft-loop/ui/host-panels";
import { useEffect, useState } from "react";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { ConsentView, useConsents } from "./consent.js";
import { transmissionBlockedReason } from "./consent-model.js";
import { CreditBalance, RunEstimateLine } from "./credits.js";
import { useRecordId } from "./record-context.js";

export interface StartPanelProps extends StartDialogContext {
  readonly client: ApiClient;
}

/**
 * The web's part of the Start confirmation (sign-in mode): the run's credit estimate and the
 * candidate's consent to send material to the providers. Start waits for the consent, with the
 * reason beside it. The workspace is read when the dialog opens, since the model pair, and so
 * the providers, can change on the shared screens.
 */
export function StartPanel({ client, applicationId, setBlockedReason }: StartPanelProps) {
  const workspaceId = useRecordId();
  const [workspace, setWorkspace] = useState<ApiSchemas["Workspace"] | undefined>(undefined);

  useEffect(() => {
    let current = true;
    client.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId } }).then(
      (read) => current && setWorkspace(read),
      // The default pair names the providers until the workspace is read.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, workspaceId]);

  const consent = useConsents(client, "provider-transmission", workspace);
  const reason = transmissionBlockedReason(consent.consents, consent.providers);
  useEffect(() => {
    setBlockedReason(reason);
  }, [reason, setBlockedReason]);

  return (
    <section className="start-confirmation-host" aria-label="Credits and consent">
      <RunEstimateLine
        client={client}
        workspaceId={workspaceId}
        applicationId={applicationId ?? undefined}
        modelsKey={
          workspace === undefined ? "" : `${workspace.author.model}|${workspace.critic.model}`
        }
        refresh={0}
      />
      <ConsentView kind="provider-transmission" state={consent} compact />
    </section>
  );
}

/**
 * The organisation's credit balance as a small chip in the shared header, in sign-in mode only:
 * the server meters credits there. It is read when the record opens.
 */
export function HeaderCredits({
  client,
  mode,
}: {
  readonly client: ApiClient;
  readonly mode: "owner" | "sign-in";
}) {
  return mode === "sign-in" ? <CreditBalance client={client} refresh={0} /> : null;
}

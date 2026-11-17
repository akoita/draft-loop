import type { StartDialogContext } from "@draft-loop/ui/host-panels";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { ConsentView, useConsents } from "./consent.js";
import { transmissionBlockedReason } from "./consent-model.js";
import { CreditBalance, RunEstimateLine } from "./credits.js";
import { PlanPresetChoiceView } from "./plan-preset-choice.js";
import { type PlanPresetChoice, planPresetChoice } from "./plan-preset-model.js";
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
export function StartPanel({
  client,
  applicationId,
  setBlockedReason,
  applyModelPreset,
}: StartPanelProps) {
  const workspaceId = useRecordId();
  const [workspace, setWorkspace] = useState<ApiSchemas["Workspace"] | undefined>(undefined);
  const [reads, setReads] = useState(0);
  const [planChoice, setPlanChoice] = useState<PlanPresetChoice | undefined>(undefined);
  const [applying, setApplying] = useState(false);
  const [applyProblem, setApplyProblem] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads re-reads after a preset change
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
  }, [client, workspaceId, reads]);

  // A pair outside the plan's model tiers gets the presets the plan allows, inline (#2864).
  // Owner-token mode has no plan, so its credits read fails and nothing is offered.
  useEffect(() => {
    if (workspace === undefined) return;
    let current = true;
    const planTiers = client.call("GET /v1/organisation/credits", {}).then(
      (credits): readonly string[] | undefined => credits.entitlements.modelTiers,
      () => undefined,
    );
    Promise.all([client.call("GET /v1/model-catalog", {}), planTiers]).then(
      ([catalog, tiers]) => {
        if (current) setPlanChoice(planPresetChoice(workspace, catalog.models, tiers));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, workspace]);

  const consent = useConsents(client, "provider-transmission", workspace);
  const consentReason = transmissionBlockedReason(consent.consents, consent.providers);
  const reason =
    planChoice === undefined
      ? consentReason
      : t`Your plan does not include these models. Choose one of its presets to start.`;
  useEffect(() => {
    setBlockedReason(reason);
  }, [reason, setBlockedReason]);

  const apply =
    applyModelPreset === undefined
      ? undefined
      : (presetId: string) => {
          setApplying(true);
          setApplyProblem(null);
          applyModelPreset(presetId)
            .then(
              (applied) => {
                if (applied) setReads((count) => count + 1);
                else
                  setApplyProblem(t`The preset could not be applied. Try again or use Settings.`);
              },
              () => setApplyProblem(t`The preset could not be applied. Try again or use Settings.`),
            )
            .finally(() => setApplying(false));
        };

  return (
    <section className="start-confirmation-host" aria-label={t`Credits and consent`}>
      <RunEstimateLine
        client={client}
        workspaceId={workspaceId}
        applicationId={applicationId ?? undefined}
        modelsKey={
          workspace === undefined ? "" : `${workspace.author.model}|${workspace.critic.model}`
        }
        refresh={0}
      />
      {planChoice === undefined ? null : (
        <PlanPresetChoiceView
          choice={planChoice}
          busy={applying}
          problem={applyProblem}
          onApply={apply}
        />
      )}
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

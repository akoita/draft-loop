import { useEffect, useState } from "react";

import type { ApiClient } from "./api-client.js";
import {
  balanceLine,
  balanceWarning,
  type CreditsState,
  type EstimateState,
  estimateLine,
  estimateNotes,
  readCredits,
  readEstimate,
} from "./credits-model.js";

export interface CreditBalanceProps {
  readonly client: ApiClient;
  /** Changes when the balance may have changed, such as after a run starts. */
  readonly refresh: number;
}

/** Reads the organisation's credit balance; shows nothing in owner-token mode. */
export function CreditBalance({ client, refresh }: CreditBalanceProps) {
  const [state, setState] = useState<CreditsState>({ kind: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh re-reads the balance
  useEffect(() => {
    let current = true;
    void readCredits(client).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [client, refresh]);

  return <CreditBalancePanel state={state} />;
}

export interface CreditBalancePanelProps {
  readonly state: CreditsState;
  /** Dates in this locale; the browser's when left out. */
  readonly locale?: string;
}

/** The balance line and the 80% warning. */
export function CreditBalancePanel({ state, locale }: CreditBalancePanelProps) {
  switch (state.kind) {
    case "loading":
    case "hidden":
      return null;
    case "failed":
      return <p className="muted">The credit balance could not be read.</p>;
    case "no-plan":
      return (
        <p className="notice">Your organisation has no plan yet. Ask the owner to choose one.</p>
      );
    case "ready": {
      const warning = balanceWarning(state.credits);
      return (
        <div className="credits">
          <p className="muted">{balanceLine(state.credits, locale)}</p>
          {warning === undefined ? null : <p className="notice">{warning}</p>}
        </div>
      );
    }
  }
}

export interface RunEstimateProps {
  readonly client: ApiClient;
  readonly workspaceId: string;
  readonly applicationId: string | undefined;
  /** The workspace's models; a change reads the estimate again. */
  readonly modelsKey: string;
  /** Changes when the balance may have changed, such as after a run starts. */
  readonly refresh: number;
}

/** Reads the credits the next run would use; read again when the workspace or application changes. */
export function RunEstimateLine(props: RunEstimateProps) {
  const { client, workspaceId, applicationId, modelsKey, refresh } = props;
  const [state, setState] = useState<EstimateState>({ kind: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: modelsKey and refresh re-read the estimate
  useEffect(() => {
    let current = true;
    void readEstimate(client, workspaceId, applicationId).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [client, workspaceId, applicationId, modelsKey, refresh]);

  return <RunEstimatePanel state={state} />;
}

/** The estimate beside the start button, with notes on what the plan or balance would refuse. */
export function RunEstimatePanel({ state }: { readonly state: EstimateState }) {
  switch (state.kind) {
    case "loading":
      return null;
    case "failed":
      return <p className="muted">{state.message}</p>;
    case "ready": {
      const notes = estimateNotes(state.estimate);
      return (
        <div className="estimate">
          <p className="muted">{estimateLine(state.estimate)}</p>
          {notes.map((note) => (
            <p key={note} className="notice">
              {note}
            </p>
          ))}
        </div>
      );
    }
  }
}

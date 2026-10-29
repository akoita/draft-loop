import { useEffect, useState } from "react";

import type { ApiClient } from "./api-client.js";
import {
  balanceChip,
  balanceLine,
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

/** Reads the organisation's credit balance as a chip; shows nothing in owner-token mode. */
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

/** The balance as a small chip, amber at 80% used; the full line is its tooltip. */
export function CreditBalancePanel({ state, locale }: CreditBalancePanelProps) {
  if (state.kind !== "ready") return null;
  return (
    <span
      className={state.credits.warning ? "credit-chip credit-chip-warning" : "credit-chip"}
      title={balanceLine(state.credits, locale)}
    >
      {balanceChip(state.credits)}
    </span>
  );
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

import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import {
  balanceChip,
  balanceLine,
  type CreditPackOffer,
  type CreditsState,
  type EstimateState,
  estimateLine,
  estimateNotes,
  packLabel,
  purchaseReturn,
  purchaseReturnText,
  readCredits,
  readEstimate,
  runsUsedUp,
  startPurchase,
} from "./credits-model.js";

export interface CreditBalanceProps {
  readonly client: ApiClient;
  /** Changes when the balance may have changed, such as after a run starts. */
  readonly refresh: number;
}

/** How often and how long the balance is read again after a payment, in milliseconds. */
const purchasePollMs = 4_000;
const purchasePolls = 8;

/**
 * Reads the organisation's credit balance as a chip, with the packs the service sells; shows
 * nothing in owner-token mode. Back from a payment, it says so while it reads the balance again
 * for the credits to arrive.
 */
export function CreditBalance({ client, refresh }: CreditBalanceProps) {
  const [state, setState] = useState<CreditsState>({ kind: "loading" });
  const [back] = useState(() =>
    typeof window === "undefined" ? undefined : purchaseReturn(window.location.search),
  );
  const [polls, setPolls] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh and polls re-read the balance
  useEffect(() => {
    let current = true;
    void readCredits(client).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [client, refresh, polls]);

  useEffect(() => {
    if (back === undefined) return;
    // The answer is shown once: a reload must not repeat it.
    const url = new URL(window.location.href);
    url.searchParams.delete("purchase");
    window.history.replaceState(window.history.state, "", url);
    if (back !== "done") return;
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setPolls(count);
      if (count >= purchasePolls) window.clearInterval(timer);
    }, purchasePollMs);
    return () => window.clearInterval(timer);
  }, [back]);

  return (
    <>
      <span className="credit-balance">
        <CreditBalancePanel state={state} />
        {/* Below the chip and out of the flow, so the header's buttons never move. */}
        {back === undefined || (back === "done" && polls >= purchasePolls) ? null : (
          <span className="credit-notice" role="status">
            {purchaseReturnText(back)}
          </span>
        )}
      </span>
      {state.kind === "ready" && state.credits.creditPacks.length > 0 ? (
        <BuyCredits
          packs={state.credits.creditPacks}
          onBuy={async (pack) => {
            window.location.assign(await startPurchase(client, pack));
          }}
        />
      ) : null}
    </>
  );
}

export interface BuyCreditsProps {
  readonly packs: readonly CreditPackOffer[];
  /** Opens the payment page for the pack; a rejection is shown as the reason. */
  readonly onBuy: (pack: CreditPackOffer["id"]) => Promise<void>;
  /** Prices in this locale; the browser's when left out. */
  readonly locale?: string;
  /** Open from the start, for tests. */
  readonly initiallyOpen?: boolean;
}

/** A "Buy credits" button that lists the packs; each one leads to the hosted payment page. */
export function BuyCredits({ packs, onBuy, locale, initiallyOpen = false }: BuyCreditsProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function buy(pack: CreditPackOffer["id"]) {
    setBusy(true);
    setError(undefined);
    try {
      await onBuy(pack);
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  }

  return (
    <span className="buy-credits">
      <button
        type="button"
        className="button button-toolbar"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t`Buy credits`}
      </button>
      {open ? (
        <span className="buy-credits-packs">
          {packs.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void buy(pack.id)}
            >
              {packLabel(pack, locale)}
            </button>
          ))}
          <span className="muted">
            {t`Tax included. You pay on Stripe's page, in test mode: no real money moves.`}
          </span>
          {error === undefined ? null : (
            <span className="notice" role="alert">
              {error}
            </span>
          )}
        </span>
      ) : null}
    </span>
  );
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
  /** Told why Start would be refused once the estimate is read, such as the day's runs used. */
  readonly onBlocked?: (reason: string | undefined) => void;
}

/** Reads the credits the next run would use; read again when the workspace or application changes. */
export function RunEstimateLine(props: RunEstimateProps) {
  const { client, workspaceId, applicationId, modelsKey, refresh, onBlocked } = props;
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

  const blocked = state.kind === "ready" ? runsUsedUp(state.estimate) : undefined;
  useEffect(() => {
    onBlocked?.(blocked);
  }, [blocked, onBlocked]);

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

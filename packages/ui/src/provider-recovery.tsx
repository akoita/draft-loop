import { t } from "@lingui/core/macro";
import { useState } from "react";

import { countedNouns } from "./counted-nouns.js";
import type { ProviderFailureView } from "./model.js";

/**
 * What a failed step needs from the person: nothing while the host retries it on its own, their
 * action while a retry or another action waits for them, or a new review when nothing can recover
 * the run (#2489).
 */
export type ProviderRecoveryKind = "retrying" | "waiting" | "unrecoverable";

export function providerRecoveryKind(failure: ProviderFailureView): ProviderRecoveryKind {
  if (failure.automaticRetry) return "retrying";
  return failure.availableActions.some((action) => action !== "stop") ? "waiting" : "unrecoverable";
}

/** The failure card's eyebrow: what the person should expect, before what went wrong. */
export function providerRecoveryEyebrow(kind: ProviderRecoveryKind): string {
  switch (kind) {
    case "retrying":
      return t`Retrying on its own`;
    case "waiting":
      return t`Waiting for you`;
    case "unrecoverable":
      return t`Can't recover`;
  }
}

function waitLabel(waitMs: number): string {
  return countedNouns.second(Math.max(1, Math.ceil(waitMs / 1_000)));
}

/**
 * The status line under an automatic retry: which attempt comes next and when, and that waiting is
 * safe. `remainingMs` counts down to the retry the host named; at zero the attempt is starting.
 */
export function automaticRetryLine(failure: ProviderFailureView, remainingMs: number): string {
  const next = Math.min(failure.attempt + 1, failure.maxAttempts);
  const when =
    remainingMs > 0
      ? t`Attempt ${next} of ${failure.maxAttempts} starts in ${waitLabel(remainingMs)}.`
      : t`Attempt ${next} of ${failure.maxAttempts} is starting.`;
  return t`${when} You don't need to do anything: waiting is safe, and DraftLoop asks you only if the last attempt also fails.`;
}

/** The Stop control as it stands: one button, or the question with both answers. */
export function ProviderFailureStopView(props: {
  readonly asking: boolean;
  readonly onAsk: () => void;
  readonly onKeepWaiting: () => void;
  readonly onStop: () => void;
}) {
  if (!props.asking) {
    return (
      <button className="button button-quiet" type="button" onClick={props.onAsk}>
        {t`Stop run`}
      </button>
    );
  }
  return (
    <div className="provider-stop-confirm">
      <p className="subtle">{t`DraftLoop is still retrying. Stopping ends this review for good; you would start a new one.`}</p>
      <button className="button button-outline" type="button" onClick={props.onKeepWaiting}>
        {t`Keep waiting`}
      </button>
      <button className="button button-quiet" type="button" onClick={props.onStop}>
        {t`Stop for good`}
      </button>
    </div>
  );
}

/**
 * Stop, asked twice while the host is still retrying: a retry often succeeds, and a stopped run
 * never resumes. Without a pending retry one press stops, as before.
 */
export function ProviderFailureStopButton(props: {
  readonly confirm: boolean;
  readonly onStop: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <ProviderFailureStopView
      asking={asking && props.confirm}
      onAsk={() => (props.confirm ? setAsking(true) : props.onStop())}
      onKeepWaiting={() => setAsking(false)}
      onStop={props.onStop}
    />
  );
}

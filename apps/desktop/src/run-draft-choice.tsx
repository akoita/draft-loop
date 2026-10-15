/**
 * "Use this run's draft" on one side of the run comparison: a small confirm with an optional
 * reason, after which that run's draft is the one the application approves and exports.
 *
 * Choosing never deletes or changes a run. The chosen earlier run then opens for approval and
 * export only; revision and new rounds stay on the latest run.
 */
import { type FormEvent, type JSX, useId, useState } from "react";
import { maximumChosenRunReasonLength } from "./application-contract.js";
import type { ApplicationRunRowView } from "./application-run-list.js";

/** Uses a run's draft for approval and export, with an optional reason, and opens that run. */
export type ChooseRunDraft = (runId: string, reason: string | null) => Promise<void>;

/**
 * Whether a side offers "Use this run's draft": not for the run already chosen, and not for the
 * latest run while no other run is chosen, since the application already uses it.
 */
export function runDraftChoiceOffered(
  run: { readonly latest: boolean; readonly chosen: boolean },
  runs: readonly ApplicationRunRowView[] | null | undefined,
): boolean {
  if (run.chosen) return false;
  const anotherChosen = (runs ?? []).some((row) => row.chosen === true);
  return !run.latest || anotherChosen;
}

type ChoiceStatus =
  | { readonly kind: "closed" }
  | { readonly kind: "confirming" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly message: string };

export function RunDraftChoice({
  runId,
  label,
  onChoose,
  initiallyConfirming = false,
}: {
  readonly runId: string;
  /** The run's name, such as "Run 2". */
  readonly label: string;
  readonly onChoose: ChooseRunDraft;
  /** Render with the confirm open; for static rendering in tests. */
  readonly initiallyConfirming?: boolean;
}): JSX.Element {
  const [status, setStatus] = useState<ChoiceStatus>(
    initiallyConfirming ? { kind: "confirming" } : { kind: "closed" },
  );
  const [reason, setReason] = useState("");
  const reasonId = useId();

  if (status.kind === "closed") {
    return (
      <button
        className="button button-quiet use-run-draft-button"
        type="button"
        aria-label={`Use ${label}'s draft`}
        onClick={() => setStatus({ kind: "confirming" })}
      >
        Use this run's draft
      </button>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (status.kind === "saving") return;
    setStatus({ kind: "saving" });
    const trimmed = reason.trim();
    void onChoose(runId, trimmed === "" ? null : trimmed).then(
      () => setStatus({ kind: "closed" }),
      (failure: unknown) =>
        setStatus({
          kind: "failed",
          message:
            failure instanceof Error && failure.message !== ""
              ? failure.message
              : "The run could not be chosen.",
        }),
    );
  };

  return (
    <form className="use-run-draft-confirm" aria-label={`Use ${label}'s draft`} onSubmit={submit}>
      <p>
        {label}'s draft becomes the one you approve and export. No run is deleted, and revisions
        still happen on the latest run.
      </p>
      <label htmlFor={reasonId}>Reason (optional)</label>
      <textarea
        id={reasonId}
        rows={2}
        maxLength={maximumChosenRunReasonLength}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {status.kind === "failed" ? (
        <p className="warning-copy" role="alert">
          {status.message}
        </p>
      ) : null}
      <div className="approval-actions">
        <button className="button button-primary" type="submit" disabled={status.kind === "saving"}>
          {status.kind === "saving" ? "Choosing…" : `Use ${label}'s draft`}
        </button>
        <button
          className="button button-quiet"
          type="button"
          disabled={status.kind === "saving"}
          onClick={() => setStatus({ kind: "closed" })}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

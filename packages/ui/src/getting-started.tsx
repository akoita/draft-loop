import { t } from "@lingui/core/macro";

import type { ApplicationSummaryView } from "./application-contract.js";
import { useDisplayPreference } from "./display-preference.js";
import {
  type GettingStartedInputs,
  type GettingStartedStep,
  type GettingStartedStepKey,
  gettingStartedView,
} from "./getting-started-model.js";
import { ScreenHint } from "./screen-hint.js";

export interface GettingStartedActions {
  readonly onManageEvidence: () => void;
  readonly onManageProfile: () => void;
  /** Absent when the host cannot create applications; the step then shows no button. */
  readonly onNewApplication?: (() => void) | undefined;
  readonly onOpenApplication: (application: ApplicationSummaryView) => void;
}

function stepText(key: GettingStartedStepKey): { title: string; detail: string; action: string } {
  switch (key) {
    case "career":
      return {
        title: t`Tell us about your career`,
        detail: t`Add a CV or other documents, or tell your story in a conversation.`,
        action: t`Go to Career evidence`,
      };
    case "profile":
      return {
        title: t`Check what we found`,
        detail: t`Read the facts taken from your documents, then confirm or fix them.`,
        action: t`Open Career profile`,
      };
    case "job":
      return {
        title: t`Add the job you want`,
        detail: t`Paste the job description or its link.`,
        action: t`New application`,
      };
    case "review":
      return {
        title: t`Review your CV`,
        detail: t`Read the draft, accept or reject each finding, then approve it.`,
        action: t`Open the application`,
      };
    case "download":
      return {
        title: t`Download it`,
        detail: t`Pick a template and save the file.`,
        action: t`Open the application`,
      };
  }
}

function stepAction(
  step: GettingStartedStep,
  actions: GettingStartedActions,
): (() => void) | undefined {
  switch (step.key) {
    case "career":
      return actions.onManageEvidence;
    case "profile":
      return actions.onManageProfile;
    case "job":
      return actions.onNewApplication;
    case "review":
    case "download": {
      const { application } = step;
      return application === null ? undefined : () => actions.onOpenApplication(application);
    }
  }
}

/**
 * The Getting started guide at the top of Home (#2791). Guided people see one numbered list from
 * their career story to a downloaded CV, each step ticked from the record's real state, with one
 * button on the current step. People on the simple view get a one-line offer instead.
 */
export function GettingStarted({
  inputs,
  actions,
}: {
  readonly inputs: GettingStartedInputs;
  readonly actions: GettingStartedActions;
}) {
  const { preference, choose } = useDisplayPreference();
  if (choose === undefined) return null;
  const view = gettingStartedView(preference, inputs);
  // Guided keeps a line on Home once the guide is hidden or done, so it never looks like Simple.
  if (view.kind === "hidden") return <ScreenHint screen="home" />;
  if (view.kind === "offer") {
    return (
      <aside className="getting-started getting-started-offer" aria-label={t`Getting started`}>
        <p>{t`New here? A short step-by-step guide can show you what to do first.`}</p>
        <div className="getting-started-offer-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={() => choose({ mode: "guided", guideHidden: false })}
          >
            {t`Show me the steps`}
          </button>
          <button
            type="button"
            className="link-action"
            onClick={() => choose({ ...preference, guideHidden: true })}
          >
            {t`No thanks`}
          </button>
        </div>
      </aside>
    );
  }
  if (view.kind === "complete") {
    return (
      <aside className="getting-started getting-started-folded" aria-label={t`Getting started`}>
        <p>
          <strong>{t`Getting started`}</strong> ·{" "}
          {t`You have done every step. For your next job, start again at Add the job you want.`}
        </p>
        <div className="getting-started-offer-actions">
          {actions.onNewApplication === undefined ? null : (
            <button
              type="button"
              className="button button-outline"
              onClick={actions.onNewApplication}
            >
              {t`New application`}
            </button>
          )}
          <button
            type="button"
            className="link-action"
            onClick={() => choose({ ...preference, guideHidden: true })}
          >
            {t`Hide the guide`}
          </button>
        </div>
      </aside>
    );
  }
  const total = view.steps.length;
  const progress = t`Step ${view.position} of ${total}`;
  if (view.folded) {
    return (
      <aside className="getting-started getting-started-folded" aria-label={t`Getting started`}>
        <p>
          <strong>{t`Getting started`}</strong> · {progress}: {stepText(view.current.key).title}
        </p>
        <button
          type="button"
          className="link-action"
          onClick={() => choose({ ...preference, guideHidden: false })}
        >
          {t`Show the guide`}
        </button>
      </aside>
    );
  }
  return (
    <section className="getting-started" aria-labelledby="getting-started-title">
      <div className="getting-started-head">
        <h2 id="getting-started-title">{t`Getting started`}</h2>
        <span className="meta-chip">{progress}</span>
        <button
          type="button"
          className="link-action"
          onClick={() => choose({ ...preference, guideHidden: true })}
        >
          {t`Hide the guide`}
        </button>
      </div>
      <ol className="getting-started-steps">
        {view.steps.map((step) => {
          const text = stepText(step.key);
          const isCurrent = step === view.current;
          const action = isCurrent ? stepAction(step, actions) : undefined;
          return (
            <li
              key={step.key}
              className={`getting-started-step${step.done ? " is-done" : ""}${isCurrent ? " is-current" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="getting-started-mark" aria-hidden="true">
                {step.done ? "✓" : ""}
              </span>
              <div className="getting-started-text">
                <strong>{text.title}</strong>
                {step.done ? <span className="sr-only"> ({t`done`})</span> : <p>{text.detail}</p>}
              </div>
              {action === undefined ? null : (
                <button type="button" className="button button-primary" onClick={action}>
                  {text.action}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

import { t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import { careerPanelSummary } from "./career-flow.js";
import { Chip } from "./home.js";
import type { HomeStatusPresentation } from "./home-model.js";

/** One step of the Your career panel: what the person gives, or what DraftLoop builds from it. */
export interface CareerPanelStep {
  readonly id: string;
  readonly title: string;
  /** Who does the work in this step, in a few words, such as "What you give". */
  readonly role: string;
  /** One line saying what the step holds, consistent with the intro of the page it opens. */
  readonly subtitle: string;
  readonly presentation: Pick<HomeStatusPresentation, "chip" | "tone">;
  readonly headline?: string;
  readonly children?: ReactNode;
  readonly action: ReactNode;
}

function Step({ step, number }: { readonly step: CareerPanelStep; readonly number: 1 | 2 }) {
  return (
    <section className="career-panel-step" aria-labelledby={step.id}>
      <p className="career-panel-role">{step.role}</p>
      <div className="home-card-head">
        <h3 id={step.id} className="career-panel-step-title">
          <span className="career-step-number" aria-hidden="true">
            {number}
          </span>
          {step.title}
        </h3>
        <Chip tone={step.presentation.tone}>{step.presentation.chip}</Chip>
      </div>
      <p className="home-card-subtitle">{step.subtitle}</p>
      {step.headline === undefined ? null : <p className="home-card-headline">{step.headline}</p>}
      {step.children}
      <div className="home-card-actions">{step.action}</div>
    </section>
  );
}

/**
 * Home's "Your career" panel: Career evidence and Career profile as two numbered steps joined by
 * an arrow, so they read as one pipeline rather than two alternatives.
 */
export function CareerPanel({
  evidence,
  profile,
}: {
  readonly evidence: CareerPanelStep;
  readonly profile: CareerPanelStep;
}) {
  return (
    <section className="panel career-panel" aria-labelledby="home-career-title">
      <div className="career-panel-head">
        <h2 id="home-career-title">{t`Your career`}</h2>
        <p className="career-panel-summary">{careerPanelSummary()}</p>
      </div>
      <div className="career-panel-steps">
        <Step step={evidence} number={1} />
        <div className="career-panel-arrow" aria-hidden="true">
          <span className="career-panel-arrow-mark">→</span>
          <span>{t`builds`}</span>
        </div>
        <Step step={profile} number={2} />
      </div>
    </section>
  );
}

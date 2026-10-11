import type { ReactNode } from "react";

import {
  type CareerFlowStep,
  CareerFlowStrip,
  careerEvidenceIntro,
  careerProfileIntro,
} from "./career-flow.js";
import { type WorkspaceBack, WorkspaceLocation } from "./home.js";

interface CareerPageFrameProps {
  readonly page: Extract<CareerFlowStep, "evidence" | "profile">;
  readonly current: string;
  readonly intro: string;
  readonly workspaceTitle: ReactNode;
  readonly workspaceNavigation: ReactNode;
  readonly errorMessage: string | null;
  readonly back: WorkspaceBack;
  /** The pages the flow strip's other steps open. */
  readonly onOpenStep: Partial<Readonly<Record<CareerFlowStep, () => void>>>;
  readonly children: ReactNode;
}

function CareerPageFrame({
  page,
  current,
  intro,
  workspaceTitle,
  workspaceNavigation,
  errorMessage,
  back,
  onOpenStep,
  children,
}: CareerPageFrameProps) {
  return (
    <div className="app-frame">
      <main className="app-shell app-shell-single">
        <div className="main-column">
          <header className="home-header">
            <div className="home-header-identity">
              <WorkspaceLocation current={current} back={back} />
              {workspaceTitle}
            </div>
            <div className="home-header-actions">{workspaceNavigation}</div>
          </header>
          {errorMessage === null ? null : (
            <div className="error-banner" role="alert">
              <p>{errorMessage}</p>
            </div>
          )}
          <div className="home-profile-screen">
            <div className="career-page-lead">
              <CareerFlowStrip current={page} onOpen={onOpenStep} />
            </div>
            <p className="career-page-intro">{intro}</p>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export interface CareerPageProps {
  readonly workspaceTitle: ReactNode;
  readonly workspaceNavigation: ReactNode;
  readonly errorMessage: string | null;
  readonly back: WorkspaceBack;
  /**
   * The pages the flow strip opens: Applications opens Home, and Career profile is absent when
   * the host has no profile workflow.
   */
  readonly onOpenStep: Partial<Readonly<Record<CareerFlowStep, () => void>>>;
}

export interface CareerEvidencePageProps extends CareerPageProps {
  /**
   * The Career evidence card: status, every way to add evidence, and the Knowledge base section
   * that chooses the base and the store.
   */
  readonly card?: ReactNode;
  /** A separate knowledge panel, for hosts that show one outside the card. */
  readonly knowledge?: ReactNode;
  /** The retrieval mode and embedding model panel, when the host offers it. */
  readonly retrieval?: ReactNode;
  /** Why changes to the evidence wait for now, such as a profile generation running. */
  readonly lockedReason?: string | null;
}

/** The raw material the candidate provides. Manage evidence opens it. */
export function CareerEvidencePage({
  card = null,
  knowledge = null,
  retrieval = null,
  lockedReason = null,
  ...frame
}: CareerEvidencePageProps) {
  return (
    <CareerPageFrame
      {...frame}
      page="evidence"
      current="Career evidence"
      intro={careerEvidenceIntro}
    >
      {lockedReason === null ? null : (
        <p className="career-page-locked" role="status">
          {lockedReason}
        </p>
      )}
      {card}
      {knowledge}
      {retrieval}
    </CareerPageFrame>
  );
}

export interface CareerProfilePageProps extends CareerPageProps {
  /** The canonical profile workflow: generate or update, review facts, saved profiles, history. */
  readonly workflow: ReactNode;
}

/** The reviewed record built from the evidence. Manage profile opens it. */
export function CareerProfilePage({ workflow, ...frame }: CareerProfilePageProps) {
  return (
    <CareerPageFrame {...frame} page="profile" current="Career profile" intro={careerProfileIntro}>
      {workflow}
    </CareerPageFrame>
  );
}

import type { ReactNode } from "react";

import {
  type CareerFlowStep,
  CareerFlowStrip,
  careerEvidenceIntro,
  careerProfileIntro,
} from "./career-flow.js";
import { WorkspaceLocation } from "./home.js";

interface CareerPageFrameProps {
  readonly page: Extract<CareerFlowStep, "evidence" | "profile">;
  readonly current: string;
  readonly intro: string;
  readonly workspaceTitle: ReactNode;
  readonly workspaceNavigation: ReactNode;
  readonly errorMessage: string | null;
  readonly onHome: () => void;
  /** The other career page, offered next to the flow strip when the host supports it. */
  readonly sibling?: { readonly label: string; readonly onOpen: () => void };
  readonly children: ReactNode;
}

function CareerPageFrame({
  page,
  current,
  intro,
  workspaceTitle,
  workspaceNavigation,
  errorMessage,
  onHome,
  sibling,
  children,
}: CareerPageFrameProps) {
  return (
    <div className="app-frame">
      <main className="app-shell app-shell-single">
        <div className="main-column">
          <header className="home-header">
            <div className="home-header-identity">
              <WorkspaceLocation current={current} onHome={onHome} />
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
              <CareerFlowStrip current={page} />
              {sibling === undefined ? null : (
                <button className="button button-quiet" type="button" onClick={sibling.onOpen}>
                  {sibling.label}
                </button>
              )}
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
  readonly onHome: () => void;
}

export interface CareerEvidencePageProps extends CareerPageProps {
  /** The Career evidence card: the guided first add, automatic knowledge base and legacy import. */
  readonly card?: ReactNode;
  /** The knowledge panel: sources, add file, add directory, store. */
  readonly knowledge: ReactNode;
  /** The retrieval mode and embedding model panel, when the host offers it. */
  readonly retrieval?: ReactNode;
  /** Opens the profile page; absent when the host has no profile workflow. */
  readonly onManageProfile?: () => void;
}

/** The raw material the candidate provides. Manage evidence opens it. */
export function CareerEvidencePage({
  card = null,
  knowledge,
  retrieval = null,
  onManageProfile,
  ...frame
}: CareerEvidencePageProps) {
  return (
    <CareerPageFrame
      {...frame}
      page="evidence"
      current="Career evidence"
      intro={careerEvidenceIntro}
      {...(onManageProfile === undefined
        ? {}
        : { sibling: { label: "Manage profile", onOpen: onManageProfile } })}
    >
      {card}
      {knowledge}
      {retrieval}
    </CareerPageFrame>
  );
}

export interface CareerProfilePageProps extends CareerPageProps {
  /** The canonical profile workflow: generate or update, review facts, saved profiles, history. */
  readonly workflow: ReactNode;
  readonly onManageEvidence: () => void;
}

/** The reviewed record built from the evidence. Manage profile opens it. */
export function CareerProfilePage({
  workflow,
  onManageEvidence,
  ...frame
}: CareerProfilePageProps) {
  return (
    <CareerPageFrame
      {...frame}
      page="profile"
      current="Career profile"
      intro={careerProfileIntro}
      sibling={{ label: "Manage evidence", onOpen: onManageEvidence }}
    >
      {workflow}
    </CareerPageFrame>
  );
}

import { t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import { type CareerFlowStep, careerEvidenceIntro, careerProfileIntro } from "./career-flow.js";
import { CareerPageTabs } from "./career-page-tabs.js";
import { EvidenceSignpost, ProfileSignpostArea } from "./career-signposts.js";
import { type WorkspaceBack, WorkspaceLocation } from "./home.js";
import { HostEvidenceAfter, HostEvidenceBefore } from "./host-panels.js";
import { HeaderThemeToggle } from "./theme.js";

interface CareerPageFrameProps {
  readonly page: Extract<CareerFlowStep, "evidence" | "profile">;
  readonly current: string;
  readonly intro: string;
  readonly workspaceTitle: ReactNode;
  readonly workspaceNavigation: ReactNode;
  readonly errorMessage: string | null;
  readonly back: WorkspaceBack;
  /** The pages the tabs and the Applications link open. */
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
            <div className="home-header-actions">
              <HeaderThemeToggle />
              {workspaceNavigation}
            </div>
          </header>
          {errorMessage === null ? null : (
            <div className="error-banner" role="alert">
              <p>{errorMessage}</p>
            </div>
          )}
          <div className="home-profile-screen">
            <CareerPageTabs current={page} onOpen={onOpenStep} />
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
   * The pages the tabs open: Applications opens Home, and the Career profile tab is absent when
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
  /** Changes whenever the knowledge selection or its files change; the host's panels read again. */
  readonly revision?: number;
}

/** The documents the candidate provides. Add or manage documents opens it. */
export function CareerEvidencePage({
  card = null,
  knowledge = null,
  retrieval = null,
  lockedReason = null,
  revision = 0,
  ...frame
}: CareerEvidencePageProps) {
  return (
    <CareerPageFrame
      {...frame}
      page="evidence"
      current={t`Career evidence`}
      intro={careerEvidenceIntro()}
    >
      {lockedReason === null ? null : (
        <p className="career-page-locked" role="status">
          {lockedReason}
        </p>
      )}
      {frame.onOpenStep.profile === undefined ? null : (
        <EvidenceSignpost onOpenProfile={frame.onOpenStep.profile} />
      )}
      <HostEvidenceBefore />
      {card}
      {knowledge}
      {retrieval}
      <HostEvidenceAfter revision={revision} openHome={frame.onOpenStep.applications} />
    </CareerPageFrame>
  );
}

export interface CareerProfilePageProps extends CareerPageProps {
  /** The canonical profile workflow: generate or update, review facts, saved profiles, history. */
  readonly workflow: ReactNode;
}

/** The reviewed facts built from the documents. The Career profile step on Home opens it. */
export function CareerProfilePage({ workflow, ...frame }: CareerProfilePageProps) {
  return (
    <CareerPageFrame
      {...frame}
      page="profile"
      current={t`Career profile`}
      intro={careerProfileIntro()}
    >
      <ProfileSignpostArea onOpenEvidence={frame.onOpenStep.evidence}>
        {workflow}
      </ProfileSignpostArea>
    </CareerPageFrame>
  );
}

import { t } from "@lingui/core/macro";
import { type RefObject, useContext, useEffect, useRef } from "react";

import {
  onCareerConversationRequest,
  requestCareerConversation,
  takeCareerConversationRequest,
} from "./career-conversation-model.js";
import { HostPanelsContext } from "./host-panels.js";

/** True when the host shows the career interview on the Career evidence page. */
export function useCareerConversationOffered(): boolean {
  return useContext(HostPanelsContext).careerConversation === true;
}

/**
 * The two ways to start an empty career record (#2734): documents, or a conversation for a
 * person with no CV at hand. Shown in the Career evidence card while it holds nothing.
 */
export function CareerStartChoice({
  onAddDocuments,
  addDisabled,
  disabled,
}: {
  readonly onAddDocuments: () => void;
  readonly addDisabled: boolean;
  readonly disabled: boolean;
}) {
  return (
    <section className="career-start-choice" aria-labelledby="career-start-choice-heading">
      <h3 id="career-start-choice-heading">{t`How do you want to start?`}</h3>
      <div className="career-start-ways">
        <div className="career-start-way">
          <strong>{t`Add documents`}</strong>
          <p>{t`A CV, a profile export or notes about your work.`}</p>
          <button
            className="button button-outline"
            type="button"
            disabled={addDisabled}
            onClick={onAddDocuments}
          >{t`Add documents`}</button>
        </div>
        <div className="career-start-way career-start-way-conversation">
          <strong>{t`Tell it in a conversation`}</strong>
          <p>{t`No CV needed. An interviewer asks about your work, in writing or out loud.`}</p>
          <button
            className="button button-primary"
            type="button"
            disabled={disabled}
            onClick={requestCareerConversation}
          >{t`Start a conversation`}</button>
        </div>
      </div>
      <p className="hint">{t`Either way, you check every fact before Redakloop uses it. You can add documents later.`}</p>
    </section>
  );
}

/** Home's second action on an empty Career evidence step: open the page and start talking. */
export function HomeConversationStart({ onOpenEvidence }: { readonly onOpenEvidence: () => void }) {
  if (!useCareerConversationOffered()) return null;
  return (
    <button
      className="button button-primary"
      type="button"
      onClick={() => {
        requestCareerConversation();
        onOpenEvidence();
      }}
    >{t`Start with a conversation`}</button>
  );
}

/**
 * Answers a request from the card or Home in the career interview panel: brings the panel into
 * view and, unless a conversation is already open, starts or resumes one.
 */
export function useCareerConversationRequest(
  panel: RefObject<HTMLElement | null>,
  start: () => void,
): void {
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    const answer = () => {
      if (!takeCareerConversationRequest()) return;
      startRef.current();
      // After the click that asked has shown the page, when Home asked from another page.
      setTimeout(() => {
        panel.current?.scrollIntoView?.({ block: "start" });
        panel.current?.focus?.({ preventScroll: true });
      }, 0);
    };
    answer();
    return onCareerConversationRequest(answer);
  }, [panel]);
}

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  careerConversationRequestStarts,
  onCareerConversationRequest,
  requestCareerConversation,
  takeCareerConversationRequest,
} from "./career-conversation-model.js";
import { CareerStartChoice, HomeConversationStart } from "./career-conversation-start.js";
import { CareerEvidenceCardView } from "./career-evidence-card.js";
import { HostPanelsContext } from "./host-panels.js";

/** Starting an empty career record from a conversation (#2734). */
function emptyCard(conversationOffered: boolean): string {
  return renderToStaticMarkup(
    <CareerEvidenceCardView
      status={{ kind: "none" }}
      setup={{
        evidenceSourceCount: 0,
        retrievalStatus: "not-indexed",
        selectedEvidenceChunkCount: 0,
        selectedEvidenceSourceCount: 0,
      }}
      pending={false}
      disabled={false}
      message={null}
      error={null}
      url=""
      onUrlChange={() => undefined}
      onAddFile={() => undefined}
      onAddUrl={() => undefined}
      onChooseKnowledgeBase={() => undefined}
      canAddFile
      canAddUrl
      automatic
      conversationOffered={conversationOffered}
    />,
  );
}

describe("starting career evidence from a conversation", () => {
  it("offers both ways on an empty card when the host shows the interview", () => {
    const html = emptyCard(true);
    expect(html).toContain("How do you want to start?");
    expect(html).toContain("Tell it in a conversation");
    expect(html).toContain("No CV needed.");
  });

  it("keeps the card as it was when the host has no interview", () => {
    expect(emptyCard(false)).not.toContain("How do you want to start?");
  });

  it("disables the conversation while the card is busy, and documents when files cannot be added", () => {
    const html = renderToStaticMarkup(
      <CareerStartChoice onAddDocuments={() => undefined} addDisabled disabled />,
    );
    expect(html.match(/disabled=""/gu)).toHaveLength(2);
  });

  it("shows Home's button only when the host offers the conversation", () => {
    const button = <HomeConversationStart onOpenEvidence={() => undefined} />;
    expect(renderToStaticMarkup(button)).toBe("");
    expect(
      renderToStaticMarkup(
        <HostPanelsContext.Provider value={{ careerConversation: true }}>
          {button}
        </HostPanelsContext.Provider>,
      ),
    ).toContain("Start with a conversation");
  });

  it("keeps a request until the panel takes it, once, and tells a shown panel at once", () => {
    expect(takeCareerConversationRequest()).toBe(false);
    requestCareerConversation();
    expect(takeCareerConversationRequest()).toBe(true);
    expect(takeCareerConversationRequest()).toBe(false);

    let heard = 0;
    const stop = onCareerConversationRequest(() => {
      heard += 1;
    });
    requestCareerConversation();
    stop();
    requestCareerConversation();
    expect(heard).toBe(1);
    expect(takeCareerConversationRequest()).toBe(true);
  });

  it("starts or resumes unless a conversation is already open", () => {
    expect(careerConversationRequestStarts(undefined)).toBe(true);
    expect(careerConversationRequestStarts({ status: "paused" })).toBe(true);
    expect(careerConversationRequestStarts({ status: "closed" })).toBe(true);
    expect(careerConversationRequestStarts({ status: "open" })).toBe(false);
  });
});

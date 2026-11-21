import { ScreensI18nProvider } from "@draft-loop/ui/i18n";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { FeedbackSection } from "./operator.js";
import { FeedbackReplies, FeedbackReplyForm, replyToFeedback } from "./operator-feedback-reply.js";
import type { FeedbackNote } from "./operator-model.js";

function render(node: ReactNode, locale: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(<ScreensI18nProvider locale={locale}>{node}</ScreensI18nProvider>);
}

const note: FeedbackNote = {
  noteId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  kind: "note",
  organisationId: "org-alder",
  memberId: "member-ada",
  category: "bug",
  screen: "review",
  text: "The export button does nothing.",
  transcript: null,
  context: null,
  status: "closed",
  issueUrl: null,
  triagedAt: "2026-11-15T11:00:00.000Z",
  replies: [{ text: "Fixed in the next release.", sentAt: "2026-11-15T12:00:00.000Z" }],
  sentAt: "2026-11-15T10:30:00.000Z",
};

describe("replying to a note from the operator screen (#2878)", () => {
  it("lists the replies emailed and offers Reply by email, even on a closed note", () => {
    const html = render(
      <FeedbackSection
        state={{
          kind: "ready",
          value: { notes: [note], total: 1, counts: { new: 0, triaged: 0, issue: 0, closed: 1 } },
        }}
        filter="closed"
        onTriage={() => {}}
        onReply={() => {}}
      />,
    );

    expect(html).toContain("Your replies");
    expect(html).toContain("Fixed in the next release.");
    expect(html).toContain("Reply by email");
    expect(html).toContain("FB-1A2B3C4D");
  });

  it("offers no reply where the screen only reads", () => {
    const html = render(
      <FeedbackSection
        state={{
          kind: "ready",
          value: { notes: [note], total: 1, counts: { new: 0, triaged: 0, issue: 0, closed: 1 } },
        }}
        filter="closed"
      />,
    );
    expect(html).not.toContain("Reply by email");
  });

  it("says the address stays on the server, in French too", () => {
    const form = <FeedbackReplyForm disabled={false} onSend={() => {}} onCancel={() => {}} />;
    expect(render(form)).toContain("Their address stays on the server.");
    expect(render(form)).toContain("Send reply");
    expect(render(form, "fr")).not.toContain("Send reply");
    expect(render(<FeedbackReplies replies={[]} when={(at) => at} />)).toBe("");
  });

  it("posts the reply and reports a refusal in words", async () => {
    const calls: unknown[] = [];
    const ok: ApiClient = {
      call: (async (route: string, init: unknown) => {
        calls.push([route, init]);
        return note;
      }) as ApiClient["call"],
    };
    await expect(replyToFeedback(ok, note.noteId, "Fixed.")).resolves.toEqual({
      kind: "replied",
      note,
    });
    expect(calls).toEqual([
      [
        "POST /v1/operator/feedback/{noteId}/reply",
        { path: { noteId: note.noteId }, body: { text: "Fixed." } },
      ],
    ]);
    const failing: ApiClient = {
      call: (async () => {
        throw new Error("The reply could not be emailed.");
      }) as ApiClient["call"],
    };
    await expect(replyToFeedback(failing, note.noteId, "Fixed.")).resolves.toMatchObject({
      kind: "failed",
    });
  });
});

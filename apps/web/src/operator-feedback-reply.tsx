import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import type { FeedbackNote } from "./operator-model.js";

/** The longest reply the API takes (#2878). */
export const maximumReplyLength = 2_000;

export type ReplyOutcome =
  | { readonly kind: "replied"; readonly note: FeedbackNote }
  | { readonly kind: "failed"; readonly message: string };

/** Emails the operator's reply to the member who sent the note, through the server (#2878). */
export async function replyToFeedback(
  client: ApiClient,
  noteId: string,
  text: string,
): Promise<ReplyOutcome> {
  try {
    const note = await client.call("POST /v1/operator/feedback/{noteId}/reply", {
      path: { noteId },
      body: { text },
    });
    return { kind: "replied", note };
  } catch (error) {
    return { kind: "failed", message: describeError(error) };
  }
}

/** The replies already emailed for a note, oldest first. */
export function FeedbackReplies({
  replies,
  when,
}: {
  readonly replies: FeedbackNote["replies"];
  readonly when: (iso: string) => string;
}) {
  if (replies.length === 0) return null;
  return (
    <section className="operator-replies" aria-label={t`Your replies`}>
      <h4>{t`Your replies`}</h4>
      <ol>
        {replies.map((reply) => (
          <li key={`${reply.sentAt}-${reply.text.length}`}>
            <span className="muted">{t`Emailed ${when(reply.sentAt)}`}</span>
            <p className="operator-note">{reply.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The operator writes a reply and sends it with their own click; nothing is sent automatically.
 * The member's address never reaches the screen: the server looks it up and emails the reply.
 */
export function FeedbackReplyForm({
  disabled,
  onSend,
  onCancel,
}: {
  readonly disabled: boolean;
  readonly onSend: (text: string) => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [empty, setEmpty] = useState(false);
  return (
    <form
      className="operator-link-form operator-reply-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() === "") {
          setEmpty(true);
          return;
        }
        onSend(text.trim());
      }}
    >
      <label htmlFor={`${id}-reply`}>{t`Reply to the member`}</label>
      <textarea
        id={`${id}-reply`}
        value={text}
        maxLength={maximumReplyLength}
        aria-describedby={`${id}-hint`}
        aria-invalid={empty ? true : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setEmpty(false);
        }}
      />
      <p id={`${id}-hint`} className="muted">
        {t`Redakloop emails this reply to the member who sent the note, in their language when known. Their address stays on the server.`}
      </p>
      {empty ? (
        <p className="problem" role="alert">
          {t`Write a reply first.`}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" disabled={disabled}>
          {t`Send reply`}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t`Cancel`}
        </button>
      </div>
    </form>
  );
}

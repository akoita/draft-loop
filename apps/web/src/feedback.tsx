import { t } from "@lingui/core/macro";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";

/** The longest note the API takes (#2828). */
export const maximumFeedbackLength = 2_000;

export type FeedbackCategory = "bug" | "idea" | "other";

/**
 * The screen a note came from: the page's fragment, such as `work-journal`, or `home` without one.
 * Only the characters the API accepts are kept, so a fragment never carries anything else.
 */
export function feedbackScreen(hash: string): string {
  const screen = hash
    .replace(/^#/u, "")
    .replace(/[^A-Za-z0-9._:/-]/gu, "")
    .slice(0, 80);
  return screen === "" ? "home" : screen;
}

export interface FeedbackDialogProps {
  readonly busy: boolean;
  readonly problem?: string | undefined;
  /** True once the note is sent: the dialog thanks the member and offers only Close. */
  readonly sent: boolean;
  readonly onSubmit: (note: { text: string; category: FeedbackCategory | undefined }) => void;
  readonly onClose: () => void;
}

/** A short note about DraftLoop for the people who run it, with an optional category. */
export function FeedbackDialog({ busy, problem, sent, onSubmit, onClose }: FeedbackDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<FeedbackCategory | "">("");

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && typeof element.showModal === "function" && !element.open) {
      element.showModal();
    }
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim() === "") return;
    onSubmit({ text, category: category === "" ? undefined : category });
  }

  return (
    <dialog
      ref={dialog}
      className="release-dialog feedback-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={submit}>
        <h3 id={`${id}-title`}>{t`Send feedback`}</h3>
        {sent ? (
          <>
            <p role="status">{t`Thank you. The people who run DraftLoop read every note.`}</p>
            <div className="actions">
              <button type="button" onClick={onClose}>
                {t`Close`}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              {t`Tell the people who run DraftLoop what works, what breaks or what you miss. The screen you are on is sent with your note.`}
            </p>
            <label htmlFor={`${id}-category`}>{t`Kind of note`}</label>
            <select
              id={`${id}-category`}
              value={category}
              onChange={(event) => setCategory(event.target.value as FeedbackCategory | "")}
            >
              <option value="">{t`Not sure`}</option>
              <option value="bug">{t`Something is broken`}</option>
              <option value="idea">{t`An idea`}</option>
              <option value="other">{t`Something else`}</option>
            </select>
            <label htmlFor={`${id}-text`}>{t`Your note`}</label>
            <textarea
              id={`${id}-text`}
              value={text}
              required
              maxLength={maximumFeedbackLength}
              aria-describedby={`${id}-hint`}
              onChange={(event) => setText(event.target.value)}
            />
            <p id={`${id}-hint`} className="muted">
              {t`Up to ${maximumFeedbackLength} characters. Leave out passwords and other people's details.`}
            </p>
            {problem === undefined ? null : (
              <p className="problem" role="alert">
                {problem}
              </p>
            )}
            <div className="actions">
              <button type="submit" disabled={busy || text.trim() === ""}>
                {busy ? t`Sending…` : t`Send`}
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                {t`Cancel`}
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}

/** Sends one note as the signed-in member (#2828). */
export async function sendFeedback(
  client: ApiClient,
  note: { text: string; category: FeedbackCategory | undefined; screen: string },
): Promise<void> {
  await client.call("POST /v1/feedback", {
    body: {
      text: note.text,
      screen: note.screen,
      ...(note.category === undefined ? {} : { category: note.category }),
    },
  });
}

/** The shell's Send feedback action: a toolbar button that opens the dialog. Sign-in mode only. */
export function FeedbackButton({ client }: { readonly client: ApiClient }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string>();

  function close() {
    setOpen(false);
    setSent(false);
    setProblem(undefined);
  }

  async function submit(note: { text: string; category: FeedbackCategory | undefined }) {
    setBusy(true);
    setProblem(undefined);
    try {
      await sendFeedback(client, { ...note, screen: feedbackScreen(window.location.hash) });
      setSent(true);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="button button-toolbar" onClick={() => setOpen(true)}>
        {t`Send feedback`}
      </button>
      {open ? (
        <FeedbackDialog
          busy={busy}
          problem={problem}
          sent={sent}
          onSubmit={(note) => void submit(note)}
          onClose={close}
        />
      ) : null}
    </>
  );
}

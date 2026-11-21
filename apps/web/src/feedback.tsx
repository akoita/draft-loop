import { t } from "@lingui/core/macro";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import {
  currentFeedbackPage,
  type FeedbackClientContext,
  feedbackContextFor,
} from "./feedback-context.js";

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
  /** The technical facts the note will carry (#2875), listed under What we include. */
  readonly context?: FeedbackClientContext | undefined;
  /** The server's release number, as the Help menu shows it; absent on an untagged build. */
  readonly version?: string | undefined;
  readonly onSubmit: (note: { text: string; category: FeedbackCategory | undefined }) => void;
  readonly onClose: () => void;
}

/** One row of the fold: what is sent, under a plain name. */
function Fact({ name, value }: { readonly name: string; readonly value: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}

/**
 * What we include (#2875): every value the note will carry, as it will be sent, and the two the
 * server adds itself. The fold starts closed, so the note stays the dialog's focus.
 */
export function FeedbackContextFold({
  context,
  version,
}: {
  readonly context: FeedbackClientContext | undefined;
  readonly version?: string | undefined;
}) {
  const none = t`None`;
  const errors = context?.recentErrors ?? [];
  const browser = context?.browser;
  const theme = browser?.theme === "light" ? t`light theme` : t`dark theme`;
  return (
    <details className="feedback-context">
      <summary>{t`What we include`}</summary>
      <dl>
        <Fact name={t`Source`} value={t`Web screen`} />
        <Fact name={t`Page`} value={context?.route || none} />
        {version === undefined ? null : <Fact name={t`Version`} value={version} />}
        <Fact name={t`Web build`} value={context?.webBuild ?? none} />
        <Fact name={t`Record`} value={context?.ids?.recordId ?? none} />
        <Fact name={t`Application`} value={context?.ids?.applicationId ?? none} />
        <Fact name={t`Run`} value={context?.ids?.runId ?? none} />
        <dt>{t`Recent errors`}</dt>
        {errors.length === 0 ? (
          <dd>{none}</dd>
        ) : (
          <dd>
            <ul>
              {errors.map((error) => (
                <li key={`${error.at}-${error.code}-${error.message}`}>
                  {error.code}: {error.message} ({error.at})
                </li>
              ))}
            </ul>
          </dd>
        )}
        <Fact name={t`Last failed request`} value={context?.lastFailedRequestId ?? none} />
        <Fact
          name={t`Browser`}
          value={
            browser === undefined
              ? none
              : `${browser.family}, ${browser.os}, ${browser.viewport}, ${browser.language}, ${theme}`
          }
        />
      </dl>
      <p className="muted">
        {t`The server adds its version and your organisation's plan. Never included: screenshots, page text, your CV or job descriptions.`}
      </p>
    </details>
  );
}

/** A short note about DraftLoop for the people who run it, with an optional category. */
export function FeedbackDialog({
  busy,
  problem,
  sent,
  context,
  version,
  onSubmit,
  onClose,
}: FeedbackDialogProps) {
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
              {t`Tell the people who run DraftLoop what works, what breaks or what you miss. Your note goes with the technical details listed under What we include, never your CV, job descriptions, page text or screenshots.`}
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
            <FeedbackContextFold context={context} version={version} />
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

/** Sends one note as the signed-in member (#2828), with its context when there is one (#2875). */
export async function sendFeedback(
  client: ApiClient,
  note: {
    text: string;
    category: FeedbackCategory | undefined;
    screen: string;
    context?: FeedbackClientContext | undefined;
  },
): Promise<void> {
  await client.call("POST /v1/feedback", {
    body: {
      text: note.text,
      screen: note.screen,
      ...(note.category === undefined ? {} : { category: note.category }),
      ...(note.context === undefined ? {} : { context: note.context }),
    },
  });
}

/**
 * The Send feedback dialog and its sending, for whichever control opens it: `open` takes the
 * context then, so what the dialog lists is exactly what is sent. Sign-in mode only.
 */
export function useFeedbackDialog(
  client: ApiClient,
  version?: string,
): {
  readonly open: () => void;
  readonly dialog: ReactNode;
} {
  const [isOpen, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [context, setContext] = useState<FeedbackClientContext>();

  function open() {
    setContext(feedbackContextFor(currentFeedbackPage()));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setSent(false);
    setProblem(undefined);
  }

  async function submit(note: { text: string; category: FeedbackCategory | undefined }) {
    setBusy(true);
    setProblem(undefined);
    try {
      await sendFeedback(client, {
        ...note,
        screen: feedbackScreen(window.location.hash),
        context,
      });
      setSent(true);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    open,
    dialog: isOpen ? (
      <FeedbackDialog
        busy={busy}
        problem={problem}
        sent={sent}
        context={context}
        version={version}
        onSubmit={(note) => void submit(note)}
        onClose={close}
      />
    ) : null,
  };
}

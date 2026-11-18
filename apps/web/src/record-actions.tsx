import { t } from "@lingui/core/macro";
import { type FormEvent, type ReactNode, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import { DangerDialog } from "./danger-dialog.js";
import {
  deleteConfirmWord,
  deleteRecordRequest,
  deleteRefusal,
  exportFileName,
  exportRequest,
} from "./record-actions-model.js";
import { saveFile } from "./save-file.js";

export interface RecordActionsProps {
  readonly client: ApiClient;
  readonly recordId: string;
  /** The fold's title, such as "Your data". */
  readonly title: string;
  /** Called once the API erased the record, so the screen returns to the record list. */
  readonly onDeleted: (recordId: string) => void;
  /** More of the fold, such as deleting the whole account. */
  readonly children?: ReactNode;
  /** Whether it sits in a fold of its own; the account menu shows it open, without one. */
  readonly folded?: boolean;
}

/** Exports or deletes the record the screen shows; owners and admins only (ADR 0011, D7). */
export function RecordActions({
  client,
  recordId,
  title,
  onDeleted,
  children,
  folded = true,
}: RecordActionsProps) {
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [deleteMessages, setDeleteMessages] = useState<readonly string[]>([]);

  async function attempt(
    action: () => Promise<void>,
    refusal: (error: unknown) => string,
    show: (messages: readonly string[]) => void,
  ) {
    setBusy(true);
    try {
      await action();
      show([]);
    } catch (error) {
      show([refusal(error)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecordActionsPanel
      title={title}
      busy={busy}
      messages={messages}
      deleteMessages={deleteMessages}
      folded={folded}
      extra={children}
      onExport={() =>
        void attempt(
          async () => {
            const bytes = await client.call(
              "GET /v1/workspaces/{workspaceId}/export",
              exportRequest(recordId),
            );
            saveFile(bytes, exportFileName);
          },
          describeError,
          setMessages,
        )
      }
      onDelete={(typed) => {
        const found = deleteRecordRequest(recordId, typed);
        if ("problem" in found) {
          setDeleteMessages([found.problem]);
          return;
        }
        void attempt(
          async () => {
            await client.call("DELETE /v1/workspaces/{workspaceId}", found.request);
            onDeleted(recordId);
          },
          deleteRefusal,
          setDeleteMessages,
        );
      }}
    />
  );
}

export interface RecordActionsPanelProps {
  readonly title: string;
  readonly busy: boolean;
  /** Why the download failed. */
  readonly messages: readonly string[];
  /** Why the delete was refused, shown in its dialog. */
  readonly deleteMessages?: readonly string[];
  /** Whether it sits in a fold of its own (the default) or shows open with a plain heading. */
  readonly folded?: boolean;
  readonly onExport: () => void;
  /** Called with the id the person typed to confirm. */
  readonly onDelete: (typed: string) => void;
  /** Drawn after the record's own forms. */
  readonly extra?: ReactNode;
}

/**
 * The record's export button and its delete button, whose warning and confirm word, typed back,
 * open in a dialog.
 */
export function RecordActionsPanel({
  title,
  busy,
  messages,
  deleteMessages = [],
  folded = true,
  onExport,
  onDelete,
  extra,
}: RecordActionsPanelProps) {
  const [typed, setTyped] = useState("");
  const word = deleteConfirmWord();

  function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDelete(typed);
  }

  const body = (
    <>
      <button type="button" disabled={busy} onClick={onExport}>{t`Download everything`}</button>
      <p className="muted">{t`The download holds your documents, each job application with its job text, letters and exported drafts, your profile, work journal and consent history, in files you can open.`}</p>
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
      <DangerDialog
        label={t`Delete all documents and applications…`}
        title={t`Delete all documents and applications`}
      >
        <form className="inline-form" onSubmit={remove}>
          <p className="notice">{t`This deletes every document, job application, draft, profile and work journal note stored here, for good. The account stays, so you can start again. It cannot be undone. Download everything first if you need a copy.`}</p>
          <label htmlFor="delete-record-confirm">{t`Type ${word} to confirm`}</label>
          <input
            id="delete-record-confirm"
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
          <button
            type="submit"
            className="danger"
            disabled={busy}
          >{t`Delete all documents and applications`}</button>
          {deleteMessages.map((message) => (
            <p key={message} className="problem" role="alert">
              {message}
            </p>
          ))}
        </form>
      </DangerDialog>
      {extra}
    </>
  );

  return folded ? (
    <details className="panel record-actions">
      <summary>{title}</summary>
      {body}
    </details>
  ) : (
    <section className="record-actions" aria-label={title}>
      <h3 className="eyebrow">{title}</h3>
      {body}
    </section>
  );
}

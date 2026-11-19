import { t } from "@lingui/core/macro";
import { type FormEvent, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import { DangerDialog } from "./danger-dialog.js";
import {
  deleteConfirmWord,
  deleteRecordRequest,
  deleteRefusal,
  exportFileName,
  exportRequest,
  isDeleteConfirmed,
} from "./record-actions-model.js";
import { saveFile } from "./save-file.js";

/** Runs one action with a busy flag, and keeps what went wrong for the screen to show. */
function useAttempt() {
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<readonly string[]>([]);

  async function attempt(action: () => Promise<void>, refusal: (error: unknown) => string) {
    setBusy(true);
    try {
      await action();
      setMessages([]);
    } catch (error) {
      setMessages([refusal(error)]);
    } finally {
      setBusy(false);
    }
  }

  return { busy, messages, setMessages, attempt };
}

export interface DownloadEverythingProps {
  readonly client: ApiClient;
  readonly recordId: string;
}

/** Downloads a readable copy of the record (#3036): safe, so it may sit in the account menu. */
export function DownloadEverything({ client, recordId }: DownloadEverythingProps) {
  const { busy, messages, attempt } = useAttempt();
  return (
    <DownloadPanel
      busy={busy}
      messages={messages}
      onExport={() =>
        void attempt(async () => {
          const bytes = await client.call(
            "GET /v1/workspaces/{workspaceId}/export",
            exportRequest(recordId),
          );
          saveFile(bytes, exportFileName);
        }, describeError)
      }
    />
  );
}

export interface DeleteRecordProps {
  readonly client: ApiClient;
  readonly recordId: string;
  /** Called once the API erased the record, so the screen returns to the record list. */
  readonly onDeleted: (recordId: string) => void;
}

/** Deletes the record once the person types the confirm word; it never sits in a menu. */
export function DeleteRecord({ client, recordId, onDeleted }: DeleteRecordProps) {
  const { busy, messages, setMessages, attempt } = useAttempt();
  return (
    <DeleteRecordPanel
      busy={busy}
      messages={messages}
      onDelete={(typed) => {
        const found = deleteRecordRequest(recordId, typed);
        if ("problem" in found) {
          setMessages([found.problem]);
          return;
        }
        void attempt(async () => {
          await client.call("DELETE /v1/workspaces/{workspaceId}", found.request);
          onDeleted(recordId);
        }, deleteRefusal);
      }}
    />
  );
}

export interface RecordActionsProps extends DeleteRecordProps {
  /** The fold's title, such as "Download or delete this candidate's data". */
  readonly title: string;
}

/** A team's fold that exports or deletes the chosen record; owners and admins only (ADR 0011, D7). */
export function RecordActions({ client, recordId, title, onDeleted }: RecordActionsProps) {
  return (
    <details className="panel record-actions">
      <summary>{title}</summary>
      <DownloadEverything client={client} recordId={recordId} />
      <DeleteRecord client={client} recordId={recordId} onDeleted={onDeleted} />
    </details>
  );
}

export interface DownloadPanelProps {
  readonly busy: boolean;
  /** Why the download failed. */
  readonly messages: readonly string[];
  readonly onExport: () => void;
}

/** The download button, what the file holds, and why it failed. */
export function DownloadPanel({ busy, messages, onExport }: DownloadPanelProps) {
  return (
    <div className="download-everything">
      <button type="button" disabled={busy} onClick={onExport}>{t`Download everything`}</button>
      <p className="muted">{t`The download holds your documents, each job application with its job text, letters and exported drafts, your profile, work journal and consent history, in files you can open.`}</p>
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
    </div>
  );
}

export interface DeleteRecordPanelProps {
  readonly busy: boolean;
  /** Why the delete was refused, shown in its dialog. */
  readonly messages: readonly string[];
  /** Called with the word the person typed to confirm. */
  readonly onDelete: (typed: string) => void;
}

/**
 * The record's delete button. Its warning and confirm word open in a dialog, and the final button
 * stays disabled until the word is typed, so no single click deletes anything.
 */
export function DeleteRecordPanel({ busy, messages, onDelete }: DeleteRecordPanelProps) {
  const [typed, setTyped] = useState("");
  const word = deleteConfirmWord();

  function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDelete(typed);
  }

  return (
    <DangerDialog
      label={t`Delete all documents and applications…`}
      title={t`Delete all documents and applications`}
    >
      <form className="inline-form" onSubmit={remove}>
        <p className="notice">{t`This deletes every document, job application, draft, profile and work journal note stored here, for good. The account stays, so you can start again. It cannot be undone. Download everything first if you need a copy.`}</p>
        <label htmlFor="delete-record-confirm">{t`Type ${word} to confirm`}</label>
        <input
          id="delete-record-confirm"
          type="text"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
        <button
          type="submit"
          className="danger"
          disabled={busy || !isDeleteConfirmed(typed)}
        >{t`Delete all documents and applications`}</button>
        {messages.map((message) => (
          <p key={message} className="problem" role="alert">
            {message}
          </p>
        ))}
      </form>
    </DangerDialog>
  );
}

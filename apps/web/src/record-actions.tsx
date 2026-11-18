import { t } from "@lingui/core/macro";
import { type FormEvent, type ReactNode, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import {
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
}

/** Exports or deletes the record the screen shows; owners and admins only (ADR 0011, D7). */
export function RecordActions({
  client,
  recordId,
  title,
  onDeleted,
  children,
}: RecordActionsProps) {
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

  return (
    <RecordActionsPanel
      recordId={recordId}
      title={title}
      busy={busy}
      messages={messages}
      extra={children}
      onExport={() =>
        void attempt(async () => {
          const bytes = await client.call(
            "GET /v1/workspaces/{workspaceId}/export",
            exportRequest(recordId),
          );
          saveFile(bytes, exportFileName);
        }, describeError)
      }
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

export interface RecordActionsPanelProps {
  readonly recordId: string;
  readonly title: string;
  readonly busy: boolean;
  readonly messages: readonly string[];
  readonly onExport: () => void;
  /** Called with the id the person typed to confirm. */
  readonly onDelete: (typed: string) => void;
  /** Drawn after the record's own forms. */
  readonly extra?: ReactNode;
}

/** The record's export button and its delete form, which asks for the record id typed back. */
export function RecordActionsPanel({
  recordId,
  title,
  busy,
  messages,
  onExport,
  onDelete,
  extra,
}: RecordActionsPanelProps) {
  const [typed, setTyped] = useState("");

  function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDelete(typed);
  }

  return (
    <details className="panel record-actions">
      <summary>{title}</summary>
      <p className="muted">{t`The download holds your documents, each job application with its job text, letters and exported drafts, your profile, work journal and consent history, in files you can open.`}</p>
      <button type="button" disabled={busy} onClick={onExport}>{t`Download everything`}</button>
      <form className="inline-form" onSubmit={remove}>
        <p className="notice">{t`Deleting removes this job search and everything stored for it, for good. It cannot be undone. Download everything first if you need a copy.`}</p>
        <label htmlFor="delete-record-confirm">
          {t`Type its id,`} {recordId}
          {t`, to confirm`}
        </label>
        <input
          id="delete-record-confirm"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit" className="danger" disabled={busy}>{t`Delete job search`}</button>
      </form>
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
      {extra}
    </details>
  );
}

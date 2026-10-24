import { type FormEvent, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import {
  archiveFileName,
  archiveRequest,
  deleteRecordRequest,
  deleteRefusal,
} from "./record-actions-model.js";
import { saveFile } from "./save-file.js";

export interface RecordActionsProps {
  readonly client: ApiClient;
  readonly recordId: string;
  /** Called once the API erased the record, so the screen returns to the record list. */
  readonly onDeleted: (recordId: string) => void;
}

/** Exports or deletes the record the screen shows; owners and admins only (ADR 0011, D7). */
export function RecordActions({ client, recordId, onDeleted }: RecordActionsProps) {
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
      busy={busy}
      messages={messages}
      onExport={() =>
        void attempt(async () => {
          const bytes = await client.call(
            "GET /v1/workspaces/{workspaceId}/archive",
            archiveRequest(recordId),
          );
          saveFile(bytes, archiveFileName(recordId));
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
  readonly busy: boolean;
  readonly messages: readonly string[];
  readonly onExport: () => void;
  /** Called with the id the person typed to confirm. */
  readonly onDelete: (typed: string) => void;
}

/** The record's export button and its delete form, which asks for the record id typed back. */
export function RecordActionsPanel({
  recordId,
  busy,
  messages,
  onExport,
  onDelete,
}: RecordActionsPanelProps) {
  const [typed, setTyped] = useState("");

  function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDelete(typed);
  }

  return (
    <details className="panel record-actions">
      <summary>Export or delete this record</summary>
      <p className="muted">
        The archive holds everything stored for this record: its material, runs, drafts, exports,
        consent history and audit trail.
      </p>
      <button type="button" disabled={busy} onClick={onExport}>
        Export everything
      </button>
      <form className="inline-form" onSubmit={remove}>
        <p className="notice">
          Deleting removes this record and everything stored for it, for good. It cannot be undone.
          Export everything first if you need a copy.
        </p>
        <label htmlFor="delete-record-confirm">Type the record id, {recordId}, to confirm</label>
        <input
          id="delete-record-confirm"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit" className="danger" disabled={busy}>
          Delete record
        </button>
      </form>
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
    </details>
  );
}

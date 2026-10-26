import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { describeStartError } from "./credits-model.js";
import { RecordActions } from "./record-actions.js";
import { canExportAndDelete, withoutRecord } from "./record-actions-model.js";
import {
  assignableMembers,
  assignMemberRequest,
  canManageMembers,
  currentRecordId,
  memberLabel,
  newRecordIdProblem,
  noRecordNotice,
  type RecordMemory,
  recordIds,
  unassignMemberRequest,
  withRecord,
} from "./records-model.js";
import { ReleaseAccess } from "./screening-access.js";
import { canReleaseScreening } from "./screening-model.js";

type Me = ApiSchemas["Me"];
type OrganisationMember = ApiSchemas["OrganisationMember"];
type RecordMember = ApiSchemas["RecordMember"];

type RecordsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly me: Me; readonly ids: readonly string[] };

export interface RecordsProps {
  readonly client: ApiClient;
  readonly memory: RecordMemory;
  /** Called when the person switches to another record, so the screen forgets the last one's work. */
  readonly onSwitch?: () => void;
  /** The steps for the chosen record; they call `onSaved` once they create or read the record. */
  readonly children: (recordId: string, onSaved: (recordId: string) => void) => ReactNode;
}

/**
 * Sign-in mode: the candidate records the caller reaches, the one the screen works on, and who is
 * assigned to it (ADR 0011, D6). A new record is set up on the first-run screen under its new id.
 */
export function Records({ client, memory, onSwitch, children }: RecordsProps) {
  const [state, setState] = useState<RecordsState>({ kind: "loading" });
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [deleted, setDeleted] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    Promise.all([client.call("GET /v1/me", {}), client.call("GET /v1/workspaces", {})]).then(
      ([me, list]) => {
        if (!current) return;
        const ids = recordIds(list);
        setState({ kind: "ready", me, ids });
        setChosen(currentRecordId(ids, memory.read()));
      },
      (error: unknown) => {
        if (current) setState({ kind: "failed", message: describeError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [client, memory]);

  const onSaved = useCallback((recordId: string) => {
    setState((previous) =>
      previous.kind === "ready"
        ? { ...previous, ids: withRecord(previous.ids, recordId) }
        : previous,
    );
  }, []);

  if (state.kind === "loading") return <p role="status">Reading your candidate records…</p>;
  if (state.kind === "failed")
    return (
      <p className="problem" role="alert">
        {state.message}
      </p>
    );

  const choose = (recordId: string) => {
    if (recordId === chosen) return;
    memory.remember(recordId);
    onSwitch?.();
    setDeleted(undefined);
    setChosen(recordId);
  };
  // Back to the record list: the first record left, or none.
  const onDeleted = (recordId: string) => {
    const ids = withoutRecord(state.ids, recordId);
    const next = currentRecordId(ids, undefined);
    if (next !== undefined) memory.remember(next);
    onSwitch?.();
    setState({ ...state, ids });
    setDeleted(recordId);
    setChosen(next);
  };
  const exists = chosen !== undefined && state.ids.includes(chosen);

  return (
    <>
      <RecordPicker
        ids={state.ids}
        chosen={chosen}
        notice={noRecordNotice(state.me)}
        onChoose={choose}
      />
      {deleted === undefined ? null : (
        <p className="notice" role="status">
          The record {deleted} and everything stored for it were deleted.
        </p>
      )}
      {chosen === undefined ? null : (
        <MembersPanel
          key={`${chosen}:${exists}`}
          client={client}
          recordId={chosen}
          exists={exists}
          manage={canManageMembers(state.me)}
        />
      )}
      {exists && canExportAndDelete(state.me) ? (
        <RecordActions key={chosen} client={client} recordId={chosen} onDeleted={onDeleted} />
      ) : null}
      {chosen === undefined ? null : (
        <ReleaseAccess.Provider value={canReleaseScreening(state.me)}>
          {children(chosen, onSaved)}
        </ReleaseAccess.Provider>
      )}
    </>
  );
}

export interface RecordPickerProps {
  readonly ids: readonly string[];
  /** The record shown, which may be a new id not yet set up. */
  readonly chosen: string | undefined;
  /** What to say when the caller reaches no record. */
  readonly notice: string;
  readonly onChoose: (recordId: string) => void;
}

/** Chooses the record the steps work on, or names a new one. */
export function RecordPicker({ ids, chosen, notice, onChoose }: RecordPickerProps) {
  const [newId, setNewId] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const options = chosen === undefined ? ids : withRecord(ids, chosen);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = newId.trim();
    const found = newRecordIdProblem(id, ids);
    setProblem(found);
    if (found !== undefined) return;
    setNewId("");
    onChoose(id);
  }

  return (
    <section className="panel records">
      <h2>Candidate record</h2>
      {options.length === 0 ? (
        <p className="muted">{notice}</p>
      ) : (
        <>
          <label htmlFor="record-picker">Record</label>
          <select
            id="record-picker"
            value={chosen}
            onChange={(event) => onChoose(event.target.value)}
          >
            {options.map((id) => (
              <option key={id} value={id}>
                {ids.includes(id) ? id : `${id} (new, set it up when you open it)`}
              </option>
            ))}
          </select>
        </>
      )}
      <form className="inline-form" onSubmit={create}>
        <label htmlFor="new-record-id">New record id</label>
        <input
          id="new-record-id"
          value={newId}
          autoComplete="off"
          onChange={(event) => setNewId(event.target.value)}
        />
        {problem === undefined ? null : (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
        <button type="submit">Create record</button>
      </form>
    </section>
  );
}

type MembersState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly members: readonly RecordMember[];
      readonly organisation: readonly OrganisationMember[];
    };

export interface MembersPanelProps {
  readonly client: ApiClient;
  readonly recordId: string;
  /** False for a new id not set up yet. */
  readonly exists: boolean;
  /** Owners and admins assign and remove members; members read the list. */
  readonly manage: boolean;
}

/** Who works on the record; owners and admins assign organisation members to it. */
export function MembersPanel({ client, recordId, exists, manage }: MembersPanelProps) {
  const [state, setState] = useState<MembersState>(
    exists ? { kind: "loading" } : { kind: "missing" },
  );
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ members }, organisation] = await Promise.all([
        client.call("GET /v1/workspaces/{workspaceId}/members", {
          path: { workspaceId: recordId },
        }),
        manage
          ? client.call("GET /v1/organisation/members", {}).then((answer) => answer.members)
          : Promise.resolve([]),
      ]);
      setState({ kind: "ready", members, organisation });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) setState({ kind: "missing" });
      else setState({ kind: "failed", message: describeError(error) });
    }
  }, [client, recordId, manage]);

  useEffect(() => {
    if (exists) void load();
  }, [exists, load]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setMessages([]);
      await load();
    } catch (error) {
      setMessages([describeStartError(error)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="panel members">
      <summary>Members of this record</summary>
      {state.kind === "loading" ? (
        <p role="status">Reading the record's members…</p>
      ) : state.kind === "missing" ? (
        <p className="muted">Members can be assigned once the record is set up.</p>
      ) : state.kind === "failed" ? (
        <p className="problem" role="alert">
          {state.message}
        </p>
      ) : (
        <MemberList
          members={state.members}
          assignable={manage ? assignableMembers(state.organisation, state.members) : undefined}
          busy={busy}
          messages={messages}
          onAssign={(memberId) =>
            void act(() =>
              client.call(
                "PUT /v1/workspaces/{workspaceId}/members/{memberId}",
                assignMemberRequest(recordId, memberId),
              ),
            )
          }
          onRemove={(memberId) =>
            void act(() =>
              client.call(
                "DELETE /v1/workspaces/{workspaceId}/members/{memberId}",
                unassignMemberRequest(recordId, memberId),
              ),
            )
          }
        />
      )}
    </details>
  );
}

export interface MemberListProps {
  readonly members: readonly RecordMember[];
  /** The organisation members a manager may assign; undefined for a member, who only reads. */
  readonly assignable: readonly OrganisationMember[] | undefined;
  readonly busy: boolean;
  readonly messages: readonly string[];
  readonly onAssign: (memberId: string) => void;
  readonly onRemove: (memberId: string) => void;
}

/** The assigned members, with assign and remove controls for owners and admins. */
export function MemberList({
  members,
  assignable,
  busy,
  messages,
  onAssign,
  onRemove,
}: MemberListProps) {
  const [picked, setPicked] = useState("");
  const manage = assignable !== undefined;
  const choice = assignable?.some((member) => member.memberId === picked)
    ? picked
    : (assignable?.[0]?.memberId ?? "");

  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (choice !== "") onAssign(choice);
  }

  return (
    <>
      {members.length === 0 ? (
        <p className="muted">No member is assigned to this record.</p>
      ) : (
        <ul className="sources">
          {members.map((member) => (
            <li key={member.memberId}>
              {memberLabel(member)}{" "}
              {manage ? (
                <button
                  type="button"
                  className="secondary small"
                  disabled={busy}
                  aria-label={`Remove ${member.email} from this record`}
                  onClick={() => onRemove(member.memberId)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!manage ? (
        <p className="muted">Owners and admins of your organisation assign members.</p>
      ) : assignable.length === 0 ? (
        <p className="muted">Every member of your organisation is assigned to this record.</p>
      ) : (
        <form className="inline-form" onSubmit={assign}>
          <label htmlFor="assign-member">Assign a member</label>
          <select
            id="assign-member"
            value={choice}
            onChange={(event) => setPicked(event.target.value)}
          >
            {assignable.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {memberLabel(member)}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy}>
            Assign
          </button>
        </form>
      )}
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
    </>
  );
}

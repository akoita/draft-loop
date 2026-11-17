import { t } from "@lingui/core/macro";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AccountMenu } from "./account-menu.js";
import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { describeStartError } from "./credits-model.js";
import { RecordActions } from "./record-actions.js";
import { canExportAndDelete, withoutRecord } from "./record-actions-model.js";
import {
  assignableMembers,
  assignMemberRequest,
  canManageMembers,
  currentRecordId,
  firstJobSearchName,
  isOnePersonPlan,
  memberLabel,
  newRecordNameProblem,
  noRecordNotice,
  type RecordMemory,
  recordIdFromName,
  recordIds,
  recordLabel,
  recordNameMaxLength,
  recordNames,
  sharesAccess,
  tidyRecordName,
  unassignMemberRequest,
  withRecord,
} from "./records-model.js";
import { ReleaseAccess } from "./screening-access.js";
import { canReleaseScreening } from "./screening-model.js";
import { SignOutButton } from "./shell-actions.js";

type Me = ApiSchemas["Me"];
type OrganisationMember = ApiSchemas["OrganisationMember"];
type RecordMember = ApiSchemas["RecordMember"];

type RecordsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly me: Me;
      readonly ids: readonly string[];
      /** The names people gave the records, by id; a new record's name is here before it is saved. */
      readonly names: ReadonlyMap<string, string>;
    };

export interface RecordsProps {
  readonly client: ApiClient;
  readonly memory: RecordMemory;
  /** The service status, language and feedback, drawn after the account menu in the top bar. */
  readonly shellActions?: ReactNode;
  readonly onSignOut?: () => void;
  /** Opens the operator page from the account menu, for a caller who may operate (#2829). */
  readonly onOperator?: () => void;
  /** The screens for the chosen record; they call `onSaved` once they create or read the record. */
  readonly children: (recordId: string, onSaved: (recordId: string) => void) => ReactNode;
}

/**
 * Sign-in mode: the candidate records the caller reaches, the one the screen works on, and who is
 * assigned to it (ADR 0011, D6). A new record is set up on the first-run screen under an id made
 * from the name the person typed; the name is saved once the record exists.
 */
export function Records({
  client,
  memory,
  shellActions,
  onSignOut,
  onOperator,
  children,
}: RecordsProps) {
  const [state, setState] = useState<RecordsState>({ kind: "loading" });
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [deleted, setDeleted] = useState<string | undefined>(undefined);
  /** New records whose name waits for the record to exist, by id. */
  const unsavedNames = useRef(new Map<string, string>());

  useEffect(() => {
    let current = true;
    Promise.all([client.call("GET /v1/me", {}), client.call("GET /v1/workspaces", {})]).then(
      ([me, list]) => {
        if (!current) return;
        const ids = recordIds(list);
        const names = recordNames(list);
        const found = currentRecordId(ids, memory.read());
        if (found === undefined && isOnePersonPlan(me, ids)) {
          // One person, one job search: set it up without asking for a name.
          const name = firstJobSearchName();
          const recordId = recordIdFromName(name, ids);
          unsavedNames.current.set(recordId, name);
          setState({ kind: "ready", me, ids, names: new Map(names).set(recordId, name) });
          setChosen(recordId);
          return;
        }
        setState({ kind: "ready", me, ids, names });
        setChosen(found);
      },
      (error: unknown) => {
        if (current) setState({ kind: "failed", message: describeError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [client, memory]);

  const onSaved = useCallback(
    (recordId: string) => {
      setState((previous) =>
        previous.kind === "ready"
          ? { ...previous, ids: withRecord(previous.ids, recordId) }
          : previous,
      );
      const name = unsavedNames.current.get(recordId);
      if (name === undefined) return;
      unsavedNames.current.delete(recordId);
      client
        .call("PUT /v1/workspaces/{workspaceId}/name", {
          path: { workspaceId: recordId },
          body: { name },
        })
        .catch(() => {
          // The record exists without its name: show the id, which is what a reload would show.
          setState((previous) => {
            if (previous.kind !== "ready") return previous;
            const names = new Map(previous.names);
            names.delete(recordId);
            return { ...previous, names };
          });
        });
    },
    [client],
  );

  const topBar = (account: ReactNode) => (
    <div className="record-rail account-rail">
      <div className="page-actions account-bar">
        {account}
        {shellActions}
        {account === null && onSignOut !== undefined ? (
          <SignOutButton onSignOut={onSignOut} />
        ) : null}
      </div>
    </div>
  );
  if (state.kind === "loading")
    return (
      <>
        {topBar(null)}
        <p role="status">{t`Reading your job searches…`}</p>
      </>
    );
  if (state.kind === "failed")
    return (
      <>
        {topBar(null)}
        <p className="problem" role="alert">
          {state.message}
        </p>
      </>
    );

  const choose = (recordId: string) => {
    if (recordId === chosen) return;
    memory.remember(recordId);
    setDeleted(undefined);
    setChosen(recordId);
  };
  const create = (name: string) => {
    const recordId = recordIdFromName(name, state.ids);
    unsavedNames.current.set(recordId, name);
    setState({ ...state, names: new Map(state.names).set(recordId, name) });
    choose(recordId);
  };
  // Back to the record list: the first record left, or none.
  const onDeleted = (recordId: string) => {
    const ids = withoutRecord(state.ids, recordId);
    const next = currentRecordId(ids, undefined);
    if (next !== undefined) memory.remember(next);
    const names = new Map(state.names);
    names.delete(recordId);
    setState({ ...state, ids, names });
    setDeleted(recordLabel(recordId, state.names));
    setChosen(next);
  };
  const exists = chosen !== undefined && state.ids.includes(chosen);
  const onePerson = isOnePersonPlan(state.me, state.ids);
  const yourData =
    onePerson && exists && canExportAndDelete(state.me) ? (
      <RecordActions
        key={chosen}
        client={client}
        recordId={chosen}
        title={t`Your data`}
        onDeleted={onDeleted}
      />
    ) : undefined;

  return (
    <>
      {topBar(
        onSignOut === undefined ? null : (
          <AccountMenu
            me={state.me}
            onePerson={onePerson}
            yourData={yourData}
            onSignOut={onSignOut}
            onOperator={onOperator}
          />
        ),
      )}
      {onePerson ? (
        deleted === undefined ? null : (
          <div className="record-rail">
            <p className="notice" role="status">
              {t`Your job search and everything stored for it were deleted.`}
            </p>
          </div>
        )
      ) : (
        <div className="record-rail">
          <div className="record-area">
            <RecordPicker
              ids={state.ids}
              names={state.names}
              chosen={chosen}
              notice={noRecordNotice(state.me)}
              onChoose={choose}
              onCreate={create}
            />
            {deleted === undefined ? null : (
              <p className="notice" role="status">
                {t`The job search`} {deleted} {t`and everything stored for it were deleted.`}
              </p>
            )}
            {chosen === undefined || !sharesAccess(state.me) ? null : (
              <MembersPanel
                key={`${chosen}:${exists}`}
                client={client}
                recordId={chosen}
                exists={exists}
                manage={canManageMembers(state.me)}
                selfId={state.me.kind === "member" ? state.me.memberId : undefined}
              />
            )}
            {exists && canExportAndDelete(state.me) ? (
              <RecordActions
                key={chosen}
                client={client}
                recordId={chosen}
                title={t`Download or delete this job search`}
                onDeleted={onDeleted}
              />
            ) : null}
          </div>
        </div>
      )}
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
  /** The names people gave the records, by id; a record without one shows its id. */
  readonly names: ReadonlyMap<string, string>;
  /** The record shown, which may be a new id not yet set up. */
  readonly chosen: string | undefined;
  /** What to say when the caller reaches no record. */
  readonly notice: string;
  readonly onChoose: (recordId: string) => void;
  /** Called with the tidied name of a new record. */
  readonly onCreate: (name: string) => void;
  /** Shows the new-record field from the start, for tests. */
  readonly initiallyAdding?: boolean;
}

/**
 * Chooses the record the screens work on, or names a new one. The new-record field stays folded
 * behind a button while there is a record to choose, so the bar stays one calm row.
 */
export function RecordPicker({
  ids,
  names,
  chosen,
  notice,
  onChoose,
  onCreate,
  initiallyAdding = false,
}: RecordPickerProps) {
  const [newName, setNewName] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const options = chosen === undefined ? ids : withRecord(ids, chosen);
  const [adding, setAdding] = useState(initiallyAdding);
  const field = useRef<HTMLInputElement>(null);
  const focusField = useRef(false);
  // With no record to choose, naming one is the only thing to do: the field is always there.
  const showForm = adding || options.length === 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the field is revealed
  useEffect(() => {
    if (!focusField.current) return;
    focusField.current = false;
    field.current?.focus();
  }, [adding]);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = tidyRecordName(newName);
    const found = newRecordNameProblem(name, names);
    setProblem(found);
    if (found !== undefined) return;
    setNewName("");
    setAdding(false);
    onCreate(name);
  }

  function cancel() {
    setNewName("");
    setProblem(undefined);
    setAdding(false);
  }

  return (
    <section className="panel records">
      <h2>{t`Working on`}</h2>
      {options.length === 0 ? (
        <p className="muted">{notice}</p>
      ) : (
        <div className="record-field">
          <label htmlFor="record-picker">{t`Job search`}</label>
          <select
            id="record-picker"
            value={chosen}
            onChange={(event) => onChoose(event.target.value)}
          >
            {options.map((id) => {
              const label = recordLabel(id, names);
              return (
                <option key={id} value={id}>
                  {ids.includes(id) ? label : t`${label} (new, set it up below)`}
                </option>
              );
            })}
          </select>
        </div>
      )}
      {showForm ? (
        <form className="inline-form" onSubmit={create}>
          <label htmlFor="new-record-name">{t`Name of the new job search`}</label>
          <input
            id="new-record-name"
            ref={field}
            value={newName}
            autoComplete="off"
            maxLength={recordNameMaxLength}
            placeholder={t`For example: Ada Martin, or Product roles 2026`}
            onChange={(event) => setNewName(event.target.value)}
          />
          {problem === undefined ? null : (
            <p className="problem" role="alert">
              {problem}
            </p>
          )}
          <button type="submit">{t`Start job search`}</button>
          {options.length === 0 ? null : (
            <button type="button" className="secondary" onClick={cancel}>{t`Cancel`}</button>
          )}
        </form>
      ) : (
        <button
          type="button"
          className="secondary record-add"
          onClick={() => {
            focusField.current = true;
            setAdding(true);
          }}
        >
          <span aria-hidden="true">+ </span>
          {t`New job search`}
        </button>
      )}
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
  /** The caller's own member id, whose line has no Remove button. */
  readonly selfId?: string | undefined;
}

/** Who works on the record; owners and admins assign organisation members to it. */
export function MembersPanel({ client, recordId, exists, manage, selfId }: MembersPanelProps) {
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
      <summary>{t`Who can open this job search`}</summary>
      {state.kind === "loading" ? (
        <p role="status">{t`Reading who can open it…`}</p>
      ) : state.kind === "missing" ? (
        <p className="muted">{t`You can share this job search once it is set up.`}</p>
      ) : state.kind === "failed" ? (
        <p className="problem" role="alert">
          {state.message}
        </p>
      ) : (
        <MemberList
          members={state.members}
          selfId={selfId}
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
  /** The caller's own member id: they cannot remove themselves here. */
  readonly selfId?: string | undefined;
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
  selfId,
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
        <p className="muted">{t`Nobody can open this job search yet.`}</p>
      ) : (
        <ul className="sources">
          {members.map((member) => (
            <li key={member.memberId}>
              {memberLabel(member)}
              {member.memberId === selfId ? ` ${t`(you)`}` : null}{" "}
              {manage && member.memberId !== selfId ? (
                <button
                  type="button"
                  className="secondary small"
                  disabled={busy}
                  aria-label={t`Remove access for ${member.email}`}
                  onClick={() => onRemove(member.memberId)}
                >{t`Remove`}</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!manage ? (
        <p className="muted">{t`Owners and admins of your team choose who can open it.`}</p>
      ) : assignable.length === 0 ? (
        <p className="muted">{t`Everyone in your team can already open it.`}</p>
      ) : (
        <form className="inline-form" onSubmit={assign}>
          <label htmlFor="assign-member">{t`Give access to`}</label>
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
          <button type="submit" disabled={busy}>{t`Give access`}</button>
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

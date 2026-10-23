import { type FormEvent, useCallback, useEffect, useState } from "react";

import { type ApiClient, type ApiSchemas, describeError } from "./api-client.js";
import {
  type Brief,
  type BriefEdit,
  briefEdit,
  briefEditProblems,
  briefPatchBody,
  canReview,
  createBriefBody,
  isStaleVersion,
  jobTextProblem,
  latestBrief,
  newRequirement,
  type Priority,
  priorities,
  staleVersionMessage,
} from "./brief-model.js";
import { ownerWorkspaceId } from "./workspace-model.js";

type Opportunity = ApiSchemas["Opportunity"];

type BriefState =
  | { readonly kind: "loading" }
  | { readonly kind: "paste" }
  | { readonly kind: "brief"; readonly opportunity: Opportunity };

export interface BriefStepProps {
  readonly client: ApiClient;
  /** Called with the brief shown, so a run can start from its reviewed version. */
  readonly onBrief: (brief: Brief | undefined) => void;
}

/** The job brief: paste a job post, check what was read from it, edit it and mark it reviewed. */
export function BriefStep({ client, onBrief }: BriefStepProps) {
  const [state, setState] = useState<BriefState>({ kind: "loading" });
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const workspace = { workspaceId: ownerWorkspaceId };

  const show = useCallback(
    (opportunity: Opportunity) => {
      setState({ kind: "brief", opportunity });
      onBrief(opportunity.brief);
    },
    [onBrief],
  );

  const load = useCallback(async () => {
    try {
      const { applications } = await client.call("GET /v1/workspaces/{workspaceId}/applications", {
        path: { workspaceId: ownerWorkspaceId },
      });
      const application = applications.find((item) => item.isDefault) ?? applications[0];
      const latest = application === undefined ? undefined : latestBrief(application);
      if (latest === undefined) {
        setState({ kind: "paste" });
        onBrief(undefined);
        return;
      }
      show(
        await client.call("GET /v1/workspaces/{workspaceId}/opportunities/{briefId}", {
          path: { workspaceId: ownerWorkspaceId, briefId: latest.briefId },
        }),
      );
      setStale(false);
    } catch (error) {
      setMessages([describeError(error)]);
    }
  }, [client, onBrief, show]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<Opportunity>) {
    setBusy(true);
    try {
      show(await action());
      setMessages([]);
      return true;
    } catch (error) {
      if (isStaleVersion(error)) setStale(true);
      setMessages([isStaleVersion(error) ? staleVersionMessage : describeError(error)]);
      return false;
    } finally {
      setBusy(false);
    }
  }

  switch (state.kind) {
    case "loading":
      return messages.length === 0 ? (
        <p role="status">Reading your job brief…</p>
      ) : (
        <Messages messages={messages} />
      );
    case "paste":
      return (
        <PasteJob
          busy={busy}
          messages={messages}
          onSubmit={(text) => {
            const problem = jobTextProblem(text);
            if (problem !== undefined) {
              setMessages([problem]);
              return;
            }
            void act(() =>
              client.call("POST /v1/workspaces/{workspaceId}/opportunities", {
                path: workspace,
                body: createBriefBody(text, new Date()),
              }),
            );
          }}
        />
      );
    case "brief": {
      const brief = state.opportunity.brief;
      const path = { ...workspace, briefId: brief.id };
      return (
        <BriefPanel
          brief={brief}
          busy={busy}
          stale={stale}
          messages={messages}
          onReload={() => void load()}
          onPasteAnother={() => {
            setMessages([]);
            setState({ kind: "paste" });
            onBrief(undefined);
          }}
          onSave={(edit) => {
            const problems = briefEditProblems(edit);
            if (problems.length > 0) {
              setMessages(problems);
              return Promise.resolve(false);
            }
            return act(() =>
              client.call("PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}", {
                path,
                body: briefPatchBody(brief, edit),
              }),
            );
          }}
          onReview={() =>
            void act(() =>
              client.call("POST /v1/workspaces/{workspaceId}/opportunities/{briefId}/review", {
                path,
                body: { expectedVersion: brief.version },
              }),
            )
          }
        />
      );
    }
  }
}

function Messages({ messages }: { readonly messages: readonly string[] }) {
  return (
    <>
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
    </>
  );
}

export interface PasteJobProps {
  readonly busy: boolean;
  readonly messages: readonly string[];
  readonly onSubmit: (text: string) => void;
}

export function PasteJob({ busy, messages, onSubmit }: PasteJobProps) {
  const [text, setText] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(text);
  }

  return (
    <section className="panel">
      <h2>Job brief</h2>
      <p>
        Paste the job post. DraftLoop reads its role, employer and requirements into a brief you
        check before a run.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="job-text">Job post</label>
        <textarea id="job-text" value={text} onChange={(event) => setText(event.target.value)} />
        <Messages messages={messages} />
        <button type="submit" disabled={busy}>
          {busy ? "Reading…" : "Read the job post"}
        </button>
      </form>
    </section>
  );
}

export interface BriefPanelProps {
  readonly brief: Brief;
  readonly busy: boolean;
  readonly stale: boolean;
  readonly messages: readonly string[];
  readonly onSave: (edit: BriefEdit) => Promise<boolean>;
  readonly onReview: () => void;
  readonly onReload: () => void;
  readonly onPasteAnother: () => void;
}

export function BriefPanel(props: BriefPanelProps) {
  const { brief, busy } = props;
  const [edit, setEdit] = useState<BriefEdit | undefined>(undefined);

  if (edit !== undefined)
    return (
      <BriefEditor
        brief={brief}
        edit={edit}
        busy={busy}
        messages={props.messages}
        onChange={setEdit}
        onCancel={() => setEdit(undefined)}
        onSave={() => void props.onSave(edit).then((saved) => saved && setEdit(undefined))}
      />
    );

  return (
    <section className="panel">
      <h2>Job brief</h2>
      <p className="muted">
        Version {brief.version} ·{" "}
        {brief.status === "reviewed"
          ? "reviewed, ready for a run"
          : "draft, review it before a run"}
      </p>
      <dl className="facts">
        <dt>Role</dt>
        <dd>{brief.role?.value ?? "Not found in the post"}</dd>
        <dt>Employer</dt>
        <dd>{brief.employer?.value ?? "Not found in the post"}</dd>
      </dl>
      <h3>Requirements</h3>
      {brief.requirements.length === 0 ? (
        <p className="notice">
          No requirements were found. Add at least one with Edit before marking the brief reviewed.
        </p>
      ) : (
        <ul className="requirements">
          {brief.requirements.map((requirement) => (
            <li key={requirement.id}>
              <span className={`priority priority-${requirement.priority}`}>
                {requirement.priority}
              </span>{" "}
              {requirement.text}
            </li>
          ))}
        </ul>
      )}
      {brief.responsibilities.length === 0 ? null : (
        <>
          <h3>Responsibilities</h3>
          <ul>
            {brief.responsibilities.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </>
      )}
      {brief.issues
        .filter((issue) => issue.status === "open")
        .map((issue) => (
          <p key={issue.id} className={issue.severity === "error" ? "problem" : "notice"}>
            {issue.message}
          </p>
        ))}
      <Messages messages={props.messages} />
      <div className="actions">
        {props.stale ? (
          <button type="button" onClick={props.onReload}>
            Reload the brief
          </button>
        ) : null}
        {brief.status === "draft" ? (
          <button
            type="button"
            disabled={busy || props.stale || !canReview(brief)}
            onClick={props.onReview}
          >
            Mark version {brief.version} reviewed
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          disabled={busy || props.stale}
          onClick={() => setEdit(briefEdit(brief))}
        >
          Edit
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={props.onPasteAnother}>
          Paste another job
        </button>
      </div>
    </section>
  );
}

interface BriefEditorProps {
  readonly brief: Brief;
  readonly edit: BriefEdit;
  readonly busy: boolean;
  readonly messages: readonly string[];
  readonly onChange: (edit: BriefEdit) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

export function BriefEditor({
  brief,
  edit,
  busy,
  messages,
  onChange,
  onSave,
  onCancel,
}: BriefEditorProps) {
  const setRequirement = (index: number, patch: { text?: string; priority?: Priority }) =>
    onChange({
      ...edit,
      requirements: edit.requirements.map((item, at) =>
        at === index ? { ...item, ...patch } : item,
      ),
    });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave();
  }

  return (
    <section className="panel">
      <h2>Edit the job brief</h2>
      <p className="muted">Saving makes version {brief.version + 1}, a draft to review again.</p>
      <form onSubmit={submit}>
        <label htmlFor="brief-role">Role</label>
        <input
          id="brief-role"
          value={edit.role}
          onChange={(event) => onChange({ ...edit, role: event.target.value })}
        />
        <label htmlFor="brief-employer">Employer</label>
        <input
          id="brief-employer"
          value={edit.employer}
          onChange={(event) => onChange({ ...edit, employer: event.target.value })}
        />
        <h3>Requirements</h3>
        {edit.requirements.map((requirement, index) => (
          <div key={requirement.id} className="requirement-row">
            <select
              aria-label={`Priority of requirement ${index + 1}`}
              value={requirement.priority}
              onChange={(event) =>
                setRequirement(index, { priority: event.target.value as Priority })
              }
            >
              {priorities.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
            <input
              aria-label={`Requirement ${index + 1}`}
              value={requirement.text}
              onChange={(event) => setRequirement(index, { text: event.target.value })}
            />
            <button
              type="button"
              className="secondary"
              onClick={() =>
                onChange({
                  ...edit,
                  requirements: edit.requirements.filter((_, at) => at !== index),
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onChange({
              ...edit,
              requirements: [...edit.requirements, newRequirement(brief, edit.requirements)],
            })
          }
        >
          Add a requirement
        </button>
        <Messages messages={messages} />
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save as a new version"}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

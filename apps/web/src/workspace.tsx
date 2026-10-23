import { type FormEvent, useEffect, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import {
  type Company,
  defaultWorkspaceForm,
  modelLabel,
  ownerWorkspaceId,
  samePairWarning,
  type WorkspaceForm,
  workspaceFormProblems,
  workspaceRequestBody,
} from "./workspace-model.js";

type Workspace = ApiSchemas["Workspace"];

type WorkspaceState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "ready"; readonly workspace: Workspace }
  | { readonly kind: "failed"; readonly message: string };

export interface WorkspaceStepProps {
  readonly client: ApiClient;
  /** Called with the workspace once it is read or created. */
  readonly onWorkspace: (workspace: Workspace) => void;
}

/** Reads the owner's workspace, and creates it on first use. */
export function WorkspaceStep({ client, onWorkspace }: WorkspaceStepProps) {
  const [state, setState] = useState<WorkspaceState>({ kind: "loading" });
  const [form, setForm] = useState<WorkspaceForm>(defaultWorkspaceForm);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId: ownerWorkspaceId } })
      .then(
        (workspace) => {
          if (!current) return;
          setState({ kind: "ready", workspace });
          onWorkspace(workspace);
        },
        (error: unknown) => {
          if (!current) return;
          if (error instanceof ApiRequestError && error.status === 404)
            setState({ kind: "missing" });
          else setState({ kind: "failed", message: describeError(error) });
        },
      );
    return () => {
      current = false;
    };
  }, [client, onWorkspace]);

  async function create() {
    const found = workspaceFormProblems(form);
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const workspace = await client.call("PUT /v1/workspaces/{workspaceId}", {
        path: { workspaceId: ownerWorkspaceId },
        body: workspaceRequestBody(form),
      });
      setState({ kind: "ready", workspace });
      onWorkspace(workspace);
    } catch (error) {
      setProblems([describeError(error)]);
    } finally {
      setBusy(false);
    }
  }

  switch (state.kind) {
    case "loading":
      return <p role="status">Reading your workspace…</p>;
    case "failed":
      return (
        <p className="problem" role="alert">
          {state.message}
        </p>
      );
    case "ready":
      return <WorkspaceSummary workspace={state.workspace} />;
    case "missing":
      return (
        <WorkspaceSetupForm
          form={form}
          problems={problems}
          busy={busy}
          onChange={setForm}
          onSubmit={() => void create()}
        />
      );
  }
}

export function WorkspaceSummary({ workspace }: { readonly workspace: Workspace }) {
  const warning = samePairWarning(
    workspace.author.company as Company,
    workspace.critic.company as Company,
  );
  return (
    <section className="panel">
      <h2>Workspace</h2>
      <dl className="facts">
        <dt>Language</dt>
        <dd>{workspace.language}</dd>
        <dt>Required sections</dt>
        <dd>
          {workspace.requiredSections.length === 0 ? "None" : workspace.requiredSections.join(", ")}
        </dd>
        <dt>Rounds at most</dt>
        <dd>{workspace.maxRounds}</dd>
        <dt>Author</dt>
        <dd>{modelLabel(workspace.author)}</dd>
        <dt>Critic</dt>
        <dd>{modelLabel(workspace.critic)}</dd>
        <dt>Mode</dt>
        <dd>{workspace.fixtureMode ? "Fixture mode: no model calls" : "Live models"}</dd>
      </dl>
      {warning === undefined ? null : <p className="notice">{warning}</p>}
    </section>
  );
}

export interface WorkspaceSetupFormProps {
  readonly form: WorkspaceForm;
  readonly problems: readonly string[];
  readonly busy: boolean;
  readonly onChange: (form: WorkspaceForm) => void;
  readonly onSubmit: () => void;
}

const companies: readonly { readonly id: Company; readonly label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
];

export function WorkspaceSetupForm({
  form,
  problems,
  busy,
  onChange,
  onSubmit,
}: WorkspaceSetupFormProps) {
  const warning = samePairWarning(form.authorCompany, form.criticCompany);
  const set = (patch: Partial<WorkspaceForm>) => onChange({ ...form, ...patch });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <section className="panel">
      <h2>Set up your workspace</h2>
      <p>
        The workspace holds your CV settings and the models that write and critique it. Leave a
        model empty to use the service's default.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="workspace-language">CV language</label>
        <input
          id="workspace-language"
          value={form.language}
          onChange={(event) => set({ language: event.target.value })}
        />
        <label htmlFor="workspace-sections">Required sections, one per line</label>
        <textarea
          id="workspace-sections"
          className="short"
          value={form.requiredSections}
          onChange={(event) => set({ requiredSections: event.target.value })}
        />
        <label htmlFor="workspace-rounds">Rounds at most</label>
        <input
          id="workspace-rounds"
          inputMode="numeric"
          value={form.maxRounds}
          onChange={(event) => set({ maxRounds: event.target.value })}
        />
        <div className="pair">
          <fieldset>
            <legend>Author</legend>
            <select
              aria-label="Author company"
              value={form.authorCompany}
              onChange={(event) => set({ authorCompany: event.target.value as Company })}
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Author model"
              placeholder="Service default"
              value={form.authorModel}
              onChange={(event) => set({ authorModel: event.target.value })}
            />
          </fieldset>
          <fieldset>
            <legend>Critic</legend>
            <select
              aria-label="Critic company"
              value={form.criticCompany}
              onChange={(event) => set({ criticCompany: event.target.value as Company })}
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Critic model"
              placeholder="Service default"
              value={form.criticModel}
              onChange={(event) => set({ criticModel: event.target.value })}
            />
          </fieldset>
        </div>
        {warning === undefined ? null : <p className="notice">{warning}</p>}
        <label className="check">
          <input
            type="checkbox"
            checked={form.fixtureMode}
            onChange={(event) => set({ fixtureMode: event.target.checked })}
          />
          Fixture mode: runs use built-in fictional answers and call no model
        </label>
        {problems.map((problem) => (
          <p key={problem} className="problem" role="alert">
            {problem}
          </p>
        ))}
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </section>
  );
}

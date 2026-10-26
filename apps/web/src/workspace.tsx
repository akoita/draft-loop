import {
  type WorkspaceSetupChoice,
  type WorkspaceSetupPreset,
  WorkspaceSetupScreen,
  workspaceSetupPresets,
} from "@draft-loop/ui/workspace-setup";
import { useEffect, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { describeStartError } from "./credits-model.js";
import { WritingPolicyStep } from "./policy.js";
import { useRecordId } from "./record-context.js";
import {
  type Company,
  modelLabel,
  routablePresets,
  samePairWarning,
  setupRequestBody,
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
  const workspaceId = useRecordId();
  const [state, setState] = useState<WorkspaceState>({ kind: "loading" });
  const [presets, setPresets] = useState<readonly WorkspaceSetupPreset[]>(workspaceSetupPresets);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId } }).then(
      (workspace) => {
        if (!current) return;
        setState({ kind: "ready", workspace });
        onWorkspace(workspace);
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof ApiRequestError && error.status === 404) setState({ kind: "missing" });
        else setState({ kind: "failed", message: describeError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [client, onWorkspace, workspaceId]);

  // Only the presets whose two models the service routes; all of them when it cannot say.
  useEffect(() => {
    if (state.kind !== "missing") return;
    let current = true;
    client.call("GET /v1/model-catalog", {}).then(
      (catalog) => {
        if (!current) return;
        const routable = routablePresets(workspaceSetupPresets(), catalog.models);
        if (routable.length > 0) setPresets(routable);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, state.kind]);

  async function create(choice: WorkspaceSetupChoice) {
    setProblem(null);
    setBusy(true);
    try {
      const workspace = await client.call("PUT /v1/workspaces/{workspaceId}", {
        path: { workspaceId },
        body: setupRequestBody(choice),
      });
      setState({ kind: "ready", workspace });
      onWorkspace(workspace);
    } catch (error) {
      setProblem(describeStartError(error));
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
      return (
        <>
          <WorkspaceSummary workspace={state.workspace} />
          <WritingPolicyStep client={client} />
        </>
      );
    case "missing":
      return (
        <div className="shared-screens">
          <WorkspaceSetupScreen
            presets={presets}
            busy={busy}
            problem={problem}
            onCreate={(choice) => void create(choice)}
          />
        </div>
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

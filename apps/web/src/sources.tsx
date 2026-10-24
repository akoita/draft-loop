import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import { type ApiClient, type ApiSchemas, describeError } from "./api-client.js";
import { SensitivityRulesStep } from "./sensitivity.js";
import {
  acceptedSourceFiles,
  activeBases,
  formatBytes,
  selectionRequest,
  sourceFileProblem,
  sourceMediaType,
  uploadErrorMessage,
} from "./sources-model.js";
import { ownerWorkspaceId } from "./workspace-model.js";

type KnowledgeBase = ApiSchemas["KnowledgeBase"];
type KnowledgeSource = ApiSchemas["KnowledgeSource"];
type Workspace = ApiSchemas["Workspace"];

export interface SourcesStepProps {
  readonly client: ApiClient;
  readonly workspace: Workspace;
  readonly onWorkspace: (workspace: Workspace) => void;
}

/** Candidate sources: knowledge bases, their uploaded files, and the bases runs use. */
export function SourcesStep({ client, workspace, onWorkspace }: SourcesStepProps) {
  const [bases, setBases] = useState<readonly KnowledgeBase[] | undefined>(undefined);
  const [sources, setSources] = useState<Readonly<Record<string, readonly KnowledgeSource[]>>>({});
  const [selected, setSelected] = useState<readonly string[]>(workspace.knowledgeBaseIds);
  const [combinationApproved, setCombinationApproved] = useState(false);
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // In sign-in mode each base belongs to one record, and a workspace selects only its own.
      const { knowledgeBases } = await client.call("GET /v1/knowledge-bases", {
        query: { workspaceId: ownerWorkspaceId },
      });
      const listed = activeBases(knowledgeBases);
      const entries = await Promise.all(
        listed.map(
          async (base) =>
            [
              base.id,
              (
                await client.call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
                  path: { knowledgeBaseId: base.id },
                })
              ).sources,
            ] as const,
        ),
      );
      setBases(listed);
      setSources(Object.fromEntries(entries));
    } catch (error) {
      setMessages([describeError(error)]);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<readonly string[] | undefined>) {
    setBusy(true);
    try {
      setMessages((await action()) ?? []);
    } finally {
      setBusy(false);
    }
  }

  const createBase = (displayName: string) =>
    run(async () => {
      try {
        await client.call("POST /v1/knowledge-bases", {
          body: { displayName, workspaceId: ownerWorkspaceId },
        });
        await load();
        return undefined;
      } catch (error) {
        return [describeError(error)];
      }
    });

  const upload = (knowledgeBaseId: string, files: readonly File[]) =>
    run(async () => {
      const problems: string[] = [];
      for (const file of files) {
        const problem = sourceFileProblem(file);
        const contentType = sourceMediaType(file.name);
        if (problem !== undefined || contentType === undefined) {
          problems.push(problem ?? file.name);
          continue;
        }
        try {
          await client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
            path: { knowledgeBaseId },
            query: { name: file.name },
            body: file,
            contentType,
          });
        } catch (error) {
          problems.push(uploadErrorMessage(file.name, error));
        }
      }
      await load();
      return problems;
    });

  const saveSelection = () =>
    run(async () => {
      const request = selectionRequest(selected, combinationApproved);
      if ("problem" in request) return [request.problem];
      try {
        onWorkspace(
          await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
            path: { workspaceId: ownerWorkspaceId },
            body: request.body,
          }),
        );
        return undefined;
      } catch (error) {
        return [describeError(error)];
      }
    });

  if (bases === undefined)
    return messages.length === 0 ? (
      <p role="status">Reading your knowledge bases…</p>
    ) : (
      <Problems messages={messages} />
    );

  return (
    <SourcesPanel
      bases={bases}
      sources={sources}
      selected={selected}
      savedSelection={workspace.knowledgeBaseIds}
      combinationApproved={combinationApproved}
      messages={messages}
      busy={busy}
      onCreateBase={(name) => void createBase(name)}
      onUpload={(id, files) => void upload(id, files)}
      onToggle={(id, on) =>
        setSelected((current) => (on ? [...current, id] : current.filter((item) => item !== id)))
      }
      onApproveCombination={setCombinationApproved}
      onSaveSelection={() => void saveSelection()}
      baseDetails={(knowledgeBaseId) => (
        <SensitivityRulesStep client={client} knowledgeBaseId={knowledgeBaseId} />
      )}
    />
  );
}

function Problems({ messages }: { readonly messages: readonly string[] }) {
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

export interface SourcesPanelProps {
  readonly bases: readonly KnowledgeBase[];
  readonly sources: Readonly<Record<string, readonly KnowledgeSource[]>>;
  readonly selected: readonly string[];
  readonly savedSelection: readonly string[];
  readonly combinationApproved: boolean;
  readonly messages: readonly string[];
  readonly busy: boolean;
  readonly onCreateBase: (displayName: string) => void;
  readonly onUpload: (knowledgeBaseId: string, files: readonly File[]) => void;
  readonly onToggle: (knowledgeBaseId: string, selected: boolean) => void;
  readonly onApproveCombination: (approved: boolean) => void;
  readonly onSaveSelection: () => void;
  /** What else to show under a knowledge base, such as its sensitivity rules. */
  readonly baseDetails?: (knowledgeBaseId: string) => ReactNode;
}

export function SourcesPanel(props: SourcesPanelProps) {
  const { bases, sources, selected, savedSelection, busy } = props;
  const [name, setName] = useState("");
  const unsaved =
    selected.length !== savedSelection.length ||
    selected.some((id) => !savedSelection.includes(id));

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") return;
    props.onCreateBase(name.trim());
    setName("");
  }

  return (
    <section className="panel">
      <h2>Sources</h2>
      <p>
        Upload your career material: CVs, notes and records. Files are stored for your runs and read
        by the worker, never by the API.
      </p>
      <Problems messages={props.messages} />
      {bases.length === 0 ? <p>No knowledge base yet. Create one for your sources.</p> : null}
      {bases.map((base) => (
        <article key={base.id} className="base">
          <header>
            <label className="check">
              <input
                type="checkbox"
                checked={selected.includes(base.id)}
                onChange={(event) => props.onToggle(base.id, event.target.checked)}
              />
              <span>
                <strong>{base.displayName}</strong> · used by runs when ticked
              </span>
            </label>
          </header>
          <SourceList sources={sources[base.id] ?? []} />
          <label htmlFor={`upload-${base.id}`}>Add files</label>
          <input
            id={`upload-${base.id}`}
            type="file"
            multiple
            accept={acceptedSourceFiles}
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length > 0) props.onUpload(base.id, files);
            }}
          />
          {props.baseDetails?.(base.id)}
        </article>
      ))}
      {selected.length > 1 ? (
        <label className="check">
          <input
            type="checkbox"
            checked={props.combinationApproved}
            onChange={(event) => props.onApproveCombination(event.target.checked)}
          />
          Runs may combine the material of these knowledge bases
        </label>
      ) : null}
      {bases.length === 0 ? null : (
        <button type="button" disabled={busy || !unsaved} onClick={props.onSaveSelection}>
          {unsaved ? "Use the ticked bases for runs" : "Runs use the ticked bases"}
        </button>
      )}
      <form onSubmit={create} className="inline-form">
        <label htmlFor="new-base">New knowledge base</label>
        <input
          id="new-base"
          placeholder="Career material"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={busy}>
          Create
        </button>
      </form>
    </section>
  );
}

function SourceList({ sources }: { readonly sources: readonly KnowledgeSource[] }) {
  if (sources.length === 0) return <p className="muted">No files yet.</p>;
  return (
    <ul className="sources">
      {sources.map((source) => (
        <li key={source.id}>
          {source.displayName} <span className="muted">{formatBytes(source.sizeBytes)}</span>
        </li>
      ))}
    </ul>
  );
}

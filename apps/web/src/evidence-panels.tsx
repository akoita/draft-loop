import type { HostPanels } from "@draft-loop/ui/host-panels";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { type ApiClient, type ApiSchemas, describeError } from "./api-client.js";
import { ConsentStep } from "./consent.js";
import { useRecordId } from "./record-context.js";
import { ScreeningNote, useScreening } from "./screening.js";
import { sourceStatus } from "./screening-model.js";
import { activeBases, formatBytes } from "./sources-model.js";

type KnowledgeBase = ApiSchemas["KnowledgeBase"];
type KnowledgeSource = ApiSchemas["KnowledgeSource"];

export interface StoragePermissionPanelProps {
  readonly client: ApiClient;
  /** The record's workspace, which names the model providers; the default pair until read. */
  readonly workspace: ApiSchemas["Workspace"] | undefined;
}

/**
 * The permission to store the candidate's material, asked above the Career evidence page's card in
 * sign-in mode, where the server refuses uploads without it. Once recorded it reads as one line.
 */
export function StoragePermissionPanel({ client, workspace }: StoragePermissionPanelProps) {
  return (
    <section className="panel host-panel">
      <ConsentStep client={client} kind="material-storage" workspace={workspace} compact />
    </section>
  );
}

/** A selected knowledge base with its files. */
export interface FileGroup {
  readonly base: KnowledgeBase;
  readonly sources: readonly KnowledgeSource[];
}

export interface FileChecksPanelProps {
  /** The selected knowledge bases, or undefined until they are read. */
  readonly groups: readonly FileGroup[] | undefined;
  /** Why the files could not be read, if they could not. */
  readonly problem?: string | undefined;
  /** Why the screening status could not be read, shown once above the files. */
  readonly screeningProblem?: string | undefined;
  /** What to show beside a file, such as its injection screening status. */
  readonly details: (source: KnowledgeSource) => ReactNode;
}

/** The files in the selected knowledge bases, each with its screening status. */
export function FileChecksPanel({
  groups,
  problem,
  screeningProblem,
  details,
}: FileChecksPanelProps) {
  const files = groups?.flatMap((group) => group.sources) ?? [];
  return (
    <section className="panel host-panel" aria-labelledby="file-checks-heading">
      <h2 id="file-checks-heading">File checks</h2>
      <p className="muted">
        Each file is checked for hidden instructions before runs use it. Quarantined files wait
        until an owner or admin releases them.
      </p>
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      {screeningProblem === undefined ? null : <p className="muted">{screeningProblem}</p>}
      {groups === undefined ? (
        problem === undefined ? (
          <p role="status">Reading your files…</p>
        ) : null
      ) : files.length === 0 ? (
        <p className="muted">No files in the selected knowledge bases yet.</p>
      ) : (
        groups.map(({ base, sources }) =>
          sources.length === 0 ? null : (
            <div key={base.id}>
              <h3>{base.displayName}</h3>
              <ul className="sources">
                {sources.map((source) => (
                  <li key={source.id}>
                    {source.displayName}{" "}
                    <span className="muted">{formatBytes(source.sizeBytes)}</span> {details(source)}
                  </li>
                ))}
              </ul>
            </div>
          ),
        )
      )}
    </section>
  );
}

export interface EvidenceFileChecksProps {
  readonly client: ApiClient;
  /** Changes when the shared page changes the knowledge selection or adds files. */
  readonly revision: number;
}

/**
 * The files of the record's selected knowledge bases with their screening chips. The selection is
 * read from the workspace each time `revision` changes, since the shared page saves it there.
 */
export function EvidenceFileChecks({ client, revision }: EvidenceFileChecksProps) {
  const workspaceId = useRecordId();
  const [groups, setGroups] = useState<readonly FileGroup[] | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const screening = useScreening(client);
  const reloadScreening = screening.reload;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` re-reads the files after the shared page changes the selection or adds files.
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const [workspace, { knowledgeBases }] = await Promise.all([
          client.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId } }),
          client.call("GET /v1/knowledge-bases", { query: { workspaceId } }),
        ]);
        const selected = activeBases(knowledgeBases).filter((base) =>
          workspace.knowledgeBaseIds.includes(base.id),
        );
        const next = await Promise.all(
          selected.map(async (base) => ({
            base,
            sources: (
              await client.call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
                path: { knowledgeBaseId: base.id },
              })
            ).sources,
          })),
        );
        if (!current) return;
        setGroups(next);
        setProblem(undefined);
      } catch (error) {
        if (current) setProblem(describeError(error));
      }
    })();
    return () => {
      current = false;
    };
  }, [client, workspaceId, revision]);

  // The screening statuses are read once on mount; a later revision reads them again.
  const firstRevision = useRef(revision);
  useEffect(() => {
    if (firstRevision.current !== revision) void reloadScreening();
  }, [revision, reloadScreening]);

  const details = useCallback(
    (source: KnowledgeSource) =>
      screening.statuses === undefined ? null : (
        <ScreeningNote
          client={client}
          status={sourceStatus(screening.statuses, source)}
          subject={source.displayName}
          onReleased={() => void reloadScreening()}
        />
      ),
    [client, screening.statuses, reloadScreening],
  );

  return (
    <FileChecksPanel
      groups={groups}
      problem={problem}
      screeningProblem={screening.problem}
      details={details}
    />
  );
}

/**
 * What the web adds to the shared Career evidence page: the storage permission above the evidence,
 * in sign-in mode only, and the files' screening checks below the knowledge panel.
 */
export function evidenceHostPanels(
  client: ApiClient,
  mode: "owner" | "sign-in",
  workspace: ApiSchemas["Workspace"] | undefined,
): HostPanels {
  return {
    ...(mode === "sign-in"
      ? { evidenceBefore: <StoragePermissionPanel client={client} workspace={workspace} /> }
      : {}),
    evidenceAfter: ({ revision }) => <EvidenceFileChecks client={client} revision={revision} />,
  };
}

import { t } from "@lingui/core/macro";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { type ApiClient, type ApiSchemas, describeError } from "./api-client.js";
import { CareerInterviewSection } from "./career-interview.js";
import { ConsentStep } from "./consent.js";
import { PrivateSections } from "./private-sections.js";
import { useRecordId } from "./record-context.js";
import { ScreeningNote, useScreening } from "./screening.js";
import { sourceStatus } from "./screening-model.js";
import { activeBases, formatBytes } from "./sources-model.js";
import { WorkJournalSection } from "./work-journal.js";

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
      <h2 id="file-checks-heading">{t`File checks`}</h2>
      <p className="muted">{t`Each file is checked for hidden instructions before runs use it. Quarantined files wait until an owner or admin releases them.`}</p>
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      {screeningProblem === undefined ? null : <p className="muted">{screeningProblem}</p>}
      {groups === undefined ? (
        problem === undefined ? (
          <p role="status">{t`Reading your files…`}</p>
        ) : null
      ) : files.length === 0 ? (
        <p className="muted">{t`No files in the selected knowledge bases yet.`}</p>
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

export interface SelectedBases {
  /** The selected knowledge bases with their files; undefined until read. */
  readonly groups: readonly FileGroup[] | undefined;
  /** Why they could not be read, if they could not. */
  readonly problem: string | undefined;
}

/**
 * Reads the record's selected knowledge bases and their files, and again each time `revision`
 * changes, since the shared page saves the selection and adds files.
 */
export function useSelectedBases(client: ApiClient, revision: number): SelectedBases {
  const workspaceId = useRecordId();
  const [groups, setGroups] = useState<readonly FileGroup[] | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

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

  return { groups, problem };
}

export interface EvidenceFileChecksProps extends SelectedBases {
  readonly client: ApiClient;
  /** Changes when the shared page changes the knowledge selection or adds files. */
  readonly revision: number;
}

/** The selected bases' files with their screening chips; the statuses are read again per revision. */
export function EvidenceFileChecks({ client, revision, groups, problem }: EvidenceFileChecksProps) {
  const screening = useScreening(client);
  const reloadScreening = screening.reload;

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
 * The panels below the knowledge panel over one reading: file checks, private sections, and the
 * work journal and the career interview where the server serves them.
 */
export function EvidenceSections({ client, revision, workJournal }: EvidenceSectionsProps) {
  const { groups, problem } = useSelectedBases(client, revision);
  const bases = groups?.map((group) => group.base);
  return (
    <>
      <EvidenceFileChecks client={client} revision={revision} groups={groups} problem={problem} />
      <div className="evidence-optional">
        <p className="eyebrow">{t`Optional`}</p>
        <p>{t`Add more evidence at any time. None of the sections below is needed before Career profile.`}</p>
      </div>
      <PrivateSections client={client} bases={bases} />
      {workJournal === true ? <WorkJournalSection client={client} bases={bases} /> : null}
      {workJournal === true ? <CareerInterviewSection client={client} bases={bases} /> : null}
    </>
  );
}

export interface EvidenceSectionsProps {
  readonly client: ApiClient;
  readonly revision: number;
  /**
   * Shows the work journal review and the career interview; the web shows them only with the
   * owner token for now.
   */
  readonly workJournal?: boolean;
}

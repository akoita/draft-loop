import { knowledgeBaseDisplayName } from "@draft-loop/ui/career-evidence";
import { countedNouns } from "@draft-loop/ui/counted-nouns";
import { t } from "@lingui/core/macro";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { type ApiClient, type ApiSchemas, describeError } from "./api-client.js";
import { CareerInterviewSection } from "./career-interview.js";
import { ConsentStep } from "./consent.js";
import {
  downloadOffered,
  downloadSourceFile,
  fileAddedLine,
  isInterviewSource,
  isPastedSource,
} from "./evidence-file-model.js";
import { PrivateSections } from "./private-sections.js";
import { useRecordId } from "./record-context.js";
import { saveFile } from "./save-file.js";
import { ScreeningNote, useScreening } from "./screening.js";
import { useCanRelease } from "./screening-access.js";
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
  /** What the person can do with a file, such as download it. */
  readonly actions?: (source: KnowledgeSource) => ReactNode;
}

/** The files in the selected knowledge bases, each with when it was added and its screening status. */
export function FileChecksPanel({
  groups,
  problem,
  screeningProblem,
  details,
  actions,
}: FileChecksPanelProps) {
  const files = groups?.flatMap((group) => group.sources) ?? [];
  return (
    <section className="panel host-panel" aria-labelledby="file-checks-heading">
      <h2 id="file-checks-heading">{t`Your files`}</h2>
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
              <h3 id={`file-group-${base.id}`}>
                {knowledgeBaseDisplayName(base.displayName)}
                <span className="evidence-file-count">
                  {" · "}
                  {countedNouns.file(sources.length)}
                </span>
              </h3>
              {/* A long list scrolls inside its own box so the sections below stay near (#2635). */}
              <ul
                className="sources evidence-files"
                aria-labelledby={`file-group-${base.id}`}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region needs focus to scroll by keyboard.
                tabIndex={0}
              >
                {sources.map((source) => {
                  const added = fileAddedLine(source);
                  return (
                    <li key={source.id}>
                      <div className="evidence-file-name">
                        <span>{source.displayName}</span>
                        {isInterviewSource(source) ? (
                          <span className="evidence-file-tag">{t`From career interview`}</span>
                        ) : isPastedSource(source) ? (
                          <span className="evidence-file-tag">{t`Pasted text`}</span>
                        ) : null}
                      </div>
                      <div className="evidence-file-checks">
                        {details(source)} {actions?.(source)}
                      </div>
                      <div className="muted evidence-file-meta">
                        {added === undefined ? null : `${added} · `}
                        {formatBytes(source.sizeBytes)}
                      </div>
                    </li>
                  );
                })}
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

  const canRelease = useCanRelease();
  const actions = useCallback(
    (source: KnowledgeSource) => {
      // Until the statuses are read, a quarantined file is not known; offer nothing yet.
      if (screening.statuses === undefined && !canRelease) return null;
      const status =
        screening.statuses === undefined ? undefined : sourceStatus(screening.statuses, source);
      return downloadOffered(status, canRelease) ? (
        <DownloadFileButton client={client} source={source} />
      ) : (
        <span className="muted">{t`Ask an owner or admin to release this file before downloading it.`}</span>
      );
    },
    [client, screening.statuses, canRelease],
  );

  return (
    <FileChecksPanel
      groups={groups}
      problem={problem}
      screeningProblem={screening.problem}
      details={details}
      actions={actions}
    />
  );
}

/** Saves the file's stored bytes under its own name; a refusal shows beside the button. */
function DownloadFileButton({
  client,
  source,
}: {
  readonly client: ApiClient;
  readonly source: KnowledgeSource;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setProblem(undefined);
          void downloadSourceFile(client, source)
            .then((bytes) => saveFile(bytes, source.displayName))
            .catch((error: unknown) => setProblem(describeError(error)))
            .finally(() => setBusy(false));
        }}
      >
        {t`Download`} <span className="sr-only">{source.displayName}</span>
      </button>
      {problem === undefined ? null : (
        <span className="problem" role="alert">
          {problem}
        </span>
      )}
    </>
  );
}

/**
 * The panels below the knowledge panel over one reading: file checks, then the optional ones, most
 * used first: the career interview and the work journal where the server serves them, then private
 * sections.
 */
export function EvidenceSections({
  client,
  revision,
  workJournal,
  openHome,
}: EvidenceSectionsProps) {
  const { groups, problem } = useSelectedBases(client, revision);
  const bases = groups?.map((group) => group.base);
  return (
    <>
      <EvidenceFileChecks client={client} revision={revision} groups={groups} problem={problem} />
      <div className="evidence-optional">
        <p className="eyebrow">{t`Optional`}</p>
        <p>{t`Add more evidence at any time. None of the sections below is needed before Career profile.`}</p>
      </div>
      {workJournal === true ? <CareerInterviewSection client={client} bases={bases} /> : null}
      {workJournal === true ? (
        <WorkJournalSection client={client} bases={bases} openHome={openHome} />
      ) : null}
      <PrivateSections client={client} bases={bases} />
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
  /** Opens Home, for the Work journal's link to Agents. */
  readonly openHome?: (() => void) | undefined;
}

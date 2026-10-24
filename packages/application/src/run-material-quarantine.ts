import type {
  ContentScreeningStatus,
  ContentScreeningStore,
  ContentScreeningSubject,
} from "@draft-loop/storage/content-screening";

import {
  HostedKnowledgeIntakeError,
  type HostedKnowledgeSourceView,
} from "./hosted-knowledge-intake.js";

/** What the check reads: the screening results, and the sources of a knowledge base. */
export interface RunMaterialQuarantineReaders {
  readonly store: Pick<ContentScreeningStore, "quarantined" | "listForKnowledgeBase">;
  /** The base's sources with their latest version; without it no knowledge source is checked. */
  readonly listSources?:
    | ((knowledgeBaseId: string) => Promise<readonly HostedKnowledgeSourceView[]>)
    | undefined;
}

/** The material one run would send: a brief's sources and the bases the workspace selects. */
export interface RunMaterial {
  /** The brief version record; `workspaceId` is the history workspace id its screening uses. */
  readonly brief?:
    | {
        readonly workspaceId: string;
        readonly brief: {
          readonly id: string;
          readonly sources: readonly { readonly id: string }[];
        };
      }
    | undefined;
  readonly knowledgeBaseIds: readonly string[];
}

/**
 * The run's material that is quarantined by injection screening and not released (ADR 0011,
 * phase 2d), job sources first and then knowledge sources, each as its latest stored status. The
 * run start and the worker both ask it, so a run is gated the same way when it is begun and when
 * it is claimed. Every source of the brief counts. Only the latest version of a knowledge source
 * counts, since older versions are not read by a run. A base that is gone is the run's own error
 * to report, so it contributes nothing here. Statuses carry ids and signal codes, never text.
 */
export async function quarantinedRunMaterial(
  readers: RunMaterialQuarantineReaders,
  material: RunMaterial,
): Promise<readonly ContentScreeningStatus[]> {
  const { brief } = material;
  const jobSources =
    brief === undefined
      ? []
      : await readers.store.quarantined(
          brief.brief.sources.map(
            (source): ContentScreeningSubject => ({
              kind: "job-source",
              workspaceId: brief.workspaceId,
              briefId: brief.brief.id,
              sourceId: source.id,
            }),
          ),
        );
  const bases = [...new Set(material.knowledgeBaseIds)];
  const knowledge = await Promise.all(bases.map((base) => quarantinedKnowledge(readers, base)));
  return [...jobSources, ...knowledge.flat()];
}

async function quarantinedKnowledge(
  readers: RunMaterialQuarantineReaders,
  knowledgeBaseId: string,
): Promise<readonly ContentScreeningStatus[]> {
  if (readers.listSources === undefined) return [];
  let latest: ReadonlyMap<string, string>;
  try {
    const views = await readers.listSources(knowledgeBaseId);
    latest = new Map(views.map(({ source, latestVersion }) => [source.id, latestVersion.id]));
  } catch (error) {
    if (error instanceof HostedKnowledgeIntakeError) return [];
    throw error;
  }
  return (await readers.store.listForKnowledgeBase(knowledgeBaseId)).filter(
    (status) =>
      status.quarantined &&
      status.subject.kind === "knowledge-source-version" &&
      latest.get(status.subject.sourceId) === status.subject.sourceVersionId,
  );
}

/** What the unscreened check reads: the latest stored result of each screened subject. */
export interface RunMaterialScreeningReaders {
  readonly store: Pick<ContentScreeningStore, "listForRecord" | "listForKnowledgeBase">;
  readonly listSources: RunMaterialQuarantineReaders["listSources"];
}

/**
 * The run's material with no stored screening result at all (ADR 0011, phase 2d, #1677), job
 * sources first and then the latest version of each knowledge source. With screening on, such
 * material is never clear: the result may have failed to save, or the material may predate
 * screening or have been saved while it was off. The run start and the worker both ask it, with
 * the same scope as `quarantinedRunMaterial`. Subjects carry ids only, never text.
 */
export async function unscreenedRunMaterial(
  readers: RunMaterialScreeningReaders,
  material: RunMaterial,
): Promise<readonly ContentScreeningSubject[]> {
  const { brief } = material;
  let jobSources: ContentScreeningSubject[] = [];
  if (brief !== undefined) {
    const screened = new Set(
      (await readers.store.listForRecord(brief.workspaceId))
        .filter(
          ({ subject }) => subject.kind === "job-source" && subject.briefId === brief.brief.id,
        )
        .map(({ subject }) => subject.sourceId),
    );
    jobSources = brief.brief.sources
      .filter((source) => !screened.has(source.id))
      .map((source) => ({
        kind: "job-source",
        workspaceId: brief.workspaceId,
        briefId: brief.brief.id,
        sourceId: source.id,
      }));
  }
  const bases = [...new Set(material.knowledgeBaseIds)];
  const knowledge = await Promise.all(bases.map((base) => unscreenedKnowledge(readers, base)));
  return [...jobSources, ...knowledge.flat()];
}

async function unscreenedKnowledge(
  readers: RunMaterialScreeningReaders,
  knowledgeBaseId: string,
): Promise<readonly ContentScreeningSubject[]> {
  if (readers.listSources === undefined) return [];
  let views: readonly HostedKnowledgeSourceView[];
  try {
    views = await readers.listSources(knowledgeBaseId);
  } catch (error) {
    if (error instanceof HostedKnowledgeIntakeError) return [];
    throw error;
  }
  const screened = new Set(
    (await readers.store.listForKnowledgeBase(knowledgeBaseId)).flatMap(({ subject }) =>
      subject.kind === "knowledge-source-version"
        ? [`${subject.sourceId}\u0000${subject.sourceVersionId}`]
        : [],
    ),
  );
  return views
    .filter(({ source, latestVersion }) => !screened.has(`${source.id}\u0000${latestVersion.id}`))
    .map(({ source, latestVersion }) => ({
      kind: "knowledge-source-version",
      knowledgeBaseId,
      sourceId: source.id,
      sourceVersionId: latestVersion.id,
    }));
}

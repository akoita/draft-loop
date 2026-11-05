import { CANDIDATE_EDIT_VERSION_SUFFIX } from "@draft-loop/orchestrator";
import type { ArtifactHistoryStoragePort, HistoryStoragePort } from "@draft-loop/storage";
import type { ApplicationStoragePort } from "@draft-loop/storage/application-store";

import { recordedChoices } from "./recorded-review-choices.js";

/**
 * Review signals (#2251): what one person's review choices say across the runs and applications
 * of a workspace or tenant, read from records DraftLoop already keeps. They feed preference
 * suggestions, which change only the writing policy and never a candidate fact.
 *
 * A deleted term is candidate content: callers keep it in memory and in the tenant's store, and
 * never write it to run history, diagnostics, traces or logs. Deleting a run removes its signals,
 * because they are always derived from the run's own records.
 */

export type ReviewSignalsStorage = Pick<
  HistoryStoragePort,
  "listRuns" | "listFindings" | "listDecisions"
> &
  Pick<ArtifactHistoryStoragePort, "getArtifactVersion"> &
  Pick<ApplicationStoragePort, "applicationIdForRun">;

/** Where a signal was seen: distinct runs and the applications they belong to. */
export interface ReviewSignalSightings {
  readonly runIds: readonly string[];
  readonly applicationIds: readonly string[];
}

/** Findings with this code that the person rejected or overrode. */
export interface DismissedFindingSignal extends ReviewSignalSightings {
  readonly code: string;
  readonly count: number;
}

/** A word the person deleted from a drafted block in their approval edits. */
export interface DeletedTermSignal extends ReviewSignalSightings {
  readonly term: string;
  readonly count: number;
}

/** An approved draft whose section order or set differs from the run's first draft. */
export interface SectionOrderSignal {
  readonly runId: string;
  readonly applicationId: string;
  readonly drafted: readonly string[];
  readonly approved: readonly string[];
  readonly removed: readonly string[];
}

export interface ReviewSignals {
  readonly dismissedFindings: readonly DismissedFindingSignal[];
  readonly deletedTerms: readonly DeletedTermSignal[];
  readonly sectionOrders: readonly SectionOrderSignal[];
}

/** Words shorter than this carry no preference ("a", "of", "to"). */
export const minimumDeletedTermLength = 3;

/** Guards a corrupt parent chain; a run never has this many versions. */
const maximumArtifactChain = 64;

interface ArtifactView {
  readonly id: string;
  readonly parentVersionId: string | null;
  readonly sections: readonly {
    readonly kind: string;
    readonly blocks: readonly { readonly id: string; readonly text: string }[];
  }[];
}

function asArtifact(payload: unknown): ArtifactView | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const { id, parentVersionId, sections } = payload as Record<string, unknown>;
  if (typeof id !== "string" || !Array.isArray(sections)) return undefined;
  const parsed = [];
  for (const section of sections) {
    if (typeof section !== "object" || section === null) return undefined;
    const { kind, blocks } = section as Record<string, unknown>;
    if (typeof kind !== "string" || !Array.isArray(blocks)) return undefined;
    const parsedBlocks = [];
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) return undefined;
      const { id: blockId, text } = block as Record<string, unknown>;
      if (typeof blockId !== "string" || typeof text !== "string") return undefined;
      parsedBlocks.push({ id: blockId, text });
    }
    parsed.push({ kind, blocks: parsedBlocks });
  }
  return {
    id,
    parentVersionId: typeof parentVersionId === "string" ? parentVersionId : null,
    sections: parsed,
  };
}

/** Lower-case words of a text, without punctuation. */
export function reviewTerms(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).filter(
    (word) => word.length >= minimumDeletedTermLength,
  );
}

/** Words of the drafted text that the edited text no longer contains, once each. */
export function deletedTerms(drafted: string, edited: string): string[] {
  const kept = new Set(reviewTerms(edited));
  return [...new Set(reviewTerms(drafted))].filter((term) => !kept.has(term));
}

class Tally {
  private readonly entries = new Map<
    string,
    { count: number; runIds: Set<string>; applicationIds: Set<string> }
  >();

  add(key: string, runId: string, applicationId: string): void {
    const entry = this.entries.get(key) ?? {
      count: 0,
      runIds: new Set<string>(),
      applicationIds: new Set<string>(),
    };
    entry.count += 1;
    entry.runIds.add(runId);
    entry.applicationIds.add(applicationId);
    this.entries.set(key, entry);
  }

  list(): { key: string; count: number; runIds: string[]; applicationIds: string[] }[] {
    return [...this.entries]
      .map(([key, entry]) => ({
        key,
        count: entry.count,
        runIds: [...entry.runIds].sort(),
        applicationIds: [...entry.applicationIds].sort(),
      }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  }
}

async function loadArtifact(
  storage: ReviewSignalsStorage,
  id: string,
): Promise<ArtifactView | undefined> {
  return asArtifact((await storage.getArtifactVersion(id))?.payload);
}

async function firstDraft(
  storage: ReviewSignalsStorage,
  artifact: ArtifactView,
): Promise<ArtifactView> {
  let current = artifact;
  for (let step = 0; step < maximumArtifactChain && current.parentVersionId !== null; step += 1) {
    const parent = await loadArtifact(storage, current.parentVersionId);
    if (parent === undefined) break;
    current = parent;
  }
  return current;
}

/** Every review signal in one workspace or tenant, from its stored runs. */
export async function readReviewSignals(
  storage: ReviewSignalsStorage,
  workspaceId: string,
): Promise<ReviewSignals> {
  const dismissed = new Tally();
  const deleted = new Tally();
  const sectionOrders: SectionOrderSignal[] = [];

  for (const run of await storage.listRuns(workspaceId)) {
    const applicationId = await storage.applicationIdForRun(workspaceId, run.id);
    const decisions = await storage.listDecisions(run.id);
    const codes = new Map((await storage.listFindings(run.id)).map((f) => [f.id, f.code]));
    for (const [findingId, decision] of recordedChoices(decisions, undefined).decisions) {
      const code = codes.get(findingId);
      if (code !== undefined && (decision === "rejected" || decision === "overridden"))
        dismissed.add(code, run.id, applicationId);
    }

    if (run.approval !== "approved" || run.artifactId === null) continue;
    const approved = await loadArtifact(storage, run.artifactId);
    if (approved === undefined) continue;
    const editedFrom =
      approved.parentVersionId !== null &&
      approved.id === `${approved.parentVersionId}${CANDIDATE_EDIT_VERSION_SUFFIX}`
        ? approved.parentVersionId
        : undefined;
    const reviewed = editedFrom === undefined ? approved : await loadArtifact(storage, editedFrom);
    if (reviewed === undefined) continue;

    if (editedFrom !== undefined) {
      const edited = new Map(
        approved.sections.flatMap((section) => section.blocks.map((b) => [b.id, b.text])),
      );
      for (const block of reviewed.sections.flatMap((section) => section.blocks)) {
        const text = edited.get(block.id);
        if (text === undefined || text === block.text) continue;
        for (const term of deletedTerms(block.text, text)) deleted.add(term, run.id, applicationId);
      }
    }

    const drafted = (await firstDraft(storage, reviewed)).sections.map((s) => s.kind);
    const approvedKinds = approved.sections.map((s) => s.kind);
    if (drafted.join("\n") !== approvedKinds.join("\n"))
      sectionOrders.push({
        runId: run.id,
        applicationId,
        drafted,
        approved: approvedKinds,
        removed: drafted.filter((kind) => !approvedKinds.includes(kind)),
      });
  }

  return {
    dismissedFindings: dismissed.list().map(({ key, ...rest }) => ({ code: key, ...rest })),
    deletedTerms: deleted.list().map(({ key, ...rest }) => ({ term: key, ...rest })),
    sectionOrders,
  };
}

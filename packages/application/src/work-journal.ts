// Owns memory kind `pending-evidence`: see packages/domain/src/memory-model.ts and docs/architecture/memory.md.
import { randomBytes } from "node:crypto";
import type { SourceSensitivityTier } from "@draft-loop/domain/source-sensitivity";
import { createRuleContentScreener } from "@draft-loop/ingestion/content-screening-rules";
import {
  checkWorkJournalNoteContent,
  checkWorkJournalNoteInput,
  isLikelyWorkJournalDuplicate,
  maximumWorkJournalAmendingTokens,
  type WorkJournalNoteContent,
  type WorkJournalNoteListItem,
  type WorkJournalNoteStatus,
  type WorkJournalRefusalCode,
  type WorkJournalScreening,
  type WorkJournalStoredNote,
  workJournalDedupeKey,
  workJournalLimits,
  workJournalNoteListItem,
} from "@draft-loop/schemas/work-journal";
import {
  type WorkJournalIntake,
  type WorkJournalNoteStore,
  WorkJournalStoreError,
} from "@draft-loop/storage/work-journal-notes";

import { type ContentScreener, screenWith } from "./content-screening.js";

/**
 * The work journal (ADR 0011 D17, #2018): what an agent's `record_work` call does, and the
 * candidate's review of the notes it files. A note is evidence for review, never a CV claim: it
 * waits as `pending` until the candidate approves it, edits it, merges it into another, or
 * discards it. Every answer and error is content-free, so it can be logged and relayed.
 */

export type WorkJournalErrorCode =
  | WorkJournalRefusalCode
  | "not_consented"
  | "rate_limited"
  | "note_not_found"
  | "note_not_pending"
  | "note_quarantined"
  | "approval_unavailable";

/** Why the work journal refused; the message is one sentence an agent can repeat. */
export class WorkJournalError extends Error {
  readonly code: WorkJournalErrorCode;
  readonly fields: readonly string[];

  constructor(code: WorkJournalErrorCode, message: string, fields: readonly string[] = []) {
    super(message);
    this.name = "WorkJournalError";
    this.code = code;
    this.fields = fields;
  }
}

const refusalMessages: Readonly<Record<WorkJournalRefusalCode, string>> = {
  invalid_note: "The note does not match the work journal's fields; fix the named fields.",
  secret_like_content:
    "The note looks like it holds a key, token or password; remove it and send the note again.",
  link_not_https: "Every link must be an https address.",
  metric_without_how_measured: "Every metric needs how_measured.",
  amend_not_pending: "Only a pending note can be amended.",
};

/** How a recorded note was filed. */
export type WorkJournalRecordStatus =
  | "pending"
  | "amended"
  | "duplicate"
  | "previously_discarded"
  | "validated";

export interface WorkJournalRecordResult {
  readonly note_id?: string;
  readonly status: WorkJournalRecordStatus;
  readonly duplicate_of?: string;
  readonly possible_duplicate_of: readonly string[];
  readonly screening?: WorkJournalScreening["verdict"];
  readonly message: string;
}

/** What approving a note writes into a knowledge base; the approval route calls it (#2022). */
export interface WorkJournalPublishInput {
  readonly workspaceId: string;
  readonly note: WorkJournalStoredNote;
  readonly knowledgeBaseId: string;
  readonly tier: SourceSensitivityTier;
}

export interface WorkJournalPublished {
  readonly sourceId: string;
  readonly status: "created" | "already-present";
}

export type WorkJournalPublish = (input: WorkJournalPublishInput) => Promise<WorkJournalPublished>;

export type WorkJournalReviewAction =
  | {
      readonly action: "approve";
      readonly knowledge_base_id: string;
      /** Defaults from the project's visibility: `normal` when public, else `sensitive`. */
      readonly tier?: SourceSensitivityTier | undefined;
    }
  | { readonly action: "edit"; readonly content: unknown }
  | {
      readonly action: "merge";
      readonly into: string;
      /** Whose summary the merged note keeps; the target's by default. */
      readonly keep_summary?: "into" | "this" | undefined;
    }
  | { readonly action: "discard" };

export interface WorkJournalListOptions {
  readonly status?: WorkJournalNoteStatus | undefined;
  readonly project?: string | undefined;
  readonly since?: string | undefined;
  /** Notes this agent token filed or amended. */
  readonly agentTokenId?: string | undefined;
  readonly limit?: number | undefined;
}

/** Who sent a note: the agent token's id when an agent token did. */
export interface WorkJournalRecordContext {
  readonly agentTokenId?: string | undefined;
}

export interface WorkJournalLimits {
  /** Notes one workspace may file per hour. */
  readonly perHour: number;
  /** Pending notes one tenant may hold. */
  readonly pendingPerTenant: number;
  /** How long a discarded note's text is kept before only its key remains. */
  readonly discardedRetentionDays: number;
}

export const defaultWorkJournalLimits: WorkJournalLimits = Object.freeze({
  perHour: 60,
  pendingPerTenant: 500,
  discardedRetentionDays: 30,
});

export const workJournalListMaximum = 50;

export interface WorkJournalServiceOptions {
  readonly store: WorkJournalNoteStore;
  readonly tenantId: string;
  /** The injection screener; the sprint 1m rules when unset. */
  readonly screener?: ContentScreener;
  readonly publish?: WorkJournalPublish;
  readonly limits?: Partial<WorkJournalLimits>;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export interface WorkJournalService {
  record(
    workspaceId: string,
    input: unknown,
    context?: WorkJournalRecordContext,
  ): Promise<WorkJournalRecordResult>;
  list(workspaceId: string, options?: WorkJournalListOptions): Promise<WorkJournalNoteListItem[]>;
  /** Full notes for the candidate's review; never for the agent. */
  listFull(workspaceId: string, options?: WorkJournalListOptions): Promise<WorkJournalStoredNote[]>;
  get(workspaceId: string, id: string): Promise<WorkJournalStoredNote>;
  /** `publish` replaces the composed publisher for one call, such as with a request's screening. */
  review(
    workspaceId: string,
    id: string,
    action: WorkJournalReviewAction,
    context?: { readonly publish?: WorkJournalPublish },
  ): Promise<WorkJournalStoredNote>;
  intake(workspaceId: string): Promise<WorkJournalIntake>;
  /** Turning intake off deletes the workspace's pending notes. */
  setIntake(workspaceId: string, enabled: boolean): Promise<WorkJournalIntake>;
}

function defaultNoteId(): string {
  return `wjn_${randomBytes(12).toString("base64url")}`;
}

/** The text screened for injection: every field the agent wrote, one per line. */
function screenedText(content: WorkJournalNoteContent): string {
  return [
    content.title,
    content.summary,
    content.project.name,
    content.project.repository ?? "",
    ...content.technologies,
    ...content.metrics.flatMap((metric) => [metric.description, metric.how_measured ?? ""]),
    ...content.links.map((link) => link.url),
  ].join("\n");
}

function defaultTier(content: WorkJournalNoteContent): SourceSensitivityTier {
  return content.project.visibility === "public" ? "normal" : "sensitive";
}

function unionBy<Item>(items: readonly Item[], key: (item: Item) => string): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** The merged content: links and technologies unioned, the period widened, one summary kept. */
export function mergeWorkJournalContent(
  into: WorkJournalNoteContent,
  from: WorkJournalNoteContent,
  keepSummary: "into" | "this" | undefined = "into",
): WorkJournalNoteContent {
  const ends = [into.period.end ?? into.period.start, from.period.end ?? from.period.start];
  const start = [into.period.start, from.period.start].sort()[0] ?? into.period.start;
  const end = ends.sort().at(-1) ?? start;
  return {
    ...into,
    summary: keepSummary === "this" ? from.summary : into.summary,
    period: end === start ? { start } : { start, end },
    technologies: unionBy([...into.technologies, ...from.technologies], (item) =>
      item.toLowerCase(),
    ).slice(0, workJournalLimits.technologiesMax),
    candidate_role: unionBy([...into.candidate_role, ...from.candidate_role], (role) => role),
    links: unionBy([...into.links, ...from.links], (link) => link.url.toLowerCase()).slice(
      0,
      workJournalLimits.linksMax,
    ),
    metrics: unionBy([...into.metrics, ...from.metrics], (metric) =>
      metric.description.toLowerCase(),
    ).slice(0, workJournalLimits.metricsMax),
  };
}

export function createWorkJournalService(options: WorkJournalServiceOptions): WorkJournalService {
  const { store, tenantId, publish } = options;
  const limits = { ...defaultWorkJournalLimits, ...options.limits };
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? defaultNoteId;
  const screener = options.screener ?? createRuleContentScreener(now);

  const screen = async (content: WorkJournalNoteContent): Promise<WorkJournalScreening> => {
    const result = await screenWith(
      [screener],
      { text: screenedText(content), kind: "candidate-source" },
      now,
    );
    return { verdict: result.verdict, signals: result.signals, screened_at: result.screenedAt };
  };

  const likelyDuplicates = async (
    workspaceId: string,
    content: WorkJournalNoteContent,
    exceptId?: string,
  ): Promise<string[]> =>
    (await store.pending(workspaceId))
      .filter((note) => note.id !== exceptId && isLikelyWorkJournalDuplicate(note.content, content))
      .map((note) => note.id)
      .slice(0, 20);

  const requireNote = async (workspaceId: string, id: string) => {
    const note = await store.get(workspaceId, id);
    if (note === undefined) {
      throw new WorkJournalError("note_not_found", "There is no work journal note with that id.");
    }
    return note;
  };

  const requirePending = (note: WorkJournalStoredNote) => {
    if (note.status !== "pending") {
      throw new WorkJournalError("note_not_pending", "Only a pending note can be reviewed.");
    }
  };

  const requireConsent = async (workspaceId: string) => {
    if (!(await store.intake(workspaceId)).enabled) {
      throw new WorkJournalError(
        "not_consented",
        'The candidate has not turned on "Accept notes from agents" in DraftLoop.',
      );
    }
  };

  const requireCapacity = async (workspaceId: string) => {
    const hourAgo = new Date(Date.parse(now()) - 60 * 60 * 1000).toISOString();
    if ((await store.countCreatedSince(workspaceId, hourAgo)) >= limits.perHour) {
      throw new WorkJournalError(
        "rate_limited",
        "Too many notes this hour; record only notable work.",
      );
    }
    if ((await store.countPending()) >= limits.pendingPerTenant) {
      throw new WorkJournalError(
        "rate_limited",
        "Too many notes wait for review; ask the candidate to review them first.",
      );
    }
  };

  const forgetOldDiscarded = async () => {
    const before = new Date(
      Date.parse(now()) - limits.discardedRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    await store.forgetDiscarded(before);
  };

  const amend = async (
    workspaceId: string,
    id: string,
    content: WorkJournalNoteContent,
    agentTokenId: string | undefined,
  ): Promise<WorkJournalRecordResult> => {
    const note = await store.get(workspaceId, id);
    if (note === undefined) {
      throw new WorkJournalError("note_not_found", "There is no work journal note with that id.");
    }
    if (note.status !== "pending") {
      throw new WorkJournalError("amend_not_pending", refusalMessages.amend_not_pending);
    }
    const screening = await screen(content);
    const possible = await likelyDuplicates(workspaceId, content, id);
    const amending =
      agentTokenId === undefined
        ? note.amended_by_agent_token_ids
        : [
            ...(note.amended_by_agent_token_ids ?? []).filter((each) => each !== agentTokenId),
            agentTokenId,
          ].slice(-maximumWorkJournalAmendingTokens);
    await store.replace({
      ...note,
      content,
      screening,
      possible_duplicate_of: possible,
      ...(amending === undefined ? {} : { amended_by_agent_token_ids: amending }),
      updated_at: now(),
    });
    return {
      note_id: id,
      status: "amended",
      possible_duplicate_of: possible,
      screening: screening.verdict,
      message: "The pending note was amended; the candidate reviews it in DraftLoop.",
    };
  };

  const list = async (workspaceId: string, listOptions: WorkJournalListOptions = {}) =>
    store.list({
      workspaceId,
      ...(listOptions.status === undefined ? {} : { status: listOptions.status }),
      ...(listOptions.project === undefined ? {} : { project: listOptions.project }),
      ...(listOptions.since === undefined ? {} : { since: listOptions.since }),
      ...(listOptions.agentTokenId === undefined ? {} : { agentTokenId: listOptions.agentTokenId }),
      limit: Math.min(Math.max(listOptions.limit ?? 20, 1), workJournalListMaximum),
    });

  return {
    record: async (workspaceId, input, context = {}) => {
      const checked = checkWorkJournalNoteInput(input);
      if (!checked.ok) {
        throw new WorkJournalError(checked.code, refusalMessages[checked.code], checked.fields);
      }
      await requireConsent(workspaceId);
      const { dedupe_key: _key, amends, dry_run: dryRun, ...content } = checked.note;
      if (dryRun === true) {
        return {
          status: "validated",
          possible_duplicate_of: [],
          message: "The note is valid; nothing was stored.",
        };
      }
      if (amends !== undefined) return amend(workspaceId, amends, content, context.agentTokenId);
      await forgetOldDiscarded();
      const key = workJournalDedupeKey(checked.note);
      const holder = await store.holderOfKey(key);
      if (holder?.kind === "forgotten" || holder?.note.status === "discarded") {
        return {
          status: "previously_discarded",
          duplicate_of: holder.kind === "note" ? holder.note.id : holder.noteId,
          possible_duplicate_of: [],
          message: "The candidate discarded this work before; it was not recorded again.",
        };
      }
      if (holder !== undefined) {
        return {
          note_id: holder.note.id,
          status: "duplicate",
          duplicate_of: holder.note.id,
          possible_duplicate_of: [],
          message: "This work is already in the journal; amend that note instead.",
        };
      }
      await requireCapacity(workspaceId);
      const screening = await screen(content);
      const possible = await likelyDuplicates(workspaceId, content);
      const at = now();
      const id = newId();
      try {
        await store.insert({
          id,
          tenant_id: tenantId,
          workspace_id: workspaceId,
          status: "pending",
          content,
          dedupe_key: key,
          possible_duplicate_of: possible,
          screening,
          edit_count: 0,
          ...(context.agentTokenId === undefined ? {} : { agent_token_id: context.agentTokenId }),
          created_at: at,
          updated_at: at,
        });
      } catch (error) {
        // A concurrent call filed the same key first.
        if (error instanceof WorkJournalStoreError && error.code === "duplicate_key") {
          const raced = await store.holderOfKey(key);
          if (raced?.kind === "note") {
            return {
              note_id: raced.note.id,
              status: "duplicate",
              duplicate_of: raced.note.id,
              possible_duplicate_of: [],
              message: "This work is already in the journal; amend that note instead.",
            };
          }
        }
        throw error;
      }
      return {
        note_id: id,
        status: "pending",
        possible_duplicate_of: possible,
        screening: screening.verdict,
        message:
          screening.verdict === "clear"
            ? "Recorded; the candidate reviews it in DraftLoop before it becomes evidence."
            : "Recorded but held by screening; the candidate decides in DraftLoop.",
      };
    },

    list: async (workspaceId, listOptions) =>
      (await list(workspaceId, listOptions)).map(workJournalNoteListItem),

    listFull: async (workspaceId, listOptions) => [...(await list(workspaceId, listOptions))],

    get: requireNote,

    review: async (workspaceId, id, action, context) => {
      const note = await requireNote(workspaceId, id);
      requirePending(note);
      const at = now();
      switch (action.action) {
        case "discard": {
          const discarded = { ...note, status: "discarded" as const, updated_at: at };
          await store.replace(discarded);
          return discarded;
        }
        case "edit": {
          const checked = checkWorkJournalNoteContent(action.content);
          if (!checked.ok) {
            throw new WorkJournalError(checked.code, refusalMessages[checked.code], checked.fields);
          }
          const edited = {
            ...note,
            content: checked.note,
            screening: await screen(checked.note),
            possible_duplicate_of: await likelyDuplicates(workspaceId, checked.note, id),
            edit_count: note.edit_count + 1,
            updated_at: at,
          };
          await store.replace(edited);
          return edited;
        }
        case "merge": {
          if (action.into === id) {
            throw new WorkJournalError("note_not_pending", "A note cannot be merged into itself.");
          }
          const target = await requireNote(workspaceId, action.into);
          requirePending(target);
          const content = mergeWorkJournalContent(
            target.content,
            note.content,
            action.keep_summary,
          );
          const merged = {
            ...target,
            content,
            screening: await screen(content),
            possible_duplicate_of: target.possible_duplicate_of.filter((other) => other !== id),
            edit_count: target.edit_count + 1,
            updated_at: at,
          };
          await store.replace(merged);
          await store.replace({
            ...note,
            status: "merged",
            merged_into: target.id,
            possible_duplicate_of: [],
            updated_at: at,
          });
          return merged;
        }
        case "approve": {
          if (note.screening.verdict !== "clear") {
            throw new WorkJournalError(
              "note_quarantined",
              "Screening holds this note; edit it or discard it.",
            );
          }
          const publisher = context?.publish ?? publish;
          if (publisher === undefined) {
            throw new WorkJournalError(
              "approval_unavailable",
              "This server cannot turn notes into career evidence yet.",
            );
          }
          const tier = action.tier ?? defaultTier(note.content);
          const published = await publisher({
            workspaceId,
            note,
            knowledgeBaseId: action.knowledge_base_id,
            tier,
          });
          const approved = {
            ...note,
            status: "approved" as const,
            approval: {
              knowledge_base_id: action.knowledge_base_id,
              tier,
              source_id: published.sourceId,
              approved_at: at,
            },
            updated_at: at,
          };
          await store.replace(approved);
          return approved;
        }
      }
    },

    intake: (workspaceId) => store.intake(workspaceId),

    setIntake: async (workspaceId, enabled) => {
      const intake = await store.setIntake(workspaceId, enabled, now());
      if (!enabled) await store.deletePending(workspaceId);
      return intake;
    },
  };
}

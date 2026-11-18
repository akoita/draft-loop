import { resolve } from "node:path";

import type { ContextSnapshot } from "@draft-loop/domain";
import { createStorageRunStore } from "@draft-loop/orchestrator";
import { contextSnapshotSchema } from "@draft-loop/schemas";
import {
  type RunRequirementEvidence,
  type RunRequirementEvidenceCandidate,
  runRequirementEvidenceSchema,
} from "@draft-loop/schemas/run-requirement-evidence";
import { z } from "zod";

import type { StatusCommand } from "./index.js";
import { readWorkspace } from "./local.js";
import { openRunHistory } from "./run-history-read.js";

/*
 * Which evidence supports each requirement of a run (#3009, #2984), read back from the run's
 * `run.requirement-evidence-map` event and, when the run graded it, its latest
 * `run.requirement-evidence-grade` event. Both are content-free, so the answer names sources and
 * lines but never quotes evidence or the grader's reasons.
 */

export const requirementEvidenceMapEventType = "run.requirement-evidence-map";
export const requirementEvidenceGradeEventType = "run.requirement-evidence-grade";

const mapPayloadSchema = z.object({
  mode: z.enum(["semantic", "keyword"]),
  reason: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  chunkCount: z.number().int().nonnegative(),
  entries: z.array(
    z.object({
      requirementId: z.string().min(1),
      candidates: z.array(
        z.object({
          chunkId: z.string().min(1),
          origin: z.enum(["semantic", "keyword", "both"]),
          score: z.number().min(-1).max(1).optional(),
          sourceId: z.string().min(1).optional(),
          lineStart: z.number().int().nonnegative().optional(),
          lineEnd: z.number().int().nonnegative().optional(),
        }),
      ),
    }),
  ),
});

const gradePayloadSchema = z.object({
  status: z.enum(["graded", "failed"]),
  entries: z.array(
    z.object({
      requirementId: z.string().min(1),
      grades: z.array(
        z.object({
          chunkId: z.string().min(1),
          grade: z.enum(["supports", "partly-supports", "does-not-support"]),
        }),
      ),
    }),
  ),
});

/** A source's name: the last segment of the path the run recorded for it. */
function sourceName(path: string): string {
  const segments = path.split(/[\\/]/u).filter((segment) => segment !== "");
  return segments.at(-1) ?? path;
}

/**
 * The run's map with requirement texts, source names and grades folded in. Undefined when the map
 * payload is malformed; a malformed grade payload is ignored rather than failing the map.
 */
export function runRequirementEvidence(
  runId: string,
  mapPayload: unknown,
  gradePayload: unknown,
  context: Pick<ContextSnapshot, "evidenceManifest" | "requirements"> | undefined,
): RunRequirementEvidence | undefined {
  const map = mapPayloadSchema.safeParse(mapPayload);
  if (!map.success) return undefined;
  const grade = gradePayloadSchema.safeParse(gradePayload);
  const grades = new Map(
    grade.success
      ? grade.data.entries.flatMap(({ requirementId, grades: pairs }) =>
          pairs.map(({ chunkId, grade: value }) => [`${requirementId}\u0000${chunkId}`, value]),
        )
      : [],
  );
  const sources = new Map<string, string>(
    (context?.evidenceManifest ?? []).map(({ id, path }) => [id, sourceName(path)]),
  );
  const texts = new Map<string, string>(
    (context?.requirements ?? []).map(({ id, text }) => [id, text]),
  );
  return runRequirementEvidenceSchema.parse({
    runId,
    mode: map.data.mode,
    ...(map.data.reason === undefined ? {} : { reason: map.data.reason }),
    ...(map.data.modelId === undefined ? {} : { modelId: map.data.modelId }),
    chunkCount: map.data.chunkCount,
    ...(grade.success ? { grading: grade.data.status } : {}),
    requirements: map.data.entries.map(({ requirementId, candidates }) => {
      const text = texts.get(requirementId);
      return {
        requirementId,
        ...(text === undefined ? {} : { text }),
        candidates: candidates.map(({ chunkId, origin, score, sourceId, lineStart, lineEnd }) => {
          const source = sourceId === undefined ? undefined : sources.get(sourceId);
          const graded = grades.get(`${requirementId}\u0000${chunkId}`);
          const candidate: RunRequirementEvidenceCandidate = {
            chunkId,
            origin,
            ...(score === undefined ? {} : { score }),
            ...(source === undefined ? {} : { source }),
            ...(lineStart === undefined ? {} : { lineStart }),
            ...(lineEnd === undefined ? {} : { lineEnd }),
            ...(graded === undefined ? {} : { grade: graded }),
          };
          return candidate;
        }),
      };
    }),
  });
}

/**
 * The requirement-evidence map of the given run, or of the workspace's latest run. Undefined when
 * there is no run, no history, no map event for the run, or a malformed map payload.
 */
export async function readRunRequirementEvidence(
  command: StatusCommand,
): Promise<RunRequirementEvidence | undefined> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const runId = command.runId ?? config.latestRunId;
  if (runId === undefined) return undefined;
  const storage = await openRunHistory(root);
  if (storage === undefined) return undefined;
  try {
    const query = { workspaceId: config.id, entityType: "run", entityId: runId } as const;
    const mapEvent = await storage.auditEvents.findLatestAuditEvent({
      ...query,
      eventType: requirementEvidenceMapEventType,
    });
    if (mapEvent === undefined) return undefined;
    const gradeEvent = await storage.auditEvents.findLatestAuditEvent({
      ...query,
      eventType: requirementEvidenceGradeEventType,
    });
    const snapshot = await createStorageRunStore(storage).loadRun(runId);
    const contextRecord =
      snapshot === undefined || snapshot.workspaceId !== config.id
        ? undefined
        : await storage.getContextSnapshot(snapshot.contextSnapshotId);
    const context =
      contextRecord === undefined
        ? undefined
        : (contextSnapshotSchema.parse(contextRecord.payload) as unknown as ContextSnapshot);
    return runRequirementEvidence(runId, mapEvent.payload, gradeEvent?.payload, context);
  } finally {
    await storage.close();
  }
}

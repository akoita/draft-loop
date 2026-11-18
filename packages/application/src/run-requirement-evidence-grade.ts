import { randomUUID } from "node:crypto";

import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject, ModelResponse } from "@draft-loop/providers";
import type { AuditTrailStoragePort, JsonValue } from "@draft-loop/storage";

import {
  applyRequirementEvidenceGrades,
  type GradedRequirementEvidenceMap,
  parseRequirementEvidenceGrades,
  requirementEvidenceGradeInput,
  requirementEvidenceGradeOutputSchema,
  requirementEvidenceGradeSummary,
  requirementEvidenceGradeSystemPrompt,
} from "./requirement-evidence-grade.js";
import type { RequirementEvidenceMap } from "./requirement-evidence-map.js";

/*
 * Runs the requirement-evidence grade (#2996, #2982) on the critic step: one call on the run's
 * critic model, billed on the critique's record like the omission check. Off unless the
 * DRAFT_LOOP_EVIDENCE_GRADE setting is `on`, until the paid comparison (#2985) decides. A failed
 * call leaves the map ungraded and never fails the critique; an abort is rethrown.
 */

export const requirementEvidenceGradeSetting = "DRAFT_LOOP_EVIDENCE_GRADE";

/** Whether runs grade their requirement-evidence map; off by default. */
export function requirementEvidenceGradeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[requirementEvidenceGradeSetting]?.trim().toLowerCase() === "on";
}

/** What the critic needs to grade a run's map, and where the result goes. */
export interface RequirementEvidenceGradeHook {
  readonly map: () => Promise<RequirementEvidenceMap | undefined>;
  readonly eligible: () => Promise<readonly ScoredEvidenceChunk[]>;
  readonly record: (runId: string, map: GradedRequirementEvidenceMap) => Promise<void>;
}

/** A run's grading hook when the setting is on and the run has a map; otherwise undefined. */
export function runRequirementEvidenceGradeHook(
  retrieval:
    | {
        readonly requirementEvidenceMap?: () => Promise<RequirementEvidenceMap | undefined>;
        readonly fullSourceEvidence?: () => Promise<readonly ScoredEvidenceChunk[]>;
      }
    | undefined,
  storage: Pick<AuditTrailStoragePort, "appendAuditEvent">,
  workspaceId: string,
  enabled: boolean = requirementEvidenceGradeEnabled(),
): RequirementEvidenceGradeHook | undefined {
  const map = retrieval?.requirementEvidenceMap;
  const eligible = retrieval?.fullSourceEvidence;
  if (!enabled || map === undefined || eligible === undefined) return undefined;
  return {
    map,
    eligible,
    record: async (runId, graded) => {
      await storage.appendAuditEvent({
        id: `requirement-evidence-grade:${runId}:${randomUUID()}`,
        workspaceId,
        eventType: "run.requirement-evidence-grade",
        entityType: "run",
        entityId: runId,
        payload: requirementEvidenceGradeAuditPayload(graded),
        createdAt: new Date().toISOString(),
      });
    },
  };
}

/** Content-free: the summary and each candidate's grade by id, never the grader's reasons. */
export function requirementEvidenceGradeAuditPayload(map: GradedRequirementEvidenceMap): {
  readonly [key: string]: JsonValue;
} {
  return {
    ...requirementEvidenceGradeSummary(map),
    entries: map.entries.map(({ requirementId, candidates }) => ({
      requirementId,
      grades: candidates.flatMap(({ chunkId, grade }) =>
        grade === undefined ? [] : [{ chunkId, grade }],
      ),
    })),
  };
}

export type GradeCall = (request: {
  readonly systemPrompt: string;
  readonly input: JsonObject;
  readonly outputSchema: JsonObject;
  readonly outputName: string;
}) => Promise<ModelResponse<JsonObject>>;

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

/**
 * Grades the run's map with one call and records the result. Returns the call's usage and cost
 * for the critique's record, or undefined when no call was billed.
 */
export async function gradeRunRequirementEvidence(input: {
  readonly hook: RequirementEvidenceGradeHook;
  readonly requirements: readonly { readonly id: string; readonly text: string }[];
  readonly runId: string;
  readonly call: GradeCall;
  readonly signal?: AbortSignal;
}): Promise<Pick<ModelResponse<JsonObject>, "usage" | "cost"> | undefined> {
  const map = await input.hook.map();
  if (map === undefined) return undefined;
  const gradeInput = requirementEvidenceGradeInput(
    map,
    input.requirements,
    await input.hook.eligible(),
  );
  if (gradeInput === undefined) return undefined;
  let response: ModelResponse<JsonObject>;
  try {
    response = await input.call({
      systemPrompt: requirementEvidenceGradeSystemPrompt,
      input: JSON.parse(JSON.stringify(gradeInput)) as JsonObject,
      outputSchema: requirementEvidenceGradeOutputSchema,
      outputName: "requirement_evidence_grade",
    });
  } catch (error) {
    if (isAbort(error, input.signal)) throw error;
    await input.hook.record(input.runId, applyRequirementEvidenceGrades(map, undefined));
    return undefined;
  }
  await input.hook.record(
    input.runId,
    applyRequirementEvidenceGrades(
      map,
      parseRequirementEvidenceGrades(response.output, gradeInput),
    ),
  );
  return { usage: response.usage, cost: response.cost };
}

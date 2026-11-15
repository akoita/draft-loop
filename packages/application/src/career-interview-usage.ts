import { randomUUID } from "node:crypto";

import type { AuditTrailStoragePort } from "@draft-loop/storage";

/** The audit event each career interviewer call appends; month usage counts each one (#2758). */
export const careerInterviewModelCallEventType = "career-interview.model-call";

/** One interviewer call's identity and amounts: counts only, never the conversation. */
export interface CareerInterviewModelCall {
  readonly provider: string;
  readonly modelId: string;
  /** Null when the call failed before a route was known. */
  readonly route: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Null when the call could not be priced. */
  readonly estimatedUsd: number | null;
  readonly completedAt: string;
}

/** Append one interviewer call to the session's audit trail, where month usage reads it. */
export async function recordCareerInterviewModelCall(
  storage: Pick<AuditTrailStoragePort, "appendAuditEvent">,
  workspaceId: string,
  sessionId: string,
  call: CareerInterviewModelCall,
): Promise<void> {
  await storage.appendAuditEvent({
    id: `career-interview-call:${sessionId}:${randomUUID()}`,
    workspaceId,
    eventType: careerInterviewModelCallEventType,
    entityType: "career-interview-session",
    entityId: sessionId,
    payload: { schemaVersion: 1, ...call },
    createdAt: call.completedAt,
  });
}

/**
 * The billed amounts a failed call carries, such as an answer cut off at its output limit, or
 * `undefined` when the provider billed nothing.
 */
export function billedCallUsage(error: unknown):
  | {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly estimatedUsd: number | null;
    }
  | undefined {
  const billed = (error as { readonly billed?: unknown } | null)?.billed as
    | {
        readonly usage?: { readonly inputTokens?: unknown; readonly outputTokens?: unknown };
        readonly cost?: { readonly estimatedUsd?: unknown };
      }
    | null
    | undefined;
  if (billed === null || billed === undefined) return undefined;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  const inputTokens = count(billed.usage?.inputTokens);
  const outputTokens = count(billed.usage?.outputTokens);
  const cost = billed.cost?.estimatedUsd;
  const estimatedUsd = typeof cost === "number" && Number.isFinite(cost) ? cost : null;
  if (inputTokens === 0 && outputTokens === 0 && (estimatedUsd ?? 0) === 0) return undefined;
  return { inputTokens, outputTokens, estimatedUsd };
}

import { randomUUID } from "node:crypto";

import type { FactUsageSettings } from "@draft-loop/domain/fact-usage";
import { factUsageSettingsSchema } from "@draft-loop/schemas/fact-usage";
import type { AuditEventReadsPort, AuditTrailStoragePort } from "@draft-loop/storage";

import { readFactUsage } from "./fact-usage.js";

/**
 * The usage levels a run works with (#2685). The first time a run opens its evidence, the levels
 * in force are recorded beside it as a `run.fact-usage` audit event, keyed by the run's context
 * snapshot; every later resume uses that record. A level changed while the run waits then applies
 * to the next run, not to the one in progress. The record holds sections, fact usage keys and
 * levels, never fact text.
 *
 * A storage without an audit trail, or a record that no longer parses, falls back to the levels in
 * force now: a run never proceeds on levels it cannot read.
 */
export const runFactUsageEventType = "run.fact-usage";
const entityType = "context-snapshot";

export type RunFactUsageStorage = Partial<Pick<AuditTrailStoragePort, "appendAuditEvent">> & {
  readonly auditEvents?: Pick<AuditEventReadsPort, "findLatestAuditEvent">;
};

export interface RunFactUsageRequest {
  readonly storage: RunFactUsageStorage;
  readonly root: string;
  readonly workspaceId: string;
  readonly contextSnapshotId: string;
  readonly now?: () => Date;
}

export async function runFactUsage(request: RunFactUsageRequest): Promise<FactUsageSettings> {
  const { storage, workspaceId, contextSnapshotId } = request;
  const recorded = await storage.auditEvents?.findLatestAuditEvent({
    workspaceId,
    eventType: runFactUsageEventType,
    entityType,
    entityId: contextSnapshotId,
  });
  if (recorded !== undefined) {
    const parsed = factUsageSettingsSchema.safeParse(recorded.payload);
    if (parsed.success) return parsed.data as FactUsageSettings;
  }
  const current = await readFactUsage(request.root);
  if (storage.appendAuditEvent !== undefined && storage.auditEvents !== undefined) {
    await storage.appendAuditEvent({
      id: `fact-usage:${contextSnapshotId}:${randomUUID()}`,
      workspaceId,
      eventType: runFactUsageEventType,
      entityType,
      entityId: contextSnapshotId,
      payload: factUsageSettingsSchema.parse(current),
      createdAt: (request.now ?? (() => new Date()))().toISOString(),
    });
  }
  return current;
}

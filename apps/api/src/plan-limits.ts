import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import {
  type MemberRecord,
  type MemberRole,
  type TenantDirectory,
  TenantDirectoryError,
} from "@draft-loop/storage/tenant-directory";

import { EntitlementRefusedError, type TenantEntitlementsFor } from "./entitlement-gate.js";

/**
 * Holds seats and candidate records to the organisation's plan (ADR 0011, D13). Sign-in mode
 * only: owner-token mode builds none of this, because its tenant has no organisation to hold a
 * plan, the same as the run-start gate. An organisation with no plan is refused with
 * `plan_required`; a refusal at the limit is `plan_limit_reached`, 409, naming the limit and its
 * value and nothing else.
 */
export interface PlanLimits {
  /**
   * The most members the plan allows, active and invited together, or undefined for unlimited.
   * Throws `plan_required` when the organisation has no plan.
   */
  readonly seatLimit: (tenantId: string) => Promise<number | undefined>;
  /**
   * Throws unless one more candidate record fits the plan. Records are counted as the record
   * listing counts them: a record being erased is already gone, so it takes no slot.
   */
  readonly requireRecordRoom: (tenantId: string) => Promise<void>;
}

export interface PlanLimitsOptions {
  readonly entitlementsFor: TenantEntitlementsFor;
  /** Needed to count records; a deployment that serves no workspaces has none to count. */
  readonly recordAccessFor?: (tenantId: string) => Pick<CandidateRecordAccess, "listRecords">;
}

export function createPlanLimits(options: PlanLimitsOptions): PlanLimits {
  const entitlementsOf = async (tenantId: string) => {
    const entitlements = await options.entitlementsFor(tenantId).entitlements();
    if (entitlements === undefined) throw new EntitlementRefusedError({ code: "plan_required" });
    return entitlements;
  };
  return {
    seatLimit: async (tenantId) => (await entitlementsOf(tenantId)).seats ?? undefined,
    requireRecordRoom: async (tenantId) => {
      const { candidateRecords } = await entitlementsOf(tenantId);
      if (candidateRecords === null) return;
      if (options.recordAccessFor === undefined) {
        throw new Error("Candidate records are counted only with candidate record access.");
      }
      const records = await options.recordAccessFor(tenantId).listRecords();
      if (records.length >= candidateRecords) {
        throw new EntitlementRefusedError({
          code: "plan_limit_reached",
          limit: "candidateRecords",
          value: candidateRecords,
        });
      }
    },
  };
}

/**
 * Invites a member within the plan's seats. The directory counts under the organisation's lock,
 * in the same transaction as the insert, so racing invitations cannot pass the limit. An email
 * already invited or active is refused by the directory as `member_exists` before any seat is
 * counted, so a re-invitation never takes a second seat. Without limits (owner-token mode) it is
 * a plain invitation.
 */
export async function inviteWithinSeats(
  directory: TenantDirectory,
  limits: PlanLimits | undefined,
  input: { organisationId: string; email: string; role: MemberRole },
): Promise<MemberRecord> {
  const maxMembers = await limits?.seatLimit(input.organisationId);
  if (maxMembers === undefined) return directory.inviteMember(input);
  try {
    return await directory.inviteMember({ ...input, maxMembers });
  } catch (error) {
    if (error instanceof TenantDirectoryError && error.code === "member_limit_reached") {
      throw new EntitlementRefusedError({
        code: "plan_limit_reached",
        limit: "seats",
        value: maxMembers,
      });
    }
    throw error;
  }
}

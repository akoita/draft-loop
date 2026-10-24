import type { FastifyRequest } from "fastify";

/** What a refusal was about: a candidate record, a run or a knowledge base. */
export type AccessRefusalResource = "record" | "run" | "knowledge-base";

/**
 * Why the API refused it: it belongs to another tenant, the member is not assigned to the record
 * that holds it, or the member's role does not allow the action.
 */
export type AccessRefusalReason = "other-tenant" | "unassigned" | "role";

export interface AccessRefusal {
  readonly resource: AccessRefusalResource;
  readonly reason: AccessRefusalReason;
  /** The record, run or knowledge base id the request named. */
  readonly resourceId: string;
}

/**
 * One `WARNING` line for a refusal the code knows is one (ADR 0011, D16), so the owner can be
 * alerted on it. The answer is unchanged: a record, run or base the caller cannot reach still
 * answers 404, and an action their role forbids 403. A 404 for an id that does not exist is not
 * a refusal and is not logged, and neither is one that row-level security hides, which the code
 * cannot tell from a missing row. Ids and codes only, never a name, title, email or reason.
 */
export function logAccessRefusal(request: FastifyRequest, refusal: AccessRefusal): void {
  const { caller } = request;
  // The owner token reaches every record of the tenant it acts in, so it is never refused.
  if (caller?.kind !== "member") return;
  request.log.warn(
    {
      accessRefusal: {
        resource: refusal.resource,
        reason: refusal.reason,
        tenantId: caller.tenantId,
        memberId: caller.memberId,
        resourceId: refusal.resourceId,
      },
    },
    "access refused",
  );
}

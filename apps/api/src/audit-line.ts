import type { FastifyRequest } from "fastify";

/**
 * One content-free audit line (#2954): who did what to which organisation or record, with ids and
 * counts only, never an email, a token or any text a member wrote. Every line has the message
 * `audit` and an `audit` field, so one log query finds them all; a named operator's lines also
 * carry `operatorSubject` from the request's logger.
 */
export function writeAuditLine(
  request: Pick<FastifyRequest, "caller" | "log">,
  action: string,
  fields: Record<string, string | number | boolean | null> = {},
): void {
  const caller = request.caller;
  const actor = caller?.kind === "member" ? caller.memberId : "owner-token";
  request.log.info({ audit: { action, actor, ...fields } }, "audit");
}

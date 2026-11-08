import type { FastifyInstance } from "fastify";

/** The directory's activity store, as far as the API needs it (#2538). */
export interface OrganisationActivityRecorder {
  readonly touch: (organisationId: string, now: Date) => Promise<boolean>;
}

export interface OrganisationActivityOptions {
  readonly activity: OrganisationActivityRecorder;
  /** How long one instance waits before writing the same organisation again; the store also throttles. */
  readonly intervalMs?: number;
  readonly now?: () => Date;
}

const defaultIntervalMs = 60 * 60 * 1000;

/**
 * Records that an organisation was active (#2538), for the beta's retention (#2463): after each
 * request a signed-in member made, at most once an interval per organisation and instance. Only
 * the organisation and the time are kept. Owner-token, operator and agent-token requests are not
 * a person's activity and are not recorded. A failed write is logged and never fails the request.
 */
export function registerOrganisationActivity(
  app: FastifyInstance,
  options: OrganisationActivityOptions,
): (organisationId: string) => Promise<void> {
  const intervalMs = options.intervalMs ?? defaultIntervalMs;
  const now = options.now ?? (() => new Date());
  const lastWrite = new Map<string, number>();

  const record = async (organisationId: string): Promise<void> => {
    const at = now();
    const previous = lastWrite.get(organisationId);
    if (previous !== undefined && at.getTime() - previous < intervalMs) return;
    lastWrite.set(organisationId, at.getTime());
    if (lastWrite.size > 10_000) {
      for (const [key, time] of lastWrite) {
        if (at.getTime() - time >= intervalMs) lastWrite.delete(key);
      }
    }
    try {
      await options.activity.touch(organisationId, at);
    } catch (error) {
      lastWrite.delete(organisationId);
      app.log.warn({ err: error }, "organisation activity not recorded");
    }
  };

  app.addHook("onResponse", async (request, reply) => {
    const caller = request.caller;
    if (caller?.kind !== "member" || request.agentToken !== undefined) return;
    if (reply.statusCode >= 500) return;
    await record(caller.tenantId);
  });
  return record;
}

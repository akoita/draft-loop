import type { FastifyInstance } from "fastify";

import { apiError } from "./errors.js";

/**
 * The routes that destroy or export a whole organisation's or record's data (#2952), by method and
 * route pattern.
 */
const guardedRoutes: ReadonlyArray<{ readonly method: string; readonly url: string }> = [
  { method: "DELETE", url: "/v1/organisation" },
  { method: "DELETE", url: "/v1/workspaces/:workspaceId" },
  { method: "GET", url: "/v1/workspaces/:workspaceId/archive" },
  { method: "GET", url: "/v1/workspaces/:workspaceId/export" },
];

export interface SecondFactorGateOptions {
  /** How many members the organisation has, invited ones included. */
  readonly memberCount: (organisationId: string) => Promise<number>;
}

/**
 * Sign-in mode: an owner or admin of an organisation with other members erases or exports only
 * from a sign-in that used a second factor, since they can destroy or take away other people's
 * work (#2952). A person alone in their organisation keeps the typed confirmation, so erasing or
 * exporting their own data never needs an authenticator. Refused with 403
 * `second_factor_required`; other members are left to each route's own role check.
 */
export function registerSecondFactorGate(
  app: FastifyInstance,
  options: SecondFactorGateOptions,
): void {
  app.addHook("preHandler", async (request, reply) => {
    const caller = request.caller;
    if (caller?.kind !== "member" || caller.secondFactor === true) return;
    if (caller.role !== "owner" && caller.role !== "admin") return;
    const guarded = guardedRoutes.some(
      (route) => route.method === request.method && route.url === request.routeOptions.url,
    );
    if (!guarded) return;
    if ((await options.memberCount(caller.tenantId)) <= 1) return;
    request.log.warn(
      { event: "second_factor_required", organisationId: caller.tenantId },
      "second factor required",
    );
    await reply
      .code(403)
      .send(
        apiError(
          "second_factor_required",
          "Your organisation has other members, so this needs a sign-in with a second factor. Set up an authenticator in your account, sign in again, and retry.",
        ),
      );
  });
}

import {
  clientErrorKinds,
  clientErrorReport,
  clientErrorStackMaxFrames,
} from "@draft-loop/domain/client-error-report";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

/**
 * Public: a screen can crash before anyone signs in, and the report holds nothing to protect.
 * The route is listed with the other public routes in `web-screen.ts`.
 */
export const clientErrorsPath = "/v1/client-errors";

/** Reports one address may send per window; more are refused without a log line. */
export const clientErrorReportsPerWindow = 10;
export const clientErrorWindowMs = 10 * 60 * 1000;
/** A report is small; anything larger is refused before it is parsed. */
export const clientErrorBodyLimitBytes = 8 * 1024;

const reportBody = z.strictObject({
  kind: z.enum(clientErrorKinds),
  message: z.string().max(1000),
  stack: z.array(z.string().max(300)).max(clientErrorStackMaxFrames).optional(),
  route: z.string().max(500),
  build: z.string().max(300),
});

export interface ClientErrorRoutesOptions {
  readonly now?: () => number;
}

/**
 * Logs a crash in the web screen as one content-free line (#2464). The API scrubs the report
 * again with the screen's rules, so an old or forged screen cannot log text through it.
 */
export function registerClientErrorRoutes(
  app: FastifyInstance,
  options: ClientErrorRoutesOptions = {},
): void {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; reports: number }>();

  const admit = (address: string): boolean => {
    const at = now();
    for (const [key, window] of windows) {
      if (at - window.start >= clientErrorWindowMs) windows.delete(key);
    }
    const window = windows.get(address) ?? { start: at, reports: 0 };
    window.reports += 1;
    windows.set(address, window);
    return window.reports <= clientErrorReportsPerWindow;
  };

  app.withTypeProvider<ZodTypeProvider>().post(
    clientErrorsPath,
    {
      bodyLimit: clientErrorBodyLimitBytes,
      schema: {
        summary: "Report a crash in the web screen",
        description:
          "Takes an uncaught error or rejected promise from the web screen: its kind, message, stack frames, the screen's path and the build. The API removes quoted text, addresses, numbers, queries and ids before it logs one line. 429 rate_limited after 10 reports in 10 minutes from one address.",
        security: [],
        body: reportBody,
        response: { 204: z.null(), 429: apiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!admit(request.ip)) {
        return reply.code(429).send(apiError("rate_limited", "Too many reports; retry later."));
      }
      const report = clientErrorReport(request.body);
      request.log.error({ event: "client_error", clientError: report }, "browser error reported");
      return reply.code(204).send(null);
    },
  );
}

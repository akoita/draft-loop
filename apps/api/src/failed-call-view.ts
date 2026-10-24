import type { FailedProviderCall } from "@draft-loop/orchestrator";
import { z } from "zod";

/**
 * The provider call a run's failure came from (#1568), so a client can say whether the author's
 * or the critic's company refused it. Identities and short tokens only, never a message.
 */
export const failedCallViewSchema = z
  .object({
    role: z.enum(["author", "critic"]),
    company: z.string(),
    model: z.string(),
    route: z.string().nullable().describe("The endpoint the call went to, such as `vertex-ai`."),
    status: z.number().int().nullable().describe("The HTTP status the provider answered with."),
    providerErrorType: z.string().nullable(),
    providerErrorCode: z.string().nullable(),
    rateLimit: z
      .string()
      .nullable()
      .describe("On a 429, the limit that ran out: requests, tokens, input or output tokens."),
    retryAfterSeconds: z.number().int().nullable(),
  })
  .describe("Present when the run stopped on a provider call that it names.");

export function failedCallView(call: FailedProviderCall | undefined): {
  readonly failedCall?: z.infer<typeof failedCallViewSchema>;
} {
  if (call === undefined) return {};
  return {
    failedCall: {
      role: call.role,
      company: call.company,
      model: call.model,
      route: call.route ?? null,
      status: call.status ?? null,
      providerErrorType: call.providerErrorType ?? null,
      providerErrorCode: call.providerErrorCode ?? null,
      rateLimit: call.rateLimit ?? null,
      retryAfterSeconds: call.retryAfterSeconds ?? null,
    },
  };
}

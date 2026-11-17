import { z } from "zod";

/**
 * The planned-maintenance notice as `GET /v1/service-notice` returns it (#2965): the web banner
 * and agents read the same answer. It holds dates and a flag only, never a cause.
 */
export const serviceNoticeStateSchema = z.enum(["upcoming", "ongoing", "overrunning"]);

export const serviceNoticeSchema = z.object({
  kind: z.literal("maintenance"),
  startsAt: z.string(),
  endsAt: z.string(),
  readOnly: z.boolean(),
  state: serviceNoticeStateSchema,
});

export const serviceNoticeResponseSchema = z.object({ notice: serviceNoticeSchema.nullable() });

export type ServiceNoticeAnswer = z.infer<typeof serviceNoticeResponseSchema>;

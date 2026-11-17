import { z } from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);

/**
 * What a queued career profile derivation carries: ids and the person's choices, never candidate
 * material. The worker reads the workspace's selected evidence when it claims the job.
 */
export const profileDerivationJobSchema = z.strictObject({
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  profileId: identifierSchema,
  /** The person approved sending the selected evidence to the workspace's author company. */
  providerDataApproved: z.boolean(),
  /** Extract every source again instead of only new or changed ones. */
  fullExtraction: z.boolean().optional(),
});

export type ProfileDerivationJob = z.infer<typeof profileDerivationJobSchema>;

/** One profile of one workspace, as the queue and its readers address it. */
export type ProfileDerivationKey = Pick<
  ProfileDerivationJob,
  "tenantId" | "workspaceId" | "profileId"
>;

/** One derivation at a time per profile: the key the queue deduplicates on. */
export function profileDerivationJobKey(key: ProfileDerivationKey): string {
  return `${key.tenantId}/${key.workspaceId}/${key.profileId}`;
}

/** Content-free progress of a derivation's provider calls, as the desktop shows it. */
export interface ProfileDerivationProgress {
  readonly completedCalls: number;
  readonly plannedCalls: number;
}

/**
 * What a derivation's provider calls used (#2815): content-free totals, failed calls included.
 * `estimatedUsd` is null when a call's model has no price, so the total cannot be estimated.
 */
export interface ProfileDerivationUsage {
  readonly calls: number;
  readonly failedCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedUsd: number | null;
}

/** Which selected sources a derivation reused from the previous version and which it extracted. */
export interface ProfileDerivationSources {
  readonly reusedSourceCount: number;
  readonly extractedSourceCount: number;
}

/**
 * How one claimed derivation ended, kept as the job's output. A failure's message is one of the
 * application's fixed, path-free sentences; any other failure carries none. A derivation that
 * called a model keeps what those calls used.
 */
export type ProfileDerivationOutcome =
  | ({
      readonly outcome: "derived";
      readonly version: number;
      readonly usage?: ProfileDerivationUsage;
    } & Partial<ProfileDerivationSources>)
  | { readonly outcome: "cancelled"; readonly usage?: ProfileDerivationUsage }
  | {
      readonly outcome: "failed";
      readonly message?: string;
      readonly usage?: ProfileDerivationUsage;
    }
  /** The record's current consent does not cover the workspace's providers. */
  | { readonly outcome: "consent-required" }
  /** The workspace's candidate record is erased or being erased. */
  | { readonly outcome: "record-erased" };

/** Where a profile's newest derivation stands, as the screen polls it. */
export type ProfileDerivationState =
  | ({
      readonly status: "pending";
      /** False while the job waits for a worker to claim it. */
      readonly started: boolean;
    } & Partial<ProfileDerivationProgress>)
  | ({
      readonly status: "derived";
      readonly version: number;
      readonly usage?: ProfileDerivationUsage;
    } & Partial<ProfileDerivationSources>)
  | { readonly status: "cancelled"; readonly usage?: ProfileDerivationUsage }
  | {
      readonly status: "failed";
      readonly reason: "failed" | "consent-required" | "record-erased";
      readonly message?: string;
      readonly usage?: ProfileDerivationUsage;
    };

const countSchema = z.number().int().nonnegative();

const usageSchema = z.object({
  calls: countSchema,
  failedCalls: countSchema,
  inputTokens: countSchema,
  outputTokens: countSchema,
  estimatedUsd: z.number().nonnegative().nullable(),
});

const outputSchema = z.union([
  z.object({
    outcome: z.literal("derived"),
    version: z.number().int().positive(),
    usage: usageSchema.optional(),
    reusedSourceCount: countSchema.optional(),
    extractedSourceCount: countSchema.optional(),
  }),
  z.object({ outcome: z.literal("cancelled"), usage: usageSchema.optional() }),
  z.object({
    outcome: z.literal("failed"),
    message: z.string().max(1_000).optional(),
    usage: usageSchema.optional(),
  }),
  z.object({ outcome: z.enum(["consent-required", "record-erased"]) }),
]);

function withUsage(usage: ProfileDerivationUsage | undefined) {
  return usage === undefined ? {} : { usage };
}

/** Reads a finished job's output; anything unexpected reads as a failure without a message. */
export function profileDerivationStateOf(output: unknown): ProfileDerivationState {
  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) return { status: "failed", reason: "failed" };
  const result = parsed.data;
  switch (result.outcome) {
    case "derived":
      return {
        status: "derived",
        version: result.version,
        ...withUsage(result.usage),
        ...(result.reusedSourceCount === undefined || result.extractedSourceCount === undefined
          ? {}
          : {
              reusedSourceCount: result.reusedSourceCount,
              extractedSourceCount: result.extractedSourceCount,
            }),
      };
    case "cancelled":
      return { status: "cancelled", ...withUsage(result.usage) };
    case "failed":
      return {
        status: "failed",
        reason: "failed",
        ...(result.message === undefined ? {} : { message: result.message }),
        ...withUsage(result.usage),
      };
    default:
      return { status: "failed", reason: result.outcome };
  }
}

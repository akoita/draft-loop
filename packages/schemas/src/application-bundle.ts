import { z } from "zod";
import {
  applicationIdSchema,
  applicationNameSchema,
  applicationPastedJobMaxLength,
} from "./application.js";

/** The format an application import carries between a desktop workspace and a server (D12). */
export const applicationBundleFormat = "draft-loop-application-bundle" as const;
export const applicationBundleFormatVersion = 1 as const;

/** The most runs and job briefs one bundle carries; a larger application is sent in parts. */
export const applicationBundleMaximumRuns = 200;
export const applicationBundleMaximumBriefs = 200;

const identifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u, "must be a safe identifier");

/** A stored row: its shape is checked by the storage port that writes it. */
const row = z.looseObject({});
const rowWithId = z.looseObject({ id: identifier });

const runBundleSchema = z
  .object({
    run: rowWithId,
    contextSnapshots: z.array(rowWithId).max(10_000),
    artifacts: z.array(rowWithId.extend({ version: z.number().int().positive() })).max(10_000),
    snapshots: z
      .array(z.object({ record: row, payload: z.unknown(), slim: z.boolean() }).strict())
      .max(10_000),
    rounds: z.array(row).max(10_000),
    executions: z.array(row).max(10_000),
    findings: z.array(row).max(10_000),
    decisions: z.array(row).max(10_000),
    state: row.optional(),
    events: z.array(row).max(100_000),
  })
  .strict();

const briefBundleSchema = z
  .object({
    briefId: identifier,
    versions: z
      .array(z.looseObject({ id: identifier }))
      .min(1)
      .max(1_000),
  })
  .strict();

/**
 * One application of a desktop workspace with its job, job briefs and runs. Rows keep their ids;
 * the server writes them under its own workspace id, so `sourceWorkspaceId` is only used to
 * retarget them and to name the import.
 */
export const applicationBundleSchema = z
  .object({
    format: z.literal(applicationBundleFormat),
    formatVersion: z.literal(applicationBundleFormatVersion),
    sourceWorkspaceId: identifier,
    /** The application's id in the source workspace; `default` for the workspace's own job. */
    sourceApplicationId: applicationIdSchema,
    name: applicationNameSchema,
    jobText: z.string().trim().min(1).max(applicationPastedJobMaxLength),
    briefs: z.array(briefBundleSchema).max(applicationBundleMaximumBriefs),
    runs: z.array(runBundleSchema).max(applicationBundleMaximumRuns),
  })
  .strict();

export type ApplicationBundleInput = z.infer<typeof applicationBundleSchema>;

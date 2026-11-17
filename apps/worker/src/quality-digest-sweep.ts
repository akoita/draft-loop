/**
 * The daily quality digest (#2916): once per UTC day, the first worker start reduces the previous
 * day's run spans across every active organisation to a content-free digest, stores it and logs it
 * as one `quality digest` line for the outer loop's diagnosis (#2914). A failure is logged, never
 * thrown, and never touches a run.
 */

import { buildQualityDigest, type QualityDigest } from "@draft-loop/application/quality-digest";
import { createPostgresQualityDigests, type QualityDigests } from "@draft-loop/storage-postgres";

import { errorFields, logLine } from "./logging.js";

const dayMs = 24 * 60 * 60 * 1000;

/** The most organisations one digest reads. */
export const maximumDigestOrganisations = 500;

export type QualityDigestPorts = Pick<
  QualityDigests,
  "claimDay" | "save" | "organisationsActiveSince" | "spansBetween"
> & {
  readonly log: (message: string, fields: Record<string, unknown>) => void;
};

/** Builds yesterday's digest unless another start already claimed it; resolves the digest built. */
export async function sweepQualityDigest(
  ports: QualityDigestPorts,
  options: { readonly now: Date },
): Promise<QualityDigest | undefined> {
  const to = new Date(Math.floor(options.now.getTime() / dayMs) * dayMs);
  const from = new Date(to.getTime() - dayMs);
  const day = from.toISOString().slice(0, 10);
  if (!(await ports.claimDay(day, options.now))) return undefined;

  const organisations = await ports.organisationsActiveSince(from, maximumDigestOrganisations);
  const spans = [];
  for (const organisationId of organisations) {
    spans.push(...(await ports.spansBetween(organisationId, from, to)));
  }
  const digest = buildQualityDigest({ day, organisations: organisations.length, spans });
  await ports.save(day, digest as unknown as Record<string, unknown>);
  ports.log("quality digest", { ...digest });
  return digest;
}

/** Opens the digests, sweeps and closes; a failure is logged, never thrown. */
export async function runQualityDigest(wiring: {
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly now?: () => Date;
}): Promise<QualityDigest | undefined> {
  const digests = createPostgresQualityDigests({
    connectionString: wiring.databaseUrl,
    schema: wiring.databaseSchema,
  });
  try {
    return await sweepQualityDigest(
      {
        claimDay: digests.claimDay,
        save: digests.save,
        organisationsActiveSince: digests.organisationsActiveSince,
        spansBetween: digests.spansBetween,
        log: (message, fields) => console.info(logLine("INFO", message, fields)),
      },
      { now: (wiring.now ?? (() => new Date()))() },
    );
  } catch (error) {
    console.error(logLine("ERROR", "quality digest failed", { err: errorFields(error) }));
    return undefined;
  } finally {
    await digests.close();
  }
}

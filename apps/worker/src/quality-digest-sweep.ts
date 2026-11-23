/**
 * The daily quality digest (#2916): once per UTC day, the first worker start reduces the previous
 * day's run spans across every active organisation to a content-free digest, stores it and logs it
 * as one `quality digest` line for the outer loop's diagnosis (#2914), then updates the insight
 * ledger (#2917) and logs its changes and open patterns as one `quality insights` line. A failure is logged, never
 * thrown, and never touches a run.
 */

import {
  buildQualityDigest,
  type CoverLetterUseCounts,
  type DigestLatency,
  type DigestOutcomeEvent,
  type DigestOutcomes,
  type DigestQuality,
  type DigestRunPair,
  digestCoverLetters,
  digestOutcomes,
  latencyTrend,
  type QualityDigest,
  qualityTrend,
} from "@draft-loop/application/quality-digest";
import { insightObservations, nextQualityInsights } from "@draft-loop/application/quality-insights";
import { createPostgresQualityDigests, type QualityDigests } from "@draft-loop/storage-postgres";

import { errorFields, logLine } from "./logging.js";

const dayMs = 24 * 60 * 60 * 1000;

/** The most organisations one digest reads. */
export const maximumDigestOrganisations = 500;

export type QualityDigestPorts = Pick<
  QualityDigests,
  | "claimDay"
  | "save"
  | "digestsBetween"
  | "organisationsActiveSince"
  | "spansBetween"
  | "outcomesBetween"
  | "feedbackNotesBetween"
  | "coverLetterUseBetween"
  | "coverLetterChecksBetween"
  | "listInsights"
  | "saveInsights"
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
  const events: DigestOutcomeEvent[] = [];
  const runPairs: DigestRunPair[] = [];
  const letterUse: CoverLetterUseCounts[] = [];
  for (const organisationId of organisations) {
    spans.push(...(await ports.spansBetween(organisationId, from, to)));
    // Member outcomes (#3245): run ids stay inside this sweep; the digest keeps counts.
    const outcomes = await ports.outcomesBetween(organisationId, from, to);
    events.push(...outcomes.events);
    runPairs.push(...outcomes.runPairs);
    // Cover letter help (#3282): counts only, never a letter.
    letterUse.push(await ports.coverLetterUseBetween(organisationId, from, to));
  }
  const digest = buildQualityDigest({
    day,
    organisations: organisations.length,
    spans,
    outcomes: digestOutcomes({
      events,
      runPairs,
      feedbackNotes: await ports.feedbackNotesBetween(from, to),
    }),
    coverLetters: digestCoverLetters({
      organisations: letterUse,
      checks: await ports.coverLetterChecksBetween(from, to),
    }),
  });
  await ports.save(day, digest as unknown as Record<string, unknown>);
  // This week against the week before, per model pair (#3240); older digests have no quality.
  const since = new Date(from.getTime() - 13 * dayMs).toISOString().slice(0, 10);
  const earlier = (await ports.digestsBetween(since, day)).filter((saved) => saved.day !== day);
  const trend = qualityTrend(day, [
    ...earlier.map((saved) => ({
      day: saved.day,
      ...(saved.digest.quality === undefined
        ? {}
        : { quality: saved.digest.quality as DigestQuality }),
      ...(saved.digest.outcomes === undefined
        ? {}
        : { outcomes: saved.digest.outcomes as DigestOutcomes }),
    })),
    { day, quality: digest.quality, outcomes: digest.outcomes },
  ]);
  const latency = latencyTrend(day, [
    ...earlier.map((saved) =>
      Array.isArray(saved.digest.latency)
        ? { day: saved.day, latency: saved.digest.latency as DigestLatency[] }
        : { day: saved.day },
    ),
    { day, latency: digest.latency },
  ]);
  ports.log("quality digest", { ...digest, trend, latencyTrend: latency });

  // The insight ledger (#2917): new, recurring, resolved and dismissed patterns.
  const { insights, changes } = nextQualityInsights({
    day,
    existing: await ports.listInsights(),
    observations: insightObservations(digest, trend, latency),
  });
  await ports.saveInsights(insights);
  const open = (await ports.listInsights()).filter(
    (insight) => insight.status === "new" || insight.status === "recurring",
  );
  ports.log("quality insights", { day, changes, open });
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
        digestsBetween: digests.digestsBetween,
        organisationsActiveSince: digests.organisationsActiveSince,
        spansBetween: digests.spansBetween,
        outcomesBetween: digests.outcomesBetween,
        feedbackNotesBetween: digests.feedbackNotesBetween,
        coverLetterUseBetween: digests.coverLetterUseBetween,
        coverLetterChecksBetween: digests.coverLetterChecksBetween,
        listInsights: digests.listInsights,
        saveInsights: digests.saveInsights,
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

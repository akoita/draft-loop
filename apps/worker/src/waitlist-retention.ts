/**
 * The beta waitlist's retention (#2568): an entry nobody invited is deleted six months after it
 * was made. Invited entries are already gone, deleted with the invite (#2566). It runs each time
 * the worker starts, needs no mail sender, and logs only the count.
 */

import { createPostgresTenantDirectory } from "@draft-loop/storage-postgres";

import { errorFields, logLine } from "./logging.js";

const dayMs = 24 * 60 * 60 * 1000;

/** About six months, as the consent text promises. */
export const waitlistKeepDays = 183;

export interface WaitlistRetentionPorts {
  readonly deleteJoinedBefore: (cutoff: Date) => Promise<number>;
  readonly log: (message: string, fields: Record<string, unknown>) => void;
}

/** Deletes the entries older than the keep period; resolves how many went. */
export async function sweepWaitlist(
  ports: WaitlistRetentionPorts,
  options: { readonly now: Date; readonly keepDays?: number },
): Promise<number> {
  const cutoff = new Date(options.now.getTime() - (options.keepDays ?? waitlistKeepDays) * dayMs);
  const deleted = await ports.deleteJoinedBefore(cutoff);
  if (deleted > 0) ports.log("old waitlist entries deleted", { deleted });
  return deleted;
}

/** Opens a one-connection directory, sweeps and closes; a failure is logged, never thrown. */
export async function runWaitlistRetention(wiring: {
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly now?: () => Date;
}): Promise<number | undefined> {
  let directory: Awaited<ReturnType<typeof createPostgresTenantDirectory>> | undefined;
  try {
    directory = await createPostgresTenantDirectory({
      connectionString: wiring.databaseUrl,
      schema: wiring.databaseSchema,
      maxConnections: 1,
    });
    return await sweepWaitlist(
      {
        deleteJoinedBefore: directory.betaWaitlist.deleteJoinedBefore,
        log: (message, fields) => console.info(logLine("INFO", message, fields)),
      },
      { now: (wiring.now ?? (() => new Date()))() },
    );
  } catch (error) {
    console.error(logLine("ERROR", "waitlist retention failed", { err: errorFields(error) }));
    return undefined;
  } finally {
    await directory?.close();
  }
}

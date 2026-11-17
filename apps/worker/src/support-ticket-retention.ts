/**
 * Support tickets' retention (#2883): a ticket and the conversation it shares are deleted 90 days
 * after the member sent it. It runs each time the worker starts and logs only the count.
 */

import { supportTicketKeepDays } from "@draft-loop/storage/feedback";
import { createPostgresTenantDirectory } from "@draft-loop/storage-postgres";

import { errorFields, logLine } from "./logging.js";

const dayMs = 24 * 60 * 60 * 1000;

export interface SupportTicketRetentionPorts {
  readonly deleteSupportTicketsBefore: (cutoff: Date) => Promise<number>;
  readonly log: (message: string, fields: Record<string, unknown>) => void;
}

/** Deletes the tickets older than the keep period; resolves how many went. */
export async function sweepSupportTickets(
  ports: SupportTicketRetentionPorts,
  options: { readonly now: Date; readonly keepDays?: number },
): Promise<number> {
  const keepDays = options.keepDays ?? supportTicketKeepDays;
  const deleted = await ports.deleteSupportTicketsBefore(
    new Date(options.now.getTime() - keepDays * dayMs),
  );
  if (deleted > 0) ports.log("old support tickets deleted", { deleted });
  return deleted;
}

/** Opens a one-connection directory, sweeps and closes; a failure is logged, never thrown. */
export async function runSupportTicketRetention(wiring: {
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
    return await sweepSupportTickets(
      {
        deleteSupportTicketsBefore: directory.feedback.deleteSupportTicketsBefore,
        log: (message, fields) => console.info(logLine("INFO", message, fields)),
      },
      { now: (wiring.now ?? (() => new Date()))() },
    );
  } catch (error) {
    console.error(logLine("ERROR", "support ticket retention failed", { err: errorFields(error) }));
    return undefined;
  } finally {
    await directory?.close();
  }
}

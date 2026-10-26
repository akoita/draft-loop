import { resolve } from "node:path";
import type { ApplicationJobPage } from "@draft-loop/schemas/application";

import { CliUserError } from "./cli-user-error.js";
import { readWorkspace } from "./local.js";
import { storageFactory } from "./local-storage-factory.js";

/** Keep the text an application's approved job page gave, for the worker's extraction. */
export interface RecordApplicationJobPageCommand {
  readonly root: string;
  readonly applicationId: string;
  readonly page: ApplicationJobPage;
}

/**
 * Keeps a fetched job page's text with its application (#1812), as pasted text is kept, so the
 * worker extracts the brief from that one fetch and never fetches the page again. Only a created
 * application whose job is an approved URL keeps one.
 */
export async function recordApplicationJobPage(
  command: RecordApplicationJobPageCommand,
): Promise<void> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const storage = await storageFactory().open(root);
  try {
    const application = await storage.applications.getApplication(config.id, command.applicationId);
    if (application?.jobSource.kind !== "approved-url") {
      throw new CliUserError("This application has no approved job page.");
    }
    await storage.applications.recordJobPage(
      config.id,
      command.applicationId,
      command.page,
      command.page.fetchedAt,
    );
  } finally {
    await storage.close();
  }
}

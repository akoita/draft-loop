import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import {
  applicationNameMaxLength,
  defaultApplicationId,
  normalizeApplicationName,
} from "@draft-loop/domain/application";
import { applicationPastedJobMaxLength } from "@draft-loop/schemas/application";
import { type ApplicationBundle, readApplicationBundle } from "./application-bundle-import.js";
import { jobHeading } from "./application-name.js";
import { CliUserError } from "./cli-user-error.js";
import { readWorkspace } from "./local.js";
import { localHistoryPath, openLocalHistoryReadOnly } from "./local-storage-factory.js";

/** One desktop workspace, read for a server import: one bundle per application to send. */
export interface DesktopWorkspaceBundles {
  readonly workspaceId: string;
  readonly bundles: readonly ApplicationBundle[];
  /** Applications left out because their job text could not be read, such as a moved file. */
  readonly skippedApplications: number;
}

async function readText(path: string): Promise<string | undefined> {
  const text = (await readFile(path, "utf8").catch(() => "")).trim();
  return text === "" || text.length > applicationPastedJobMaxLength ? undefined : text;
}

function name(...candidates: readonly (string | undefined)[]): string {
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try {
      return normalizeApplicationName(candidate.slice(0, applicationNameMaxLength));
    } catch {
      // Try the next candidate.
    }
  }
  return "Imported application";
}

/**
 * Reads a desktop workspace read only into application bundles (ADR 0011, D12): its own job, when
 * it has runs or job briefs, and each application created in it. The workspace's files and
 * history are never changed.
 */
export async function readDesktopWorkspaceBundles(
  rootInput: string,
): Promise<DesktopWorkspaceBundles> {
  const root = resolve(rootInput);
  let config: Awaited<ReturnType<typeof readWorkspace>>;
  try {
    config = await readWorkspace(root);
  } catch {
    throw new CliUserError(`${root} is not a DraftLoop workspace.`);
  }
  const historyPath = localHistoryPath(root);
  if (
    !(await stat(historyPath).then(
      (file) => file.isFile(),
      () => false,
    ))
  ) {
    return { workspaceId: config.id, bundles: [], skippedApplications: 0 };
  }
  const history = openLocalHistoryReadOnly(historyPath);
  try {
    const bundles: ApplicationBundle[] = [];
    let skippedApplications = 0;
    const resolveIn = (path: string) => (isAbsolute(path) ? path : resolve(root, path));

    const defaultRuns = await history.applications.listDefaultRunIds(config.id);
    const defaultBriefs = await history.applications.listDefaultBriefIds(config.id);
    if (defaultRuns.length > 0 || defaultBriefs.length > 0) {
      const jobText = await readText(resolveIn(config.jobDescriptionPath));
      if (jobText === undefined) skippedApplications += 1;
      else {
        bundles.push(
          await readApplicationBundle({
            source: history,
            sourceWorkspaceId: config.id,
            sourceApplicationId: defaultApplicationId,
            name: name(
              await history.applications.getDefaultApplicationName(config.id),
              jobHeading(jobText),
              basename(root),
            ),
            jobText,
          }),
        );
      }
    }
    for (const application of await history.applications.listApplications(config.id)) {
      const source = application.jobSource;
      const jobText =
        source.kind === "stored-text"
          ? source.text
          : source.kind === "pasted-text"
            ? await readText(resolveIn(source.storedPath))
            : source.kind === "local-file"
              ? await readText(resolveIn(source.path))
              : source.page?.text;
      if (jobText === undefined) {
        skippedApplications += 1;
        continue;
      }
      bundles.push(
        await readApplicationBundle({
          source: history,
          sourceWorkspaceId: config.id,
          sourceApplicationId: application.id,
          name: name(application.name),
          jobText,
        }),
      );
    }
    return { workspaceId: config.id, bundles, skippedApplications };
  } catch (error) {
    if (error instanceof CliUserError) throw error;
    throw new CliUserError(
      `The history of ${root} could not be read. Open it once in DraftLoop, then try again.`,
    );
  } finally {
    await history.close();
  }
}

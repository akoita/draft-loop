import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { defaultApplicationId } from "@draft-loop/domain/application";
import {
  type ApplicationBundleInput,
  applicationBundleFormat,
  applicationBundleFormatVersion,
  applicationBundleSchema,
} from "@draft-loop/schemas/application-bundle";
import {
  type ApplicationBundleHistory,
  type BriefBundle,
  type RunBundle,
  readRunBundle,
  retargetWorkspace,
  writeRunBundle,
} from "./application-bundle.js";
import { CliUserError } from "./cli-user-error.js";
import { readWorkspace } from "./local.js";
import { storageFactory } from "./local-storage-factory.js";
import { workspaceFiles } from "./workspace-files.js";

const importedEventType = "application.imported";

/** One application of a workspace, ready to send to a server (ADR 0011, D12). */
export interface ApplicationBundle {
  readonly format: typeof applicationBundleFormat;
  readonly formatVersion: typeof applicationBundleFormatVersion;
  readonly sourceWorkspaceId: string;
  readonly sourceApplicationId: string;
  readonly name: string;
  readonly jobText: string;
  readonly briefs: readonly BriefBundle[];
  readonly runs: readonly RunBundle[];
}

export interface ApplicationBundleCounts {
  readonly runs: number;
  readonly briefs: number;
  readonly briefVersions: number;
}

export interface ImportApplicationBundleResult {
  readonly applicationId: string;
  readonly name: string;
  /** `already-imported` when an earlier import of the same application finished. */
  readonly status: "imported" | "already-imported";
  readonly counts: ApplicationBundleCounts;
}

export interface ImportApplicationBundleCommand {
  readonly root: string;
  readonly bundle: unknown;
}

/**
 * The id an imported application always gets, derived from where it came from, so an interrupted
 * import resumes into the same application. A workspace's default application keeps the id the
 * local workspace import gives it.
 */
export function bundledApplicationId(
  sourceWorkspaceId: string,
  sourceApplicationId: string,
): string {
  const key =
    sourceApplicationId === defaultApplicationId
      ? sourceWorkspaceId
      : `${sourceWorkspaceId}:${sourceApplicationId}`;
  return `imported-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

/** Reads one application of `source` into a bundle: its job briefs with every version, and its runs. */
export async function readApplicationBundle(input: {
  readonly source: ApplicationBundleHistory;
  readonly sourceWorkspaceId: string;
  readonly sourceApplicationId: string;
  readonly name: string;
  readonly jobText: string;
}): Promise<ApplicationBundle> {
  const { source, sourceWorkspaceId: workspaceId, sourceApplicationId: applicationId } = input;
  const isDefault = applicationId === defaultApplicationId;
  const runIds = isDefault
    ? await source.applications.listDefaultRunIds(workspaceId)
    : (await source.applications.listRuns(workspaceId, applicationId)).map(({ id }) => id);
  const briefIds = isDefault
    ? await source.applications.listDefaultBriefIds(workspaceId)
    : (await source.applications.listBriefs(workspaceId, applicationId)).map(
        ({ briefId }) => briefId,
      );
  const briefs: BriefBundle[] = [];
  for (const briefId of briefIds) {
    const versions = await source.listOpportunityBriefVersions(workspaceId, briefId);
    if (versions.length > 0) briefs.push({ briefId, versions: versions.map(({ brief }) => brief) });
  }
  const runs: RunBundle[] = [];
  for (const runId of runIds) {
    const bundle = await readRunBundle(source, runId);
    if (bundle !== undefined) runs.push(bundle);
  }
  return {
    format: applicationBundleFormat,
    formatVersion: applicationBundleFormatVersion,
    sourceWorkspaceId: workspaceId,
    sourceApplicationId: applicationId,
    name: input.name,
    jobText: input.jobText,
    briefs,
    runs,
  };
}

function parseBundle(bundle: unknown): ApplicationBundleInput {
  const parsed = applicationBundleSchema.safeParse(bundle);
  if (!parsed.success) throw new CliUserError("The application bundle is not valid.");
  return parsed.data;
}

async function assertNoCollisions(
  target: ApplicationBundleHistory,
  targetId: string,
  applicationId: string,
  bundle: ApplicationBundleInput,
): Promise<void> {
  for (const { run } of bundle.runs) {
    if (
      (await target.getRun(run.id)) !== undefined &&
      (await target.applications.applicationIdForRun(targetId, run.id)) !== applicationId
    ) {
      throw new CliUserError(
        "This workspace already holds a run with the same id as one being imported, so nothing was imported.",
      );
    }
  }
  for (const { briefId } of bundle.briefs) {
    if (
      (await target.listOpportunityBriefVersions(targetId, briefId)).length > 0 &&
      (await target.applications.applicationIdForBrief(targetId, briefId)) !== applicationId
    ) {
      throw new CliUserError(
        "This workspace already holds a job brief with the same id as one being imported, so nothing was imported.",
      );
    }
  }
}

async function insertImportedApplication(
  target: ApplicationBundleHistory,
  root: string,
  input: { readonly workspaceId: string; readonly id: string; readonly name: string },
  jobText: string,
  createdAt: string,
): Promise<void> {
  let jobSource:
    | { kind: "stored-text"; text: string }
    | { kind: "pasted-text"; storedPath: string };
  if (workspaceFiles().keepsFiles) {
    const storedPath = join(".draft-loop", "applications", input.id, "job.md");
    await mkdir(dirname(join(root, storedPath)), { recursive: true });
    await writeFile(join(root, storedPath), `${jobText}\n`, "utf8");
    jobSource = { kind: "pasted-text", storedPath };
  } else {
    jobSource = { kind: "stored-text", text: jobText };
  }
  await target.applications.insertApplication({ ...input, jobSource, createdAt });
}

/**
 * Writes an application bundle into the workspace at `root`, through whatever history the driver's
 * storage factory opens, such as the hosted service's Postgres (ADR 0011, D12).
 *
 * - Rows keep their ids and are written under this workspace's id. A run or brief id that this
 *   workspace already holds outside the imported application refuses the whole import.
 * - The application id is derived from the bundle's source, and a finished import is recorded as an
 *   audit event. Sending the same bundle again answers `already-imported`; sending it after an
 *   interruption resumes it.
 * - Export files are not carried: the server makes them again from the imported artifacts.
 */
export async function importApplicationBundle(
  command: ImportApplicationBundleCommand,
  dependencies: { readonly now?: () => string } = {},
): Promise<ImportApplicationBundleResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const bundle = parseBundle(command.bundle);
  const root = resolve(command.root);
  const workspace = await readWorkspace(root);
  const applicationId = bundledApplicationId(bundle.sourceWorkspaceId, bundle.sourceApplicationId);
  const counts: ApplicationBundleCounts = {
    runs: bundle.runs.length,
    briefs: bundle.briefs.length,
    briefVersions: bundle.briefs.reduce((total, brief) => total + brief.versions.length, 0),
  };
  const target = await storageFactory().open(root);
  try {
    const finished = (await target.listAuditEvents(workspace.id)).some(
      (event) => event.eventType === importedEventType && event.entityId === applicationId,
    );
    const existing = await target.applications.getApplication(workspace.id, applicationId);
    if (finished && existing !== undefined) {
      return { applicationId, name: existing.name, status: "already-imported", counts };
    }
    await assertNoCollisions(target, workspace.id, applicationId, bundle);
    const move = <Value>(value: Value): Value =>
      retargetWorkspace(value, bundle.sourceWorkspaceId, workspace.id);
    try {
      if ((await target.getWorkspace(workspace.id)) === undefined) {
        const at = now();
        await target.saveWorkspace({
          id: workspace.id,
          state: "collecting",
          createdAt: at,
          updatedAt: at,
        });
      }
      if (existing === undefined) {
        await insertImportedApplication(
          target,
          root,
          { workspaceId: workspace.id, id: applicationId, name: bundle.name },
          bundle.jobText,
          now(),
        );
      }
      for (const brief of bundle.briefs) {
        await target.applications.bindBrief({
          workspaceId: workspace.id,
          applicationId,
          briefId: brief.briefId,
          createdAt: now(),
        });
        const present = (await target.listOpportunityBriefVersions(workspace.id, brief.briefId))
          .length;
        for (const version of brief.versions.slice(present)) {
          await target.saveOpportunityBrief(workspace.id, move(version) as never);
        }
      }
      for (const run of bundle.runs) {
        await writeRunBundle(
          {
            target,
            sourceId: bundle.sourceWorkspaceId,
            targetId: workspace.id,
            applicationId,
            now,
          },
          run as unknown as RunBundle,
        );
      }
      await target.appendAuditEvent({
        id: `application-import:${workspace.id}:${applicationId}`,
        workspaceId: workspace.id,
        eventType: importedEventType,
        entityType: "application",
        entityId: applicationId,
        payload: {
          sourceWorkspaceId: bundle.sourceWorkspaceId,
          sourceApplicationId: bundle.sourceApplicationId,
          applicationId,
          ...counts,
        },
        createdAt: now(),
      });
    } catch (error) {
      if (error instanceof CliUserError) throw error;
      throw new CliUserError(
        "Importing stopped before it finished. Send the import again to resume it.",
      );
    }
    return { applicationId, name: existing?.name ?? bundle.name, status: "imported", counts };
  } finally {
    await target.close();
  }
}

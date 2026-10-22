import { CliUserError } from "./cli-user-error.js";
import type { ApplicationDriver } from "./index.js";
import { type KnowledgeStoreOpener, withKnowledgeStoreOpener } from "./knowledge-store-opener.js";
import { createLocalApplicationDriver, type LocalApplicationDriverOptions } from "./local.js";
import { type StorageFactory, withStorageFactory } from "./local-storage-factory.js";
import { readRunReview } from "./run-review.js";
import { noWorkspaceFiles, withWorkspaceFiles } from "./workspace-files.js";
import { type WorkspaceSettingsPort, withWorkspaceSettings } from "./workspace-settings.js";

export interface HostedApplicationDriverOptions {
  /** Where workspace settings live, such as Postgres. */
  readonly settings: WorkspaceSettingsPort;
  /**
   * Opens a workspace's history by its reference. The composition root owns the connection, so
   * the history it returns closes nothing that other calls still use.
   */
  readonly storage: StorageFactory;
  /** Opens the candidate knowledge stores a workspace's selection names. */
  readonly openKnowledgeStore: KnowledgeStoreOpener;
  /** Provider wiring, as the local driver takes it. */
  readonly local?: LocalApplicationDriverOptions;
}

/** The driver methods the hosted service offers so far; the rest refuse until an issue needs them. */
export const hostedDriverMethods = [
  "initialize",
  "readWorkspace",
  "configureKnowledgeSelection",
  "createOpportunity",
  "getOpportunity",
  "listOpportunityVersions",
  "editOpportunity",
  "reviewOpportunity",
  "createApplication",
  "listApplications",
  "getApplication",
  "begin",
  "start",
  "resume",
  "status",
  "readIndependentReview",
] as const satisfies readonly (keyof ApplicationDriver)[];

const offered: ReadonlySet<string> = new Set(hostedDriverMethods);

/**
 * The shared application driver over injected ports (ADR 0011, D15). A workspace is addressed by
 * an opaque reference that the API resolves; it is never a folder, so it must be an absolute
 * POSIX path such as `/tenants/<tenant>/workspaces/<id>`, which path resolution leaves unchanged.
 * Each call runs with the hosted settings, history, knowledge stores and no local files, so the
 * local driver's code serves it without touching the filesystem. This module never imports a
 * Postgres or Cloud Storage package; the apps wire those in.
 */
export function createHostedApplicationDriver(
  options: HostedApplicationDriverOptions,
): ApplicationDriver {
  const local = createLocalApplicationDriver(options.local);
  const inHostedContext = <Result>(action: () => Promise<Result>): Promise<Result> =>
    withWorkspaceSettings(options.settings, () =>
      withStorageFactory(options.storage, () =>
        withKnowledgeStoreOpener(options.openKnowledgeStore, () =>
          withWorkspaceFiles(noWorkspaceFiles, action),
        ),
      ),
    );
  const methods = Object.entries(local).map(([name, method]) => {
    if (typeof method !== "function") return [name, method];
    if (!offered.has(name)) {
      return [
        name,
        async () => {
          throw new CliUserError(`${name} is not available in the hosted service yet.`);
        },
      ];
    }
    return [
      name,
      (...parameters: readonly unknown[]) =>
        inHostedContext(() => Promise.resolve(method.apply(local, parameters))),
    ];
  });
  const driver = Object.fromEntries(methods) as ApplicationDriver;
  return Object.freeze({
    ...driver,
    // Hosted-only reads, composed from the shared modules rather than the local driver.
    readRunReview: (command) => inHostedContext(() => readRunReview(command)),
  } satisfies ApplicationDriver);
}

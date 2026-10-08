import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  applicationNameMaxLength,
  defaultApplicationId,
  deriveApplicationStatus,
  normalizeApplicationName,
} from "@draft-loop/domain/application";
import {
  type Application,
  type ApplicationJobSource,
  applicationIdSchema,
  applicationSchema,
} from "@draft-loop/schemas/application";
import { openSqliteStorage, type SqliteStorage } from "@draft-loop/storage";
import type {
  ApplicationBriefSummary,
  ApplicationExportSummary,
  ApplicationRunSummary,
  ApplicationStoragePort,
} from "@draft-loop/storage/application-store";
import {
  type CandidateProfileFreshnessSelection,
  withCandidateProfileFreshness,
} from "./candidate-profile-freshness.js";
import { CliUserError } from "./cli-user-error.js";
import type { ApplicationDriver, CreateOpportunityCommand } from "./index.js";

const historyDirectory = ".draft-loop";
const historyFilename = "history.sqlite";
const maximumPastedJobCharacters = 200_000;
const epoch = "1970-01-01T00:00:00.000Z";

/** An application with what it holds: its latest brief versions, runs and exports. */
export interface ApplicationView extends Application {
  readonly briefs: readonly ApplicationBriefSummary[];
  readonly runs: readonly ApplicationRunSummary[];
  readonly exports: readonly ApplicationExportSummary[];
}

export type ApplicationJobSourceInput =
  | { readonly kind: "pasted-text"; readonly text: string }
  | { readonly kind: "approved-url"; readonly url: string; readonly approved: boolean }
  | { readonly kind: "local-file"; readonly path: string };

export interface CreateApplicationCommand {
  readonly root: string;
  readonly name: string;
  readonly jobSource: ApplicationJobSourceInput;
  readonly id?: string;
  readonly createdAt?: string;
}

export interface ListApplicationsCommand {
  readonly root: string;
}

export interface GetApplicationCommand {
  readonly root: string;
  readonly applicationId: string;
}

export interface WorkspaceApplicationService {
  readonly create: (command: CreateApplicationCommand) => Promise<ApplicationView>;
  /** The default application first, then created applications, oldest first. */
  readonly list: (command: ListApplicationsCommand) => Promise<readonly ApplicationView[]>;
  readonly get: (command: GetApplicationCommand) => Promise<ApplicationView | undefined>;
}

export interface WorkspaceApplicationDependencies {
  readonly readWorkspace: (root: string) => Promise<{
    readonly id: string;
    readonly jobDescriptionPath: string;
    /** Lets the home services compare the profile with the career evidence. */
    readonly candidateKnowledgeSelection?: CandidateProfileFreshnessSelection;
  }>;
  readonly now?: () => string;
}

interface WorkspaceIdentity {
  readonly id: string;
  readonly jobDescriptionPath: string;
}

function historyPath(root: string): string {
  return join(root, historyDirectory, historyFilename);
}

async function historyExists(root: string): Promise<boolean> {
  try {
    return (await stat(historyPath(root))).isFile();
  } catch {
    return false;
  }
}

async function openHistory(root: string): Promise<SqliteStorage> {
  await mkdir(join(root, historyDirectory), { recursive: true });
  return openSqliteStorage(historyPath(root));
}

function latestTimestamp(values: readonly string[]): string {
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

async function readJobText(path: string, label: string): Promise<string> {
  let details: Awaited<ReturnType<typeof stat>>;
  try {
    details = await stat(path);
  } catch {
    throw new CliUserError(`${label} does not exist: ${path}`);
  }
  if (!details.isFile()) throw new CliUserError(`${label} is not a file: ${path}`);
  const text = (await readFile(path, "utf8")).trim();
  if (text === "") throw new CliUserError(`${label} is empty: ${path}`);
  return text;
}

/**
 * A display name for the legacy application: its first Markdown heading. A pasted web page often
 * starts with navigation text, so without a heading the name stays generic.
 */
function defaultApplicationName(jobText: string | undefined): string {
  const heading = jobText?.split(/\r?\n/u).find((line) => /^ {0,3}#{1,6}\s+\S/u.test(line)) ?? "";
  const name = heading
    .replace(/^[\s#]+/u, "")
    .trim()
    .slice(0, applicationNameMaxLength)
    .trim();
  return name === "" ? "Default application" : name;
}

async function describeApplication(
  applications: ApplicationStoragePort,
  workspaceId: string,
  base: Omit<Application, "status" | "updatedAt"> & { readonly updatedAt: string },
): Promise<ApplicationView> {
  const [briefs, runs, exports] = await Promise.all([
    applications.listBriefs(workspaceId, base.id),
    applications.listRuns(workspaceId, base.id),
    applications.listExports(workspaceId, base.id),
  ]);
  const status = deriveApplicationStatus(
    runs,
    exports.some((item) => item.status === "completed"),
  );
  const updatedAt = latestTimestamp([
    base.updatedAt,
    ...runs.map((run) => run.updatedAt),
    ...briefs.map((brief) => brief.createdAt),
    ...exports.map((item) => item.createdAt),
  ]);
  return { ...applicationSchema.parse({ ...base, updatedAt, status }), briefs, runs, exports };
}

/**
 * Reads a workspace as one default application built from its configured job description. Nothing
 * is written: the runs, briefs and exports it holds are the ones with no application binding.
 */
async function describeDefaultApplication(
  root: string,
  workspace: WorkspaceIdentity,
  storage: SqliteStorage | undefined,
): Promise<ApplicationView> {
  const jobPath = isAbsolute(workspace.jobDescriptionPath)
    ? workspace.jobDescriptionPath
    : resolve(root, workspace.jobDescriptionPath);
  const jobText = await readFile(jobPath, "utf8").catch(() => undefined);
  const jobTime = await stat(jobPath)
    .then((details) => details.birthtime.toISOString())
    .catch(() => undefined);
  const createdAt =
    (storage === undefined ? undefined : (await storage.getWorkspace(workspace.id))?.createdAt) ??
    jobTime ??
    epoch;
  const base = {
    schemaVersion: 1 as const,
    id: defaultApplicationId,
    name: defaultApplicationName(jobText),
    jobSource: { kind: "local-file", path: workspace.jobDescriptionPath } as const,
    createdAt,
    updatedAt: createdAt,
    isDefault: true,
  };
  if (storage === undefined) {
    return {
      ...applicationSchema.parse({ ...base, status: "drafting" }),
      briefs: [],
      runs: [],
      exports: [],
    };
  }
  return describeApplication(storage.applications, workspace.id, base);
}

async function describeStoredApplication(
  storage: SqliteStorage,
  workspaceId: string,
  applicationId: string,
): Promise<ApplicationView | undefined> {
  const record = await storage.applications.getApplication(workspaceId, applicationId);
  if (record === undefined) return undefined;
  return describeApplication(storage.applications, workspaceId, {
    schemaVersion: 1,
    id: record.id,
    name: record.name,
    jobSource: record.jobSource,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isDefault: false,
  });
}

async function persistJobSource(
  root: string,
  id: string,
  input: ApplicationJobSourceInput,
): Promise<{ readonly jobSource: ApplicationJobSource; readonly storedFile?: string }> {
  if (input.kind === "approved-url") {
    if (input.approved !== true) {
      throw new CliUserError("A job URL needs explicit approval before it is used.");
    }
    try {
      const url = new URL(input.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme");
    } catch {
      throw new CliUserError("The job URL must be an http or https address.");
    }
    return { jobSource: { kind: "approved-url", url: input.url, approved: true } };
  }
  if (input.kind === "local-file") {
    const path = isAbsolute(input.path) ? input.path : resolve(root, input.path);
    await readJobText(path, "Job description");
    return { jobSource: { kind: "local-file", path } };
  }
  const text = input.text.trim();
  if (text === "") throw new CliUserError("The pasted job description is empty.");
  if (text.length > maximumPastedJobCharacters) {
    throw new CliUserError("The pasted job description is too long.");
  }
  const storedPath = join(historyDirectory, "applications", id, "job.md");
  const absolute = join(root, storedPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${text}\n`, { encoding: "utf8", flag: "wx" });
  return { jobSource: { kind: "pasted-text", storedPath }, storedFile: absolute };
}

/** Application records for a workspace; the workspace itself stays the candidate's home. */
export function createWorkspaceApplicationService(
  dependencies: WorkspaceApplicationDependencies,
): WorkspaceApplicationService {
  const clock = dependencies.now ?? (() => new Date().toISOString());
  const list: WorkspaceApplicationService["list"] = async ({ root: rootInput }) => {
    const root = resolve(rootInput);
    const workspace = await dependencies.readWorkspace(root);
    if (!(await historyExists(root))) {
      return [await describeDefaultApplication(root, workspace, undefined)];
    }
    const storage = await openHistory(root);
    try {
      const stored = await storage.applications.listApplications(workspace.id);
      const views = [await describeDefaultApplication(root, workspace, storage)];
      for (const record of stored) {
        const view = await describeStoredApplication(storage, workspace.id, record.id);
        if (view !== undefined) views.push(view);
      }
      return views;
    } finally {
      await storage.close();
    }
  };
  return {
    list,
    get: async ({ root: rootInput, applicationId }) => {
      const root = resolve(rootInput);
      if (applicationId === defaultApplicationId) {
        return (await list({ root }))[0];
      }
      const workspace = await dependencies.readWorkspace(root);
      if (!(await historyExists(root))) return undefined;
      const storage = await openHistory(root);
      try {
        return await describeStoredApplication(storage, workspace.id, applicationId);
      } finally {
        await storage.close();
      }
    },
    create: async (command) => {
      const root = resolve(command.root);
      const workspace = await dependencies.readWorkspace(root);
      let name: string;
      try {
        name = normalizeApplicationName(command.name);
      } catch {
        throw new CliUserError(
          `The application name must be between 1 and ${applicationNameMaxLength} characters.`,
        );
      }
      const id = command.id ?? `app-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      if (id === defaultApplicationId || !applicationIdSchema.safeParse(id).success) {
        throw new CliUserError("The application id is reserved or not a safe identifier.");
      }
      const createdAt = command.createdAt ?? clock();
      const storage = await openHistory(root);
      let storedFile: string | undefined;
      try {
        if ((await storage.applications.getApplication(workspace.id, id)) !== undefined) {
          throw new CliUserError(`Application ${id} already exists.`);
        }
        const persisted = await persistJobSource(root, id, command.jobSource);
        storedFile = persisted.storedFile;
        if ((await storage.getWorkspace(workspace.id)) === undefined) {
          await storage.saveWorkspace({
            id: workspace.id,
            state: "collecting",
            createdAt,
            updatedAt: createdAt,
          });
        }
        await storage.applications.insertApplication({
          workspaceId: workspace.id,
          id,
          name,
          jobSource: persisted.jobSource,
          createdAt,
        });
        storedFile = undefined;
        const view = await describeStoredApplication(storage, workspace.id, id);
        if (view === undefined) throw new CliUserError("The application could not be read back.");
        return view;
      } catch (error) {
        if (storedFile !== undefined)
          await rm(dirname(storedFile), { recursive: true, force: true });
        throw error;
      } finally {
        await storage.close();
      }
    },
  };
}

/** How one run relates to its application: which job text it reads and where it is bound. */
export interface RunApplication {
  /** Absent for the default application, which is never bound. */
  readonly applicationId?: string;
  /** The workspace configuration with this application's job description substituted. */
  readonly withJob: <Config extends { readonly jobDescriptionPath: string }>(
    config: Config,
  ) => Config;
  readonly bind: (
    storage: { readonly applications: ApplicationStoragePort },
    workspaceId: string,
    runId: string,
  ) => Promise<void>;
}

const defaultRunApplication: RunApplication = {
  withJob: (config) => config,
  bind: async () => undefined,
};

/**
 * Chooses the application a new run belongs to. No `applicationId` means the default application,
 * so existing callers behave exactly as before. A brief bound to another application is refused.
 */
export async function resolveRunApplication(
  root: string,
  workspace: WorkspaceIdentity,
  options: {
    readonly applicationId?: string | undefined;
    readonly opportunityBrief?: { readonly briefId: string } | undefined;
  },
): Promise<RunApplication> {
  const requested = options.applicationId ?? defaultApplicationId;
  if (requested === defaultApplicationId && options.opportunityBrief === undefined) {
    return defaultRunApplication;
  }
  const storage = await openHistory(root);
  try {
    if (options.opportunityBrief !== undefined) {
      const owner = await storage.applications.applicationIdForBrief(
        workspace.id,
        options.opportunityBrief.briefId,
      );
      if (owner !== requested) {
        throw new CliUserError(
          "The selected opportunity brief belongs to a different application.",
        );
      }
    }
    if (requested === defaultApplicationId) return defaultRunApplication;
    const record = await storage.applications.getApplication(workspace.id, requested);
    if (record === undefined) throw new CliUserError(`Application ${requested} was not found.`);
    const source = record.jobSource;
    if (source.kind === "approved-url" && options.opportunityBrief === undefined) {
      throw new CliUserError(
        "This application's job comes from a URL. Create and review an opportunity brief, then start with it.",
      );
    }
    const jobDescriptionPath =
      source.kind === "pasted-text"
        ? source.storedPath
        : source.kind === "local-file"
          ? source.path
          : undefined;
    return {
      applicationId: requested,
      withJob: (config) =>
        jobDescriptionPath === undefined ? config : { ...config, jobDescriptionPath },
      bind: async (target, workspaceId, runId) =>
        target.applications.bindRun({
          workspaceId,
          applicationId: requested,
          runId,
          createdAt: new Date().toISOString(),
        }),
    };
  } finally {
    storage.close();
  }
}

/**
 * Adds the application methods and the profile freshness read to a driver, and binds a created
 * opportunity brief to its application. Other driver methods pass through unchanged.
 */
export function withWorkspaceApplications(
  driver: ApplicationDriver,
  dependencies: WorkspaceApplicationDependencies,
): ApplicationDriver {
  const service = createWorkspaceApplicationService(dependencies);
  const withApplications: ApplicationDriver = {
    ...driver,
    createApplication: async (command) => service.create(command),
    listApplications: async (command) => service.list(command),
    getApplication: async (command) => service.get(command),
    createOpportunity: async (command: CreateOpportunityCommand) => {
      const { applicationId } = command;
      if (applicationId === undefined || applicationId === defaultApplicationId) {
        return driver.createOpportunity(command);
      }
      if ((await service.get({ root: command.root, applicationId })) === undefined) {
        throw new CliUserError(`Application ${applicationId} was not found.`);
      }
      const record = await driver.createOpportunity(command);
      const workspace = await dependencies.readWorkspace(resolve(command.root));
      const storage = await openHistory(resolve(command.root));
      try {
        await storage.applications.bindBrief({
          workspaceId: workspace.id,
          applicationId,
          briefId: record.brief.id,
          createdAt: new Date().toISOString(),
        });
      } finally {
        await storage.close();
      }
      return record;
    },
  };
  return withCandidateProfileFreshness(withApplications, dependencies);
}

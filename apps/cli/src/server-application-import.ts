import { type ServerConnection, serverRequest } from "./server-client.js";
import { CliUserError, type DesktopWorkspaceBundles } from "./workflow.js";

/** The workspace the owner token works in on a self-hosted server. */
export const ownerServerWorkspace = "owner";

/** What sending desktop applications did or would do, as content-free counts. */
export interface ApplicationImportCounts {
  readonly workspaces: number;
  readonly applications: number;
  readonly runs: number;
  readonly briefs: number;
  /** Applications an earlier import already finished, so nothing was written for them again. */
  readonly alreadyOnServer: number;
  /** Applications left out because their job text could not be read. */
  readonly skipped: number;
}

export function plannedApplicationCounts(
  workspaces: readonly DesktopWorkspaceBundles[],
): ApplicationImportCounts {
  const bundles = workspaces.flatMap((workspace) => workspace.bundles);
  return {
    workspaces: workspaces.length,
    applications: bundles.length,
    runs: bundles.reduce((total, bundle) => total + bundle.runs.length, 0),
    briefs: bundles.reduce((total, bundle) => total + bundle.briefs.length, 0),
    alreadyOnServer: 0,
    skipped: workspaces.reduce((total, workspace) => total + workspace.skippedApplications, 0),
  };
}

/**
 * Sends each desktop application to the server's application import route (ADR 0011, D12), one
 * request per application, so an interrupted import resumes at the application it stopped in.
 */
export async function importApplicationsToServer(
  workspaces: readonly DesktopWorkspaceBundles[],
  connection: ServerConnection,
  serverWorkspace: string,
): Promise<ApplicationImportCounts> {
  const workspacePath = `/v1/workspaces/${encodeURIComponent(serverWorkspace)}`;
  try {
    await serverRequest(connection, workspacePath, { method: "GET" });
  } catch (error) {
    if (error instanceof CliUserError && /answered 404/u.test(error.message)) {
      throw new CliUserError(
        `The server has no workspace ${serverWorkspace} yet. Open the server's web screen once and finish its setup, then import again.`,
      );
    }
    throw error;
  }
  let alreadyOnServer = 0;
  for (const bundle of workspaces.flatMap((workspace) => workspace.bundles)) {
    let answer: { readonly body: { readonly status?: string } };
    try {
      answer = await serverRequest<{ status?: string }>(
        connection,
        `${workspacePath}/application-imports`,
        { method: "POST", json: bundle },
      );
    } catch (error) {
      if (error instanceof CliUserError && /answered 404/u.test(error.message)) {
        throw new CliUserError(
          "This server does not take application imports. Only a self-hosted server signed in with its owner token does.",
        );
      }
      throw error;
    }
    if (answer.body.status === "already-imported") alreadyOnServer += 1;
  }
  return { ...plannedApplicationCounts(workspaces), alreadyOnServer };
}

export function applicationCountLines(counts: ApplicationImportCounts, sent: boolean): string[] {
  const lines = [
    `${counts.applications} application${counts.applications === 1 ? "" : "s"} with ${counts.runs} run${counts.runs === 1 ? "" : "s"} and ${counts.briefs} job brief${counts.briefs === 1 ? "" : "s"} from ${counts.workspaces} workspace${counts.workspaces === 1 ? "" : "s"} ${sent ? "imported" : "to import"}.`,
  ];
  if (sent && counts.alreadyOnServer > 0) {
    lines.push(`${counts.alreadyOnServer} had been imported before and were not written again.`);
  }
  if (counts.skipped > 0) {
    lines.push(
      `${counts.skipped} applications are left out because their job description could not be read.`,
    );
  }
  return lines;
}

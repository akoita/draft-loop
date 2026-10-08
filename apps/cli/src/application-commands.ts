import { resolve } from "node:path";
import type { Command } from "commander";
import {
  type ApplicationIo,
  type ApplicationService,
  type ApplicationView,
  CliUserError,
  workspaceRoot,
} from "./workflow.js";

interface CreateOptions {
  readonly name: string;
  readonly jobFile?: string;
  readonly jobText?: string;
  readonly json?: boolean;
}

function writeApplication(io: ApplicationIo, application: ApplicationView): void {
  io.write(
    `${application.id}  ${application.name}  [${application.status}]  runs=${application.runs.length} briefs=${application.briefs.length} exports=${application.exports.length}`,
  );
}

function requireApplicationApi<Method>(method: Method | undefined): Method {
  if (method === undefined) {
    throw new CliUserError("This application service does not support applications.");
  }
  return method;
}

/**
 * Registers `application list` and `application create`. An application is one job inside the
 * workspace; the workspace's own `job.md` is always listed as the default application.
 */
export function registerApplicationCommands(
  root: Command,
  service: ApplicationService,
  io: ApplicationIo,
): void {
  const application = root
    .command("application")
    .description("List and create the job applications inside a workspace");

  application
    .command("list")
    .description("List the workspace's applications; the default application is built from job.md")
    .argument("[workspace]", "workspace directory", ".")
    .option("--json", "print machine-readable JSON")
    .action(async (workspace: string, options: { json?: boolean }) => {
      const applications = await requireApplicationApi(service.listApplications)({
        root: workspaceRoot(workspace),
      });
      if (options.json === true) {
        io.write(JSON.stringify(applications));
        return;
      }
      io.write(`applications: ${applications.length}`);
      for (const item of applications) writeApplication(io, item);
    });

  application
    .command("create")
    .description("Create an application from a job description file or pasted text")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption(
      "--name <name>",
      "display name, such as the company and role (1-120 characters)",
    )
    .option("--job-file <path>", "local job description file; referenced, not copied")
    .option("--job-text <text>", "job description text; stored in the workspace")
    .option("--json", "print machine-readable JSON")
    .action(async (workspace: string, options: CreateOptions) => {
      if ((options.jobFile === undefined) === (options.jobText === undefined)) {
        throw new CliUserError("Provide exactly one of --job-file or --job-text.");
      }
      const jobSource =
        options.jobFile === undefined
          ? { kind: "pasted-text" as const, text: options.jobText ?? "" }
          : { kind: "local-file" as const, path: resolve(options.jobFile) };
      const created = await requireApplicationApi(service.createApplication)({
        root: workspaceRoot(workspace),
        name: options.name,
        jobSource,
      });
      if (options.json === true) {
        io.write(JSON.stringify(created));
        return;
      }
      io.write("application created:");
      writeApplication(io, created);
      io.write(`Start a run with: draft-loop start ${workspace} --application ${created.id}`);
    });
}

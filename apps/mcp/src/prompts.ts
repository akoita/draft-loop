import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * The agent channel's task prompts (#2535): what a host shows as commands, such as
 * Claude Code's `/` menu, for the application tools. The plugin's skills of the same tasks say
 * the same; a tool alone never appears in that menu.
 */

export function applicationsPrompt(filter: string | undefined): string {
  const scope =
    filter === undefined || filter.trim() === ""
      ? "all of them that are not archived"
      : `only those matching "${filter.trim()}" (a folder, a status, a name, or archived)`;
  return `List the candidate's DraftLoop job applications: call list_applications, with include_archived only when archived ones are asked for, and show ${scope}. Give each one's name, status and its latest run's state in a short table, newest first. Do not call any other tool unless the candidate asks about one application; then follow the application-status steps.`;
}

export function applicationStatusPrompt(application: string): string {
  return `Tell the candidate where their DraftLoop application "${application.trim()}" stands. Call list_applications and find it by name or id; if several match, ask which one. Call get_application, then get_run_status with its latest run's id when it has one. Say its status, the run's state and round, how many findings wait, and next_step in your own words. Call get_job_text only if the candidate asks about the job itself. Approving the draft, deciding findings and exporting are the candidate's, in DraftLoop.`;
}

/** Registers the task prompts on the server. */
export function registerApplicationPrompts(server: McpServer): void {
  server.registerPrompt(
    "applications",
    {
      title: "List my applications",
      description: "List your DraftLoop job applications and where their CV runs stand.",
      argsSchema: {
        filter: z
          .string()
          .max(120)
          .optional()
          .describe("Optional: a folder, a status, a name, or archived."),
      },
    },
    async ({ filter }) => ({
      messages: [{ role: "user", content: { type: "text", text: applicationsPrompt(filter) } }],
    }),
  );

  server.registerPrompt(
    "application-status",
    {
      title: "Application status",
      description: "Say where one DraftLoop application and its CV run stand, and your next step.",
      argsSchema: {
        application: z.string().min(1).max(192).describe("The application's name or id."),
      },
    },
    async ({ application }) => ({
      messages: [
        { role: "user", content: { type: "text", text: applicationStatusPrompt(application) } },
      ],
    }),
  );
}

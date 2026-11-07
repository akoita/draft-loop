import type { Command } from "commander";

import { ownerServerWorkspace } from "./server-application-import.js";
import { type ServerConnection, serverRequest } from "./server-client.js";
import {
  defaultServerUrl,
  readServerToken,
  type ServerImportDependencies,
} from "./server-import-commands.js";
import { type ApplicationIo, CliUserError } from "./workflow.js";

/**
 * `draft-loop work-journal` (#2024): the candidate reviews the notes agents recorded,
 * through the server's work journal API, as the web's Work journal panel does. The CLI only sends
 * the review; the server checks, merges, screens and publishes.
 */

interface ConnectionOptions {
  readonly server?: string;
  readonly tokenFile?: string;
  readonly serverWorkspace?: string;
  readonly json?: boolean;
}

interface ListedNote {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly period: { readonly start: string; readonly end?: string };
  readonly status: string;
}

/** The stored note's fields the CLI prints; the API's `WorkJournalStoredNote`. */
interface WorkJournalStoredNote {
  readonly id: string;
  readonly status: string;
  readonly content: {
    readonly title: string;
    readonly summary: string;
    readonly period: ListedNote["period"];
    readonly project: { readonly name: string; readonly visibility: string };
    readonly technologies: readonly string[];
    readonly candidate_role: readonly string[];
    readonly links: readonly { readonly kind: string; readonly url: string }[];
    readonly metrics: readonly { readonly description: string; readonly how_measured?: string }[];
  };
  readonly possible_duplicate_of: readonly string[];
  readonly approval?: { readonly tier: string };
  readonly screening: { readonly verdict: string };
}

const tiers = ["normal", "sensitive", "never-share"] as const;

function period(value: ListedNote["period"]): string {
  return value.end === undefined || value.end === value.start
    ? value.start
    : `${value.start} to ${value.end}`;
}

function noteLines(note: WorkJournalStoredNote): string[] {
  const { content } = note;
  return [
    `${content.title} (${note.id})`,
    `Status: ${note.status}. Screening: ${note.screening.verdict}${note.screening.verdict === "clear" ? "" : ", so it cannot be approved until an edit screens clear"}.`,
    `Project: ${content.project.name} (${content.project.visibility}). Period: ${period(content.period)}.`,
    `Technologies: ${content.technologies.join(", ")}. Role: ${content.candidate_role.join(", ")}.`,
    `Summary: ${content.summary}`,
    ...content.links.map((link) => `Link (${link.kind}): ${link.url}`),
    ...content.metrics.map(
      (metric) => `Metric: ${metric.description} (measured by ${metric.how_measured ?? "-"})`,
    ),
    ...(note.possible_duplicate_of.length === 0
      ? []
      : [`Likely the same work as: ${note.possible_duplicate_of.join(", ")}.`]),
  ];
}

export function registerWorkJournalCommands(
  root: Command,
  io: ApplicationIo,
  dependencies: ServerImportDependencies = {},
): void {
  const environment = dependencies.environment ?? process.env;
  const journal = root
    .command("work-journal")
    .description("Review the notes agents recorded on a DraftLoop server");

  const withConnection = (command: Command) =>
    command
      .option(
        "--server <url>",
        `server address (default: DRAFT_LOOP_SERVER_URL or ${defaultServerUrl})`,
      )
      .option(
        "--token-file <path>",
        "file holding the server token (default: DRAFT_LOOP_SERVER_TOKEN)",
      )
      .option(
        "--server-workspace <id>",
        `server workspace (default: ${ownerServerWorkspace}, the owner token's)`,
      )
      .option("--json", "print machine-readable JSON");

  const connect = async (options: ConnectionOptions) => {
    const connection: ServerConnection = {
      baseUrl: options.server ?? environment.DRAFT_LOOP_SERVER_URL ?? defaultServerUrl,
      token: await readServerToken(options, environment),
      fetch: dependencies.fetch ?? ((input, init) => fetch(input, init)),
    };
    const workspaceId = options.serverWorkspace ?? ownerServerWorkspace;
    const base = `/v1/workspaces/${encodeURIComponent(workspaceId)}`;
    return { connection, base };
  };

  const review = async (id: string, options: ConnectionOptions, body: unknown) => {
    const { connection, base } = await connect(options);
    const { body: note } = await serverRequest<WorkJournalStoredNote>(
      connection,
      `${base}/work-journal/notes/${encodeURIComponent(id)}/review`,
      { method: "POST", json: body },
    );
    return note;
  };

  const report = (options: ConnectionOptions, note: WorkJournalStoredNote, line: string) => {
    if (options.json === true) io.write(JSON.stringify(note, null, 2));
    else io.write(line);
  };

  withConnection(
    journal
      .command("list")
      .description("List the work journal's notes; pending ones by default")
      .option("--status <status>", "pending, approved, merged or discarded", "pending")
      .option("--project <name>", "only notes for this project"),
  ).action(async (options: ConnectionOptions & { status: string; project?: string }) => {
    const { connection, base } = await connect(options);
    const query = new URLSearchParams({ status: options.status, limit: "50" });
    if (options.project !== undefined) query.set("project", options.project);
    const { body } = await serverRequest<{ readonly notes?: readonly ListedNote[] }>(
      connection,
      `${base}/work-journal/notes?${query.toString()}`,
      { method: "GET" },
    );
    const notes = body.notes ?? [];
    if (options.json === true) {
      io.write(JSON.stringify({ notes }, null, 2));
      return;
    }
    if (notes.length === 0) {
      io.write(`No ${options.status} notes.`);
      return;
    }
    for (const note of notes) {
      io.write(`${note.id}  ${period(note.period)}  ${note.title} (${note.project})`);
    }
  });

  withConnection(
    journal.command("show").description("Show one note in full").argument("<note>", "note id"),
  ).action(async (id: string, options: ConnectionOptions) => {
    const { connection, base } = await connect(options);
    const { body: note } = await serverRequest<WorkJournalStoredNote>(
      connection,
      `${base}/work-journal/notes/${encodeURIComponent(id)}`,
      { method: "GET" },
    );
    if (options.json === true) io.write(JSON.stringify(note, null, 2));
    else for (const line of noteLines(note)) io.write(line);
  });

  withConnection(
    journal
      .command("approve")
      .description("Approve a pending note as career evidence in a knowledge base")
      .argument("<note>", "note id")
      .option(
        "--knowledge-base <id>",
        "knowledge base that receives it (default: the workspace's first selected one)",
      )
      .option(
        "--tier <tier>",
        "sensitivity: normal, sensitive or never-share (default: by the project's visibility)",
      ),
  ).action(
    async (id: string, options: ConnectionOptions & { knowledgeBase?: string; tier?: string }) => {
      if (options.tier !== undefined && !tiers.includes(options.tier as (typeof tiers)[number])) {
        throw new CliUserError("--tier takes normal, sensitive or never-share.");
      }
      let knowledgeBaseId = options.knowledgeBase;
      if (knowledgeBaseId === undefined) {
        const { connection, base } = await connect(options);
        const { body } = await serverRequest<{ readonly knowledgeBaseIds?: readonly string[] }>(
          connection,
          base,
          { method: "GET" },
        );
        knowledgeBaseId = body.knowledgeBaseIds?.[0];
        if (knowledgeBaseId === undefined) {
          throw new CliUserError(
            "The workspace has no selected knowledge base; pass --knowledge-base.",
          );
        }
      }
      const note = await review(id, options, {
        action: "approve",
        knowledge_base_id: knowledgeBaseId,
        ...(options.tier === undefined ? {} : { tier: options.tier }),
      });
      report(
        options,
        note,
        `Approved ${note.id} as career evidence in ${knowledgeBaseId} (${note.approval?.tier ?? "default"} tier).`,
      );
    },
  );

  withConnection(
    journal
      .command("merge")
      .description("Merge a pending note into another pending note about the same work")
      .argument("<note>", "note id to merge away")
      .requiredOption("--into <note>", "note id that keeps the merged content")
      .option("--keep-summary <which>", "into (default) or this", "into"),
  ).action(
    async (id: string, options: ConnectionOptions & { into: string; keepSummary: string }) => {
      if (options.keepSummary !== "into" && options.keepSummary !== "this") {
        throw new CliUserError("--keep-summary takes into or this.");
      }
      const note = await review(id, options, {
        action: "merge",
        into: options.into,
        keep_summary: options.keepSummary,
      });
      report(options, note, `Merged ${id} into ${note.id}; it waits for review.`);
    },
  );

  withConnection(
    journal.command("discard").description("Discard a pending note").argument("<note>", "note id"),
  ).action(async (id: string, options: ConnectionOptions) => {
    const note = await review(id, options, { action: "discard" });
    report(options, note, `Discarded ${note.id}; an agent cannot record it again.`);
  });
}

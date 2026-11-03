import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import { type ServerConnection, type ServerFetch, serverRequest } from "./server-client.js";
import {
  type ApplicationIo,
  type BackupImportPlan,
  CliUserError,
  readBackupForServerImport,
} from "./workflow.js";

const defaultServerUrl = "http://127.0.0.1:8080";

interface ImportOptions {
  readonly server?: string;
  readonly tokenFile?: string;
  readonly workspaceId?: string;
  readonly approve?: boolean;
  readonly json?: boolean;
}

interface ServerKnowledgeBase {
  readonly id: string;
  readonly description: string;
}

interface ServerSource {
  readonly screening?: { readonly verdict: string };
}

/** What a server import did or would do, as content-free counts. */
export interface EvidenceImportCounts {
  readonly knowledgeBases: number;
  readonly sources: number;
  /** Sources the server already held with the same bytes, so they were not stored again. */
  readonly alreadyOnServer: number;
  /** Uploaded sources whose screening flagged them or could not screen them; runs refuse them until released. */
  readonly quarantined: number;
  readonly skippedRetired: number;
  readonly skippedUnsupported: number;
  readonly archivedKnowledgeBases: number;
}

export interface ServerImportDependencies {
  readonly fetch?: ServerFetch;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * The description an imported base carries. It names the desktop base it came from, so a rerun
 * finds the same server base and resumes into it instead of creating another.
 */
export function importedKnowledgeBaseDescription(storeId: string, knowledgeBaseId: string): string {
  return `Imported from the desktop app (store ${storeId}, knowledge base ${knowledgeBaseId}).`;
}

/** The upload's file name: the source's name without path separators or control characters. */
export function uploadName(displayName: string): string {
  const cleaned = [...displayName]
    .map((character) => (character < " " || "\u007f/\\".includes(character) ? "-" : character))
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned.length === 0 ? "source" : cleaned;
}

function plannedCounts(plan: BackupImportPlan): EvidenceImportCounts {
  const skipped = plan.knowledgeBases.flatMap((base) => base.skipped);
  return {
    knowledgeBases: plan.knowledgeBases.length,
    sources: plan.knowledgeBases.reduce((total, base) => total + base.sources.length, 0),
    alreadyOnServer: 0,
    quarantined: 0,
    skippedRetired: skipped.filter(({ reason }) => reason === "retired").length,
    skippedUnsupported: skipped.filter(({ reason }) => reason === "unsupported-type").length,
    archivedKnowledgeBases: plan.archivedKnowledgeBases,
  };
}

/** Uploads every planned source through the server's ordinary upload route (ADR 0011, D12). */
export async function importEvidenceToServer(
  plan: BackupImportPlan,
  connection: ServerConnection,
  workspaceId: string | undefined,
): Promise<EvidenceImportCounts> {
  const listed = await serverRequest<{ knowledgeBases: readonly ServerKnowledgeBase[] }>(
    connection,
    `/v1/knowledge-bases${workspaceId === undefined ? "" : `?workspaceId=${encodeURIComponent(workspaceId)}`}`,
    { method: "GET" },
  );
  let alreadyOnServer = 0;
  let quarantined = 0;
  for (const base of plan.knowledgeBases) {
    const description = importedKnowledgeBaseDescription(plan.storeId, base.id);
    let target = listed.body.knowledgeBases.find((known) => known.description === description);
    if (target === undefined) {
      target = (
        await serverRequest<ServerKnowledgeBase>(connection, "/v1/knowledge-bases", {
          method: "POST",
          json: {
            displayName: base.displayName,
            description,
            ...(workspaceId === undefined ? {} : { workspaceId }),
          },
        })
      ).body;
    }
    for (const source of base.sources) {
      const bytes = await plan.read(source);
      const uploaded = await serverRequest<ServerSource>(
        connection,
        `/v1/knowledge-bases/${encodeURIComponent(target.id)}/sources?name=${encodeURIComponent(uploadName(source.displayName))}`,
        { method: "POST", file: { bytes, mediaType: source.mediaType } },
      );
      if (uploaded.status === 200) alreadyOnServer += 1;
      const verdict = uploaded.body.screening?.verdict;
      if (verdict === "flagged" || verdict === "unscreened") quarantined += 1;
    }
  }
  return { ...plannedCounts(plan), alreadyOnServer, quarantined };
}

async function readToken(
  options: ImportOptions,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const token =
    options.tokenFile === undefined
      ? environment.DRAFT_LOOP_SERVER_TOKEN
      : await readFile(resolve(options.tokenFile), "utf8").catch(() => {
          throw new CliUserError(`The token file ${options.tokenFile} could not be read.`);
        });
  const trimmed = token?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new CliUserError(
      "No server token. Pass --token-file, or set DRAFT_LOOP_SERVER_TOKEN; `draft-loop-server token` prints the owner token.",
    );
  }
  return trimmed;
}

function countLines(counts: EvidenceImportCounts, sent: boolean): string[] {
  const lines = [
    `${counts.sources} source${counts.sources === 1 ? "" : "s"} in ${counts.knowledgeBases} knowledge base${counts.knowledgeBases === 1 ? "" : "s"} ${sent ? "imported" : "to import"}.`,
  ];
  if (sent && counts.alreadyOnServer > 0) {
    lines.push(`${counts.alreadyOnServer} were already on the server and were not stored again.`);
  }
  if (sent && counts.quarantined > 0) {
    lines.push(
      `${counts.quarantined} were quarantined by screening; a run refuses them until an owner releases them.`,
    );
  }
  if (counts.skippedRetired > 0)
    lines.push(`${counts.skippedRetired} retired sources are left out.`);
  if (counts.skippedUnsupported > 0) {
    lines.push(
      `${counts.skippedUnsupported} sources are left out because the server takes only PDF, Word, Markdown and plain text files.`,
    );
  }
  if (counts.archivedKnowledgeBases > 0) {
    lines.push(`${counts.archivedKnowledgeBases} archived knowledge bases are left out.`);
  }
  return lines;
}

/**
 * Registers `server import`, which brings a desktop user's career evidence into a DraftLoop server
 * through its HTTP API. It prints what it would send and sends only with `--approve`.
 */
export function registerServerImportCommands(
  root: Command,
  io: ApplicationIo,
  dependencies: ServerImportDependencies = {},
): void {
  const environment = dependencies.environment ?? process.env;
  const server = root
    .command("server")
    .description("Bring desktop data into a DraftLoop server, such as the self-hosted one");

  server
    .command("import")
    .description(
      "Upload a portable career evidence backup to the server; nothing is sent without --approve",
    )
    .argument("<backup>", "portable backup directory, from `draft-loop knowledge export`")
    .option(
      "--server <url>",
      `server address (default: DRAFT_LOOP_SERVER_URL or ${defaultServerUrl})`,
    )
    .option(
      "--token-file <path>",
      "file holding the server token (default: DRAFT_LOOP_SERVER_TOKEN)",
    )
    .option("--workspace-id <id>", "server candidate record that owns the imported bases")
    .option("--approve", "send the files; without it only the counts are printed")
    .option("--json", "print machine-readable JSON")
    .action(async (backup: string, options: ImportOptions) => {
      const plan = await readBackupForServerImport(resolve(backup));
      if (options.approve !== true) {
        const counts = plannedCounts(plan);
        if (options.json === true) {
          io.write(JSON.stringify({ status: "preview", counts }, null, 2));
          return;
        }
        for (const line of countLines(counts, false)) io.write(line);
        io.write("Nothing was sent. Run again with --approve to upload these files.");
        return;
      }
      const connection: ServerConnection = {
        baseUrl: options.server ?? environment.DRAFT_LOOP_SERVER_URL ?? defaultServerUrl,
        token: await readToken(options, environment),
        fetch: dependencies.fetch ?? ((input, init) => fetch(input, init)),
      };
      const counts = await importEvidenceToServer(plan, connection, options.workspaceId);
      if (options.json === true) {
        io.write(JSON.stringify({ status: "imported", counts }, null, 2));
        return;
      }
      for (const line of countLines(counts, true)) io.write(line);
      io.write("The desktop backup was not changed.");
    });
}

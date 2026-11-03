import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * `draftloop-mcp init` (#2025): sets up the work journal in one project for one host. It writes the
 * MCP server entry, a short instructions snippet, the `/log-work` skill and, for Claude Code on
 * request, an advisory Stop hook. Every file holds only names: the token stays in the environment
 * and no path of this machine is written. Existing files are merged, never replaced.
 */

export const initHosts = ["claude-code", "codex", "generic"] as const;
export type InitHost = (typeof initHosts)[number];

export interface InitOptions {
  readonly host: InitHost;
  /** The command that starts the MCP server; `draftloop-mcp` once it is on the PATH. */
  readonly command: string;
  /** Claude Code only: the advisory Stop hook. */
  readonly hook: boolean;
}

export interface PlannedFile {
  readonly path: string;
  readonly content: string;
  /** What `init` does to the file, for its report. */
  readonly change: "created" | "updated" | "unchanged";
}

export const snippetStart = "<!-- draftloop:work-journal -->";
export const snippetEnd = "<!-- /draftloop:work-journal -->";

/** The six lines the project's agent instructions get. */
export const instructionsSnippet = [
  snippetStart,
  "## DraftLoop work journal",
  "",
  "- After a merge or release a hiring manager would care about, call `record_work` once for that work; skip typo fixes, dependency bumps and work in progress.",
  "- Call `list_work` first so the same work is not recorded twice, and use `amends` to correct a pending note.",
  "- Never include keys, tokens, passwords, customer or personal data, or private document text; set `visibility` to `private` for a private project.",
  "- State the candidate's role as it was; the candidate reviews every note in DraftLoop.",
  snippetEnd,
].join("\n");

export const logWorkSkill = `---
name: log-work
description: Record notable work merged in a date range into the DraftLoop work journal, for the candidate's review.
---

# Log notable work

Use this when the candidate asks to log work, optionally with a date range such as "since 2026-10-01" or "last week". Without a range, use the last 14 days.

1. List what was merged in the range from the local git history, on the default branch:

   \`\`\`text
   git log --first-parent --since=<from> --until=<to> --date=short --pretty="%h %ad %s"
   \`\`\`

2. Group the commits into pieces of work, by pull request number or by feature.
3. Keep only notable work, by the rule in \`draftloop://work-journal/guide\`: shipped features, integrations, migrations, adopted technologies and measured improvements. Drop typo fixes, formatting, dependency bumps and refactors without an outcome.
4. Call \`list_work\` for the project, and skip work that is already recorded.
5. Call \`record_work\` once per remaining piece, with the commit or pull request links as https links. Ask the candidate when their role or the project's visibility is unclear.
6. Say what you recorded and what you skipped. The notes wait for the candidate's review in DraftLoop.

Never include keys, tokens, passwords, customer or personal data, or private document text.
`;

/** The hook command; `draftloop-mcp hook stop` reads the turn and prints at most one line. */
function hookCommand(command: string): string {
  return `${command} hook stop`;
}

const serverEnvironment = {
  DRAFT_LOOP_SERVER_URL: "${DRAFT_LOOP_SERVER_URL:-http://127.0.0.1:8080}",
  DRAFT_LOOP_SERVER_TOKEN: "${DRAFT_LOOP_SERVER_TOKEN:-}",
};

function splitCommand(command: string): { readonly command: string; readonly args: string[] } {
  const [head = "draftloop-mcp", ...args] = command.trim().split(/\s+/u);
  return { command: head, args };
}

type Json = Record<string, unknown>;

function parseJson(path: string, text: string | undefined): Json {
  if (text === undefined || text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Json;
    }
  } catch {
    // Reported below.
  }
  throw new Error(`${path} is not a JSON object; fix it or move it aside, then run init again.`);
}

function object(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function mergeMcpJson(text: string | undefined, options: InitOptions): string {
  const current = parseJson(".mcp.json", text);
  const servers = object(current.mcpServers);
  return `${JSON.stringify(
    {
      ...current,
      mcpServers: {
        ...servers,
        draftloop: { ...splitCommand(options.command), env: serverEnvironment },
      },
    },
    null,
    2,
  )}\n`;
}

function mergeClaudeSettings(text: string | undefined, options: InitOptions): string {
  const current = parseJson(".claude/settings.json", text);
  const hooks = object(current.hooks);
  const command = hookCommand(options.command);
  const stop = Array.isArray(hooks.Stop) ? (hooks.Stop as unknown[]) : [];
  const present = JSON.stringify(stop).includes(JSON.stringify(command));
  const entry = { hooks: [{ type: "command", command }] };
  return `${JSON.stringify(
    { ...current, hooks: { ...hooks, Stop: present ? stop : [...stop, entry] } },
    null,
    2,
  )}\n`;
}

const codexStart = "# draftloop:work-journal";
const codexEnd = "# /draftloop:work-journal";

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexBlock(options: InitOptions): string {
  const { command, args } = splitCommand(options.command);
  return [
    codexStart,
    "[mcp_servers.draftloop]",
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    'env_vars = ["DRAFT_LOOP_SERVER_URL", "DRAFT_LOOP_SERVER_TOKEN"]',
    codexEnd,
  ].join("\n");
}

/** Replaces the marked block, or appends it after a blank line. */
function withBlock(text: string | undefined, start: string, end: string, block: string): string {
  const current = text ?? "";
  const from = current.indexOf(start);
  const to = current.indexOf(end);
  if (from !== -1 && to > from) {
    return `${current.slice(0, from)}${block}${current.slice(to + end.length)}`;
  }
  const separator = current === "" ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${block}\n`;
}

/** The files `init` writes for a host, merged into what the project already holds. */
export function planInit(
  options: InitOptions,
  read: (path: string) => string | undefined,
): PlannedFile[] {
  const files: { path: string; content: string }[] = [];
  const instructions = options.host === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
  if (options.host === "claude-code" || options.host === "generic") {
    files.push({ path: ".mcp.json", content: mergeMcpJson(read(".mcp.json"), options) });
  }
  if (options.host === "codex") {
    const path = ".codex/config.toml";
    files.push({ path, content: withBlock(read(path), codexStart, codexEnd, codexBlock(options)) });
  }
  files.push({
    path: instructions,
    content: withBlock(read(instructions), snippetStart, snippetEnd, instructionsSnippet),
  });
  const skillFolder = options.host === "claude-code" ? ".claude/skills" : ".agents/skills";
  files.push({ path: `${skillFolder}/log-work/SKILL.md`, content: logWorkSkill });
  if (options.host === "claude-code" && options.hook) {
    const path = ".claude/settings.json";
    files.push({ path, content: mergeClaudeSettings(read(path), options) });
  }
  return files.map((file) => {
    const before = read(file.path);
    return {
      ...file,
      change: before === undefined ? "created" : before === file.content ? "unchanged" : "updated",
    };
  });
}

export const initUsage = `Usage: draftloop-mcp init --host claude-code|codex|generic [--hook] [--command <command>] [--dry-run]

Sets up the DraftLoop work journal in the current project. The token stays in DRAFT_LOOP_SERVER_TOKEN.`;

export interface InitArguments extends InitOptions {
  readonly dryRun: boolean;
}

/** The `init` arguments, or why they cannot be used. */
export function parseInitArguments(argv: readonly string[]): InitArguments | { problem: string } {
  let host: string | undefined;
  let command = "draftloop-mcp";
  let hook = false;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--host") host = argv[++index];
    else if (argument === "--command") command = argv[++index] ?? "";
    else if (argument === "--hook") hook = true;
    else if (argument === "--dry-run") dryRun = true;
    else return { problem: `Unknown argument ${argument}.\n\n${initUsage}` };
  }
  if (!initHosts.includes(host as InitHost)) return { problem: initUsage };
  if (command.trim() === "") return { problem: "--command needs a command." };
  if (hook && host !== "claude-code") {
    return { problem: "--hook is for Claude Code only; other hosts get the skill and snippet." };
  }
  return { host: host as InitHost, command, hook, dryRun };
}

/** Plans and writes the files under `root`; returns one report line per file. */
export async function runInit(root: string, options: InitArguments): Promise<string[]> {
  const existing = new Map<string, string | undefined>();
  const paths = [
    ".mcp.json",
    ".codex/config.toml",
    "CLAUDE.md",
    "AGENTS.md",
    ".claude/skills/log-work/SKILL.md",
    ".agents/skills/log-work/SKILL.md",
    ".claude/settings.json",
  ];
  for (const path of paths) {
    existing.set(path, await readFile(join(root, path), "utf8").catch(() => undefined));
  }
  const planned = planInit(options, (path) => existing.get(path));
  if (!options.dryRun) {
    for (const file of planned) {
      if (file.change === "unchanged") continue;
      await mkdir(dirname(join(root, file.path)), { recursive: true });
      await writeFile(join(root, file.path), file.content);
    }
  }
  return [
    ...planned.map(
      (file) => `${options.dryRun ? `would be ${file.change}` : file.change}: ${file.path}`,
    ),
    'Set DRAFT_LOOP_SERVER_TOKEN to the token `draft-loop-server token` prints, then turn on "Accept notes from coding agents" on the Career evidence page.',
  ];
}

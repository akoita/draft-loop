import { homedir } from "node:os";
import { text } from "node:stream/consumers";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { defaultAgentTokenPath, saveTokenFromInput } from "./agent-token.js";
import { configFromEnvironment, createWorkJournalApi } from "./client.js";
import { journalHookMode, runStopHook } from "./hook.js";
import { parseInitArguments, runInit } from "./init.js";
import { runSessionStartHook, systemGit } from "./session-hook.js";
import {
  createDraftLoopMcpServer,
  mayBeOperatorToken,
  remoteMcpPath,
  remoteOptionsFromEnvironment,
  serveRemoteMcp,
} from "./remote.js";

const [command, ...rest] = process.argv.slice(2);

if (command === "init") {
  const parsed = parseInitArguments(rest);
  if ("problem" in parsed) {
    process.stderr.write(`${parsed.problem}\n`);
    process.exitCode = 2;
  } else {
    const setup = { environment: process.env, tokenPath: defaultAgentTokenPath() };
    const root = parsed.user === true ? homedir() : process.cwd();
    for (const line of await runInit(root, parsed, setup)) {
      process.stdout.write(`${line}\n`);
    }
  }
} else if (command === "hook" && rest[0] === "stop") {
  // The hook never fails the turn: any problem prints nothing.
  const mode = journalHookMode(process.env.REDAKLOOP_JOURNAL_HOOK);
  const output = await runStopHook(await text(process.stdin), mode).catch(() => "");
  if (output !== "") process.stdout.write(`${output}\n`);
} else if (command === "hook" && rest[0] === "session-start") {
  // Like the Stop hook, it never fails the session: any problem prints nothing.
  const mode = journalHookMode(process.env.REDAKLOOP_JOURNAL_HOOK);
  const api = createWorkJournalApi(configFromEnvironment());
  const output = await runSessionStartHook(await text(process.stdin), mode, {
    git: systemGit,
    listWork: (project) => api.list({ project, limit: 50 }),
  }).catch(() => "");
  if (output !== "") process.stdout.write(`${output}\n`);
} else if (command === "save-token" && rest.length === 0) {
  if (process.stdin.isTTY)
    process.stderr.write("Paste the agent token, then press Enter and Ctrl-D:\n");
  try {
    process.stdout.write(
      `${await saveTokenFromInput(await text(process.stdin), defaultAgentTokenPath())}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
} else if (command === "serve-http" && rest.length === 0) {
  const options = remoteOptionsFromEnvironment();
  const listening = await serveRemoteMcp(options);
  const address = listening.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  process.stderr.write(`Redakloop MCP tools on http://${options.host}:${port}${remoteMcpPath}\n`);
} else if (command === undefined) {
  // Stdout carries the protocol; nothing else may write to it. The operator's feedback tools are
  // offered when the token at start is not an agent token: the owner token is the operator's.
  const config = configFromEnvironment();
  const server = createDraftLoopMcpServer(config, {
    operator: mayBeOperatorToken(await config.token()),
  });
  await server.connect(new StdioServerTransport());
} else {
  process.stderr.write(
    "Usage: redakloop-mcp            serve the MCP tools over stdio\n       redakloop-mcp serve-http  serve the same tools over HTTP for assistants that connect by address\n       redakloop-mcp init --host claude-code|codex|generic [--hook] [--scope <scope>]... [--no-token]\n       redakloop-mcp init --host codex --user  the work journal rule for every Codex project\n       redakloop-mcp save-token  keep a token from Agents in Settings, read from standard input\n       redakloop-mcp hook stop   the Claude Code Stop hook: asks the agent to record merged work, never a failure\n       redakloop-mcp hook session-start  the SessionStart hook: points at merges missing from the journal\n",
  );
  process.exitCode = 2;
}

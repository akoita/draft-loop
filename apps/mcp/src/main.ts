import { text } from "node:stream/consumers";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { defaultAgentTokenPath, saveTokenFromInput } from "./agent-token.js";
import { configFromEnvironment } from "./client.js";
import { runStopHook } from "./hook.js";
import { parseInitArguments, runInit } from "./init.js";
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
    for (const line of await runInit(process.cwd(), parsed, setup)) {
      process.stdout.write(`${line}\n`);
    }
  }
} else if (command === "hook" && rest[0] === "stop") {
  // An advisory hook never fails the turn: any problem prints nothing.
  const output = await runStopHook(await text(process.stdin)).catch(() => "");
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
  process.stderr.write(`DraftLoop MCP tools on http://${options.host}:${port}${remoteMcpPath}\n`);
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
    "Usage: draftloop-mcp            serve the MCP tools over stdio\n       draftloop-mcp serve-http  serve the same tools over HTTP for assistants that connect by address\n       draftloop-mcp init --host claude-code|codex|generic [--hook] [--scope <scope>]... [--no-token]\n       draftloop-mcp save-token  keep a token from Agents in Workspace settings, read from standard input\n       draftloop-mcp hook stop   the Claude Code Stop hook: one advisory line, never a failure\n",
  );
  process.exitCode = 2;
}

import { text } from "node:stream/consumers";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { configFromEnvironment, createWorkJournalApi } from "./client.js";
import { runStopHook } from "./hook.js";
import { parseInitArguments, runInit } from "./init.js";
import { createWorkJournalMcpServer } from "./server.js";

const [command, ...rest] = process.argv.slice(2);

if (command === "init") {
  const parsed = parseInitArguments(rest);
  if ("problem" in parsed) {
    process.stderr.write(`${parsed.problem}\n`);
    process.exitCode = 2;
  } else {
    for (const line of await runInit(process.cwd(), parsed)) process.stdout.write(`${line}\n`);
  }
} else if (command === "hook" && rest[0] === "stop") {
  // An advisory hook never fails the turn: any problem prints nothing.
  const output = await runStopHook(await text(process.stdin)).catch(() => "");
  if (output !== "") process.stdout.write(`${output}\n`);
} else if (command === undefined) {
  // Stdout carries the protocol; nothing else may write to it.
  const server = createWorkJournalMcpServer(createWorkJournalApi(configFromEnvironment()));
  await server.connect(new StdioServerTransport());
} else {
  process.stderr.write(
    "Usage: draftloop-mcp            serve the MCP tools over stdio\n       draftloop-mcp init --host claude-code|codex|generic [--hook]\n",
  );
  process.exitCode = 2;
}

#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { configFromEnvironment, createWorkJournalApi } from "./client.js";
import { createWorkJournalMcpServer } from "./server.js";

// Stdout carries the protocol; nothing else may write to it.
const server = createWorkJournalMcpServer(createWorkJournalApi(configFromEnvironment()));
await server.connect(new StdioServerTransport());

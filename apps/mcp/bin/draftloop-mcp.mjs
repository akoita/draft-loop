#!/usr/bin/env node
// Runs the TypeScript entry point through this package's own tsx, so the command works from any
// folder once it is on the PATH (`pnpm link --global` from inside apps/mcp).
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");

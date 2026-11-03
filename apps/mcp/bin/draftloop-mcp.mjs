#!/usr/bin/env node
// Runs the TypeScript entry point through this package's own tsx, so the command works from any
// folder once it is on the PATH (`pnpm --dir apps/mcp link --global`).
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");

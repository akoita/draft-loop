#!/usr/bin/env node
// Runs the TypeScript CLI through this package's own tsx, so `draft-loop` works from any folder
// once it is on the PATH (`pnpm link --global` from inside apps/cli).
import { register } from "tsx/esm/api";

register();
const { runCli } = await import("../src/index.ts");
await runCli();

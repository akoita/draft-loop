import { builtinModules } from "node:module";

import { defineConfig } from "vite";

import { viteBuildGuard } from "./vite-build-guard.js";

export default defineConfig({
  plugins: [viteBuildGuard()],
  build: {
    target: "node24",
    rollupOptions: {
      external: [
        "electron",
        // Native module: shipped as an extra resource by forge.config.ts.
        "onnxruntime-node",
        // Optional Mistral SDK peers, deliberately not shipped: the SDK loads them in a
        // try/catch, so tracing and telemetry stay off. Bundling fails without them.
        /^@opentelemetry\//u,
        ...builtinModules,
        ...builtinModules.map((module) => `node:${module}`),
      ],
    },
  },
});

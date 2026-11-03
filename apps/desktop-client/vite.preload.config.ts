import { builtinModules } from "node:module";

import { defineConfig } from "vite";

import { viteBuildGuard } from "./vite-build-guard.js";

/** Main and preload bundles: Electron and Node built-ins stay external. */
export default defineConfig({
  plugins: [viteBuildGuard()],
  build: {
    target: "node24",
    rollupOptions: {
      external: [
        "electron",
        ...builtinModules,
        ...builtinModules.map((module) => `node:${module}`),
      ],
    },
  },
});

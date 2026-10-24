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
        ...builtinModules,
        ...builtinModules.map((module) => `node:${module}`),
      ],
    },
  },
});

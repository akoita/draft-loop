import { builtinModules } from "node:module";

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node24",
    rollupOptions: {
      external: [
        "electron",
        // Native module: shipped as an extra resource by forge.config.ts.
        "onnxruntime-node",
        ...builtinModules,
        ...builtinModules.map((module) => `node:${module}`),
      ],
    },
  },
});

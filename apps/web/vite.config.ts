import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

import { ortRuntimeFile } from "./src/ort-runtime.js";

const require = createRequire(import.meta.url);
// The package exports no package.json; its CommonJS entry sits in the `dist` folder with the runtime.
const ortDist = dirname(require.resolve("onnxruntime-web"));
const ortFiles = [`${ortRuntimeFile}.mjs`, `${ortRuntimeFile}.wasm`];
const ortTypes: Record<string, string> = { mjs: "text/javascript", wasm: "application/wasm" };

/**
 * Puts the ONNX runtime the speech worker needs at `/ort/` (#2200), so the browser loads it from
 * this origin and never from a CDN: emitted into the build, and served by the dev server.
 */
function ortRuntime(): Plugin {
  return {
    name: "draft-loop-ort-runtime",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.startsWith("/ort/") ? request.url.slice(5).split("?")[0] : "";
        if (name === undefined || !ortFiles.includes(name)) return next();
        response.setHeader("content-type", ortTypes[name.split(".").pop() ?? ""] ?? "");
        response.end(readFileSync(join(ortDist, name)));
      });
    },
    generateBundle() {
      for (const name of ortFiles) {
        this.emitFile({
          type: "asset",
          fileName: `ort/${name}`,
          source: readFileSync(join(ortDist, name)),
        });
      }
    },
  };
}

// `pnpm dev` proxies the API so the screen and `/v1` share an origin, as they do when the API
// serves the built screen.
export default defineConfig({
  plugins: [react(), ortRuntime()],
  // The runtime's extern-wasm build loads its files from `/ort/` alone, instead of also bundling
  // a hashed copy of the 27 MB WebAssembly file into the assets.
  resolve: { conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions] },
  worker: { format: "es" },
  server: {
    proxy: {
      "/v1": process.env.DRAFT_LOOP_WEB_API_URL ?? "http://127.0.0.1:8080",
      "/speech-models": process.env.DRAFT_LOOP_WEB_API_URL ?? "http://127.0.0.1:8080",
    },
  },
});

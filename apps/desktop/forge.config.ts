import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import MakerZIP from "@electron-forge/maker-zip";
import VitePlugin from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

const nodeModules = resolve(__dirname, "../../node_modules");
const onnxStaging = resolve(__dirname, ".native-staging/onnxruntime-node");

/**
 * Stages a pruned, CPU-only copy of onnxruntime-node for the target platform.
 * It is shipped as an extra resource because the Vite main bundle keeps the
 * module external (see vite.main.config.ts). GPU provider libraries and the
 * binaries of other platforms are left out; the model itself is never bundled.
 */
function stageOnnxRuntime(platform: string, arch: string): void {
  const source = resolve(nodeModules, "onnxruntime-node");
  const common = resolve(nodeModules, "onnxruntime-common");
  const binaries = resolve(source, "bin/napi-v6", platform, arch);
  if (!existsSync(binaries)) {
    throw new Error(
      `onnxruntime-node ships no ${platform}/${arch} binary (looked in ${binaries}); ` +
        "refusing to package a desktop build without a working embedding runtime.",
    );
  }
  if (!existsSync(common)) {
    throw new Error(`onnxruntime-common is missing at ${common}; run pnpm install.`);
  }
  rmSync(onnxStaging, { recursive: true, force: true });
  mkdirSync(onnxStaging, { recursive: true });
  for (const entry of ["package.json", "dist", "lib", "LICENSE", "ThirdPartyNotices.txt"]) {
    if (existsSync(resolve(source, entry))) {
      cpSync(resolve(source, entry), resolve(onnxStaging, entry), { recursive: true });
    }
  }
  cpSync(binaries, resolve(onnxStaging, "bin/napi-v6", platform, arch), {
    recursive: true,
    filter: (file) => !/providers_(cuda|tensorrt)/u.test(file),
  });
  cpSync(common, resolve(onnxStaging, "node_modules/onnxruntime-common"), { recursive: true });
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [resolve(nodeModules, "better-sqlite3"), onnxStaging],
  },
  hooks: {
    prePackage: async (_forgeConfig, platform, arch) => {
      stageOnnxRuntime(platform, arch);
    },
  },
  makers: [new MakerZIP({})],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/electron/main.ts", config: "vite.main.config.ts" },
        { entry: "src/electron/preload.ts", config: "vite.preload.config.ts" },
      ],
      renderer: [{ name: "main_window", config: "vite.config.ts" }],
    }),
  ],
};

export default config;

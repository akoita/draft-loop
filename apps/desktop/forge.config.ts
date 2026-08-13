import { resolve } from "node:path";

import MakerZIP from "@electron-forge/maker-zip";
import VitePlugin from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [resolve(__dirname, "../../node_modules/better-sqlite3")],
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

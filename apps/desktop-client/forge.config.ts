import MakerZIP from "@electron-forge/maker-zip";
import VitePlugin from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

/**
 * The client ships only its shell: the screens come from the server it opens, so there are no
 * native modules or engine resources to stage.
 */
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "DraftLoop",
    executableName: "draftloop",
  },
  makers: [new MakerZIP({})],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main.ts", config: "vite.main.config.ts" },
        { entry: "src/preload.ts", config: "vite.preload.config.ts" },
        { entry: "src/picker-preload.ts", config: "vite.preload.config.ts" },
      ],
      renderer: [{ name: "picker", config: "vite.renderer.config.ts" }],
    }),
  ],
};

export default config;

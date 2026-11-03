import { defineConfig } from "vite";

import { viteBuildGuard } from "./vite-build-guard.js";

/** The server picker page, the only page the client ships. */
export default defineConfig({
  plugins: [viteBuildGuard()],
  build: { target: "chrome140" },
});

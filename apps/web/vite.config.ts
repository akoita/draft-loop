import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `pnpm dev` proxies the API so the screen and `/v1` share an origin, as they do when the API
// serves the built screen.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/v1": process.env.DRAFT_LOOP_WEB_API_URL ?? "http://127.0.0.1:8080" },
  },
});

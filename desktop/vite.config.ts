import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function desktopConfiguration(): Plugin {
  let apiBaseUrl = "http://localhost:8008";
  return {
    name: "orbyn-desktop-configuration",
    apply: "build",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, "VITE_");
      apiBaseUrl = process.env.VITE_API_URL || env.VITE_API_URL || apiBaseUrl;
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "desktop-config.json",
        source: JSON.stringify({ version: 1, apiBaseUrl }),
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), desktopConfiguration()],
  base: "./",
  server: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_URL || "http://localhost:8008",
        rewrite: (p) => p.replace(/^\/api/, ""),
        // Links the API builds (the calendar feed) need the /api prefix.
        headers: { "X-Forwarded-Prefix": "/api" },
      },
      // Published pages (SHR-05) are written by the API at /p/<slug>, on
      // the web app's own address, as the gateway does in production.
      "^/p/": {
        target: process.env.API_PROXY_URL || "http://localhost:8008",
      },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
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

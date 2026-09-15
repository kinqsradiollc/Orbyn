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
    },
  },
});

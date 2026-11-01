import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { latexFrame } from "./tooling/latex-frame";

const api = process.env.API_PROXY_URL || "http://localhost:8008";

export default defineConfig({
  plugins: [react(), latexFrame()],
  server: {
    port: 5175,
    proxy: {
      "/api": {
        target: api,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: { "X-Forwarded-Prefix": "/api" },
      },
      "^/(p|s)/": { target: api },
      "^/dav(?:/|$)": { target: api },
      "^/\\.well-known/caldav$": { target: api },
    },
  },
});

import type { VersionInfo } from "@orbyn/core";
import { env } from "../config/env.js";

const startedAt = Date.now();

/** The build this process runs (baked into the image by scripts/deploy.sh). */
export function versionInfo(service: string): VersionInfo {
  return {
    version: env.APP_VERSION || "dev",
    built_at: env.BUILD_TIME || null,
    service,
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
  };
}

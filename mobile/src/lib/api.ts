import { OrbynClient } from "@orbyn/api-client";
import { session } from "./session";

export const client = new OrbynClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:8008",
  getToken: () => session.token,
});

/**
 * Where the web app lives, for links people open in a browser (booking
 * pages). The web app serves the API under /api, so without an explicit
 * EXPO_PUBLIC_WEB_URL this is the API origin with that suffix removed.
 */
export const webOrigin = (
  process.env.EXPO_PUBLIC_WEB_URL || client.baseUrl.replace(/\/api$/, "")
).replace(/\/$/, "");

import { OrbynClient } from "@orbyn/api-client";
import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { session } from "./session";

/**
 * Reading a document's live stream needs a fetch whose response has a
 * readable body. React Native's own fetch has none, so on a device that job
 * goes to Expo's. In the web build the platform fetch is the browser's,
 * which already streams — and Expo's does not run there.
 */
const streamFetch =
  Platform.OS === "web" ? undefined : (expoFetch as unknown as typeof fetch);

export const client = new OrbynClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:8008",
  getToken: () => session.token,
  streamFetch,
});

/**
 * Where the web app lives, for links people open in a browser (booking
 * pages). The web app serves the API under /api, so without an explicit
 * EXPO_PUBLIC_WEB_URL this is the API origin with that suffix removed.
 */
export const webOrigin = (
  process.env.EXPO_PUBLIC_WEB_URL || client.baseUrl.replace(/\/api$/, "")
).replace(/\/$/, "");

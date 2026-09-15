import { OrbynClient } from "@orbyn/api-client";
import { session } from "./session";

export const client = new OrbynClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:8008",
  getToken: () => session.token,
});

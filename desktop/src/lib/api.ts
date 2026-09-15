import { OrbynClient } from "@orbyn/api-client";
import { session } from "./session";

export const apiBase =
  import.meta.env.VITE_API_URL ||
  (location.protocol === "file:" ? "http://localhost:8008" : "/api");

export const client = new OrbynClient({
  baseUrl: apiBase,
  getToken: () => session.get(),
});

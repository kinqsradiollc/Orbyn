import { Platform } from "react-native";
import Constants from "expo-constants";
import { readLocal, saveLocal } from "./localPrefs";

/**
 * This phone (or the web build) as one of the person's devices: an id made
 * once and kept, the kind of app, and a name they'd recognise.
 */
const KEY = "orbyn-device-id";
let cached: string | null = null;

const randomId = () =>
  `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function deviceId() {
  if (cached) return cached;
  let id = readLocal(KEY);
  if (!id) {
    id = randomId();
    saveLocal(KEY, id);
  }
  cached = id;
  return id;
}

export const devicePlatform = (): "ios" | "android" | "web" =>
  Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

/** "iPhone", "Pixel 8", "Phone · web". */
export function deviceLabel() {
  if (Platform.OS === "web") return "Phone app · web";
  const name = Constants.deviceName?.trim();
  if (name) return name.slice(0, 60);
  return Platform.OS === "ios" ? "iPhone" : "Android phone";
}

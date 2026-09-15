import * as SecureStore from "expo-secure-store";

/**
 * Small choices kept on this device only (not synced), such as the theme or
 * the calendar set in view. Read synchronously so the first render uses them.
 */
export function readLocal(key: string): string | null {
  try {
    return SecureStore.getItem(key);
  } catch {
    return null;
  }
}

/** Saved in the background; if storage fails, the choice just won't stick. */
export function saveLocal(key: string, value: string) {
  SecureStore.setItemAsync(key, value).catch(() => {});
}

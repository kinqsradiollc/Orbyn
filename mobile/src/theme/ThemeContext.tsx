import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance, useColorScheme } from "react-native";
import * as SystemUI from "expo-system-ui";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { applyScheme, colors, type Scheme } from "./live";

/** Follow the device, or always light, or always dark. */
export type ThemePreference = "system" | "light" | "dark";
export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

const KEY = "orbyn-theme";

/**
 * The saved choice, read synchronously so the first frame is already right.
 * Light until someone picks Automatic or Dark in Settings.
 */
function savedPreference(): ThemePreference {
  const value = readLocal(KEY);
  return value === "system" || value === "dark" ? value : "light";
}

export type Theme = {
  preference: ThemePreference;
  /** What is showing now. */
  scheme: Scheme;
  setPreference: (next: ThemePreference) => void;
};

export const ThemeContext = createContext<Theme>({
  preference: "light",
  scheme: "light",
  setPreference: () => {},
});

/**
 * Owns the theme: the saved preference, the device appearance, and the native
 * side (window appearance for alerts, pickers and the keyboard; the root
 * background). Call it once, in App, and provide the result: App re-renders on
 * a change, so the whole tree re-renders with the new tokens.
 */
export function useThemeController(): Theme {
  const [preference, setPreferenceState] = useState(savedPreference);
  const system = useColorScheme();
  const scheme: Scheme =
    preference === "system"
      ? system === "dark"
        ? "dark"
        : "light"
      : preference;
  // Tokens must switch before any child renders; this is idempotent.
  applyScheme(scheme);

  useEffect(() => {
    Appearance.setColorScheme(
      preference === "system" ? "unspecified" : preference,
    );
  }, [preference]);
  useEffect(() => {
    // Paint the native root view so rotation and modal transitions never flash.
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [scheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    saveLocal(KEY, next);
  }, []);
  return useMemo(
    () => ({ preference, scheme, setPreference }),
    [preference, scheme, setPreference],
  );
}

/** The current theme and a way to change it. */
export const useTheme = () => useContext(ThemeContext);

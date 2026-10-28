import { useEffect, useState } from "react";

/** One device preference shared by public pages, sign-in and the planner. */
export type ThemeChoice = "light" | "dark";

/** Also read by the inline script in index.html, before first paint. */
const THEME_KEY = "orbyn-theme";
const THEME_EVENT = "orbyn-theme-change";
let volatileChoice: ThemeChoice = "light";
let themeCleanupFrame: number | undefined;
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** Page backgrounds, for the browser's theme colour. */
const BACKGROUNDS = { light: "#fafafa", dark: "#171717" };

export function savedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "system") {
      // Preserve the resolved appearance once, then stop following the device.
      const migrated = window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
      volatileChoice = migrated;
      try {
        localStorage.setItem(THEME_KEY, migrated);
      } catch {
        /* This visit only. */
      }
      return migrated;
    }
    return value === "dark" ? "dark" : "light";
  } catch {
    return volatileChoice;
  }
}

/** Sets `data-theme` on <html> to what the choice resolves to, and the theme colour. */
export function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark";
  const root = document.documentElement;
  const next = dark ? "dark" : "light";
  if (root.dataset.theme !== next) {
    // Hover transitions must not interpolate old palette colours against the
    // new page background. Commit the palette with transitions suppressed.
    root.dataset.themeSwitching = "";
    root.dataset.theme = next;
    void root.offsetHeight;
    if (themeCleanupFrame !== undefined)
      window.cancelAnimationFrame(themeCleanupFrame);
    themeCleanupFrame = window.requestAnimationFrame(() => {
      themeCleanupFrame = window.requestAnimationFrame(() => {
        delete root.dataset.themeSwitching;
        themeCleanupFrame = undefined;
      });
    });
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? BACKGROUNDS.dark : BACKGROUNDS.light);
}

/** The saved theme and a setter that applies and remembers it. */
export function useTheme() {
  const [choice, setChoice] = useState(savedTheme);
  useEffect(() => {
    const sync = () => {
      const next = savedTheme();
      setChoice(next);
      applyTheme(next);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) sync();
    };
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener("storage", storage);
    };
  }, []);
  const change = (next: ThemeChoice) => {
    volatileChoice = next;
    setChoice(next);
    try {
      if (next === "light") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice lasts this visit.
    }
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  return [choice, change] as const;
}

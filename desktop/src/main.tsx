import { colors, motion, statusTones } from "@orbyn/core";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ConfirmProvider } from "./components/Confirm";
import { ToastProvider } from "./components/Toast";
import { applyTheme, followSystemTheme, savedTheme } from "./lib/theme";
import "katex/dist/katex.min.css";
import "./styles/global.css";
import "./styles/theme.css";
import "./styles/legacy-dark.css";
import "./styles/motion.css";

// The shared palette as the light theme, in a stylesheet (not inline on
// <html>) so the dark values in styles/theme.css can override it.
const light = [
  ...Object.entries(colors).map(([name, value]) => `--color-${name}:${value};`),
  // Task status tones (same values as mobile), e.g. --status-blocked-fg.
  ...Object.entries(statusTones).map(
    ([status, tone]) =>
      `--status-${status}-bg:${tone.bg};--status-${status}-fg:${tone.fg};`,
  ),
].join("");
const palette = document.createElement("style");
palette.textContent = `:root,.theme-light{${light}}`;
document.head.prepend(palette);
applyTheme(savedTheme());
followSystemTheme();

// Shared motion tokens (the mobile app uses the same values).
const root = document.documentElement.style;
const bezier = (points: readonly number[]) =>
  "cubic-bezier(" + points.join(", ") + ")";
root.setProperty("--motion-fast", motion.fast + "ms");
root.setProperty("--motion-base", motion.base + "ms");
root.setProperty("--motion-slow", motion.slow + "ms");
root.setProperty("--motion-stagger", motion.stagger + "ms");
root.setProperty("--motion-max-stagger", String(motion.maxStagger));
root.setProperty("--motion-distance", motion.distance + "px");
root.setProperty("--motion-press-scale", String(motion.pressScale));
root.setProperty("--ease-out", bezier(motion.easeOut));
root.setProperty("--ease-in-out", bezier(motion.easeInOut));

createRoot(document.getElementById("root")!).render(
  <ConfirmProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ConfirmProvider>,
);

import { colors, motion } from "@orbyn/core";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/global.css";
import "./styles/motion.css";

const root = document.documentElement.style;
for (const [name, value] of Object.entries(colors))
  root.setProperty("--color-" + name, value);

// Shared motion tokens (the mobile app uses the same values).
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

createRoot(document.getElementById("root")!).render(<App />);

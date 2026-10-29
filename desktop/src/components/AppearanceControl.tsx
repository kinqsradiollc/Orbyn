import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";
import "./appearance-control.css";

/** One explicit Light/Dark preference across public pages and the planner. */
export function AppearanceControl() {
  const [choice, change] = useTheme();
  const dark = choice === "dark";
  return (
    <button
      type="button"
      className="appearance-control"
      role="switch"
      aria-label="Dark appearance"
      aria-checked={dark}
      title={`Switch to ${dark ? "light" : "dark"} appearance`}
      onClick={() => change(dark ? "light" : "dark")}
    >
      <span className="appearance-track" aria-hidden="true">
        <Sun size={14} className="appearance-light" />
        <Moon size={14} className="appearance-dark" />
        <span className="appearance-thumb" />
      </span>
    </button>
  );
}

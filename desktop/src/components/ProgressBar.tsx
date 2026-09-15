import type { Status } from "@orbyn/core";

type Props = {
  /** 0-100. */
  value: number;
  /** Tints the fill with the status tone. */
  status?: Status;
  size?: "sm" | "lg";
  /** Accessible name, e.g. "Progress on Write report". */
  label: string;
  /** Hide the "40%" text (the value is still announced). */
  hideValue?: boolean;
};

/** Slim (rows) or large (task detail) progress bar with its percentage. */
export function ProgressBar({
  value,
  status,
  size = "sm",
  label,
  hideValue,
}: Props) {
  const pct = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <span
      className={`progress-bar ${size} ${status ? "tone-" + status : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="progress-bar-track">
        <span
          className="progress-bar-fill"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </span>
      {!hideValue && <span className="progress-bar-value">{pct}%</span>}
    </span>
  );
}

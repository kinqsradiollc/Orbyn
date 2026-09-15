import { RefreshCw, Sparkles, Wrench, X } from "lucide-react";
import type { Maintenance } from "@orbyn/core";
import { formatDateTime } from "../lib/format";

/** Slim notice at the top of the signed-in app while maintenance is on. */
export function MaintenanceBanner({
  maintenance,
  isAdmin,
}: {
  maintenance: Maintenance | null;
  isAdmin: boolean;
}) {
  if (!maintenance?.enabled) return null;
  return (
    <div className="app-banner is-maintenance" role="status">
      <Wrench size={15} aria-hidden="true" />
      {isAdmin ? (
        <p>
          <strong>Maintenance mode is on.</strong> Members can&apos;t make
          changes.
        </p>
      ) : (
        <p>
          <strong>Orbyn is under maintenance.</strong> You can view everything,
          but changes are paused.
          {maintenance.message && <span> {maintenance.message}</span>}
          {maintenance.until && (
            <span>
              {" "}
              Expected back{" "}
              <time dateTime={maintenance.until}>
                {formatDateTime(maintenance.until)}
              </time>
              .
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** Non-blocking prompt to reload when the server runs a newer build. */
export function UpdateBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="app-banner is-update" role="status">
      <Sparkles size={15} aria-hidden="true" />
      <p>A new version of Orbyn is available.</p>
      <button className="secondary" onClick={() => location.reload()}>
        <RefreshCw size={13} /> Reload
      </button>
      <button
        className="icon-button"
        aria-label="Dismiss new version notice"
        onClick={onDismiss}
      >
        <X size={15} />
      </button>
    </div>
  );
}

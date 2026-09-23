import { useEffect, useState } from "react";
import { Megaphone, RefreshCw, Sparkles, Wrench, X } from "lucide-react";
import type { Announcement, Maintenance } from "@orbyn/core";
import { client } from "../lib/api";
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

const SEEN_KEY = "orbyn-announcement-dismissed";

/**
 * The admins' notice to everyone ("Planned update tonight at 10pm"). Checked
 * every minute; once dismissed, that notice stays hidden in this browser and
 * the next one shows again.
 */
export function AnnouncementBanner() {
  const [notice, setNotice] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      client.announcement().then(
        (a) => alive && setNotice(a),
        () => {},
      );
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (!notice || dismissed === notice.updated_at) return null;
  return (
    <div
      className={
        "app-banner is-announcement" +
        (notice.tone === "warning" ? " is-warning" : "")
      }
      role="status"
    >
      <Megaphone size={15} aria-hidden="true" />
      <p>
        {notice.message}
        {notice.until && (
          <span className="muted">
            {" "}
            · until{" "}
            <time dateTime={notice.until}>{formatDateTime(notice.until)}</time>
          </span>
        )}
      </p>
      <button
        className="icon-button"
        aria-label="Dismiss"
        onClick={() => {
          const key = notice.updated_at ?? "";
          setDismissed(key);
          try {
            localStorage.setItem(SEEN_KEY, key);
          } catch {
            // Hidden for this visit only.
          }
        }}
      >
        <X size={15} />
      </button>
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

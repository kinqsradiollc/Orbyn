import type { Announcement, Maintenance } from "@orbyn/core";
import { Megaphone, Wrench, X } from "lucide-react";
import { useEffect, useState } from "react";
import { client } from "../lib/session";
import { IconButton } from "../ui/kit";

const SEEN_KEY = "orbyn-announcement-dismissed";

function seen() {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Notices for everyone: planned maintenance and admin announcements. */
export function Banners({ isAdmin }: { isAdmin: boolean }) {
  const [notice, setNotice] = useState<Announcement | null>(null);
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null);
  const [dismissed, setDismissed] = useState(seen);

  useEffect(() => {
    let live = true;
    const load = () => {
      void client.announcement().then(
        (a) => live && setNotice(a),
        () => undefined,
      );
      void client.getStatus().then(
        (s) => live && setMaintenance(s.maintenance),
        () => undefined,
      );
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <>
      {maintenance?.enabled && (
        <div className="banner banner-warn" role="status">
          <Wrench aria-hidden="true" />
          <p>
            {isAdmin
              ? "Maintenance is on. Member edits are paused."
              : `Maintenance. You can view, but edits are paused.${maintenance.message ? ` ${maintenance.message}` : ""}${
                  maintenance.until
                    ? ` Expected back ${new Date(maintenance.until).toLocaleString()}.`
                    : ""
                }`}
          </p>
        </div>
      )}
      {notice && dismissed !== notice.updated_at && (
        <div
          className={`banner${notice.tone === "warning" ? " banner-warn" : ""}`}
          role="status"
        >
          <Megaphone aria-hidden="true" />
          <p>
            {notice.message}
            {notice.until &&
              ` Until ${new Date(notice.until).toLocaleString()}.`}
          </p>
          <IconButton
            label="Dismiss"
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
            <X />
          </IconButton>
        </div>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { latestRelease, releasesSince } from "@orbyn/core";
import { Releases } from "./Releases";
import "./whatsnew.css";

const SEEN_KEY = "orbyn-whats-new-seen";

/** The newest release this browser has shown, or null for a new one. */
export function seenRelease(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** Remember the newest release as seen, so the sheet opens by itself once. */
export function markReleaseSeen() {
  try {
    localStorage.setItem(SEEN_KEY, latestRelease().date);
  } catch {
    // Private windows can refuse storage; it may show once more.
  }
}

/**
 * "What's new" (DSN-03): the releases since this browser last looked (or
 * the newest one), the newest open, and the whole changelog a link away.
 * Opens by itself once after a release; from ⌘K and Settings any time.
 */
export function WhatsNew({
  onClose,
  onOpenChangelog,
}: {
  onClose: () => void;
  onOpenChangelog: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  // Read before the effect below marks the newest release as seen.
  const [releases] = useState(() => releasesSince(seenRelease()));
  useEffect(() => {
    markReleaseSeen();
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal whats-new scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        <div className="section-heading">
          <h2 id="whats-new-title">What's new</h2>
          <button
            ref={close}
            className="icon-button"
            aria-label="Close What's new"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="whats-new-body">
          <Releases releases={releases} headingLevel={3} />
        </div>
        <div className="whats-new-foot">
          <button className="text-button" onClick={onOpenChangelog}>
            Every release <ArrowUpRight size={14} />
          </button>
          <button className="primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}

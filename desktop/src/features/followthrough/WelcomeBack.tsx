import { useEffect, useRef, useState } from "react";
import { Hand } from "lucide-react";
import type { ReentryBrief, ReentryLine } from "@orbyn/core";
import { client } from "../../lib/api";
import "./followthrough.css";

const SECTIONS: { key: keyof ReentryBrief; label: string }[] = [
  { key: "asks", label: "Waiting for your answer" },
  { key: "assigned", label: "Handed to you" },
  { key: "due", label: "Due now" },
  { key: "changed", label: "Moved on your tasks" },
  { key: "mentions", label: "You were mentioned" },
  { key: "pages", label: "Pages that changed" },
];

/**
 * Back after a few days away: what happened meanwhile, in a few short
 * lists, most pressing first. Shows once; "Got it" puts it away.
 */
export function WelcomeBack({
  onOpenItem,
  onOpenDoc,
  onOpenAsks,
}: {
  onOpenItem: (itemId: string) => void;
  onOpenDoc: (docId: string) => void;
  onOpenAsks: () => void;
}) {
  const [brief, setBrief] = useState<ReentryBrief | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dismissing = useRef(false);
  useEffect(() => {
    let alive = true;
    client.reentry().then(
      (value) => {
        if (alive) setBrief(value);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  if (!brief) return null;
  const sections = SECTIONS.map((s) => ({
    ...s,
    lines: brief[s.key] as ReentryLine[],
  })).filter((s) => s.lines.length);
  const dismiss = () => {
    if (dismissing.current) return;
    dismissing.current = true;
    setBusy(true);
    setError("");
    void client.dismissReentry().then(
      () => setBrief(null),
      () => {
        dismissing.current = false;
        setBusy(false);
        setError("Could not dismiss. Try again.");
      },
    );
  };
  const open = (l: ReentryLine) =>
    l.ask_id
      ? onOpenAsks()
      : l.item_id
        ? onOpenItem(l.item_id)
        : l.doc_id
          ? onOpenDoc(l.doc_id)
          : undefined;
  return (
    <section className="card welcome-back" aria-labelledby="welcome-back-title">
      <header>
        <Hand size={18} aria-hidden="true" />
        <div>
          <h2 id="welcome-back-title">Welcome back</h2>
          <p className="muted">
            {brief.days_away} {brief.days_away === 1 ? "day" : "days"} away
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={dismiss}>
          Got it
        </button>
      </header>
      {sections.length > 0 && (
        <div className="welcome-back-grid">
          {sections.map((s) => (
            <div key={s.key}>
              <h3>
                {s.label} <span className="muted">{s.lines.length}</span>
              </h3>
              <ul>
                {(expanded ? s.lines : s.lines.slice(0, 3)).map((l, n) => (
                  <li key={n}>
                    <button
                      className="welcome-line"
                      onClick={() => open(l)}
                      disabled={!l.ask_id && !l.item_id && !l.doc_id}
                    >
                      <strong>{l.title}</strong>
                      <small>{l.detail}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {sections.some((section) => section.lines.length > 3) && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show all updates"}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

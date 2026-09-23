import { useEffect, useState } from "react";
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
  useEffect(() => {
    client.reentry().then(setBrief, () => setBrief(null));
  }, []);
  if (!brief) return null;
  const sections = SECTIONS.map((s) => ({
    ...s,
    lines: brief[s.key] as ReentryLine[],
  })).filter((s) => s.lines.length);
  const dismiss = () => {
    setBrief(null);
    void client.dismissReentry().catch(() => {});
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
            You were away {brief.days_away}{" "}
            {brief.days_away === 1 ? "day" : "days"}.
            {sections.length ? " Here's what happened." : " Nothing needs you."}
          </p>
        </div>
        <button className="secondary" onClick={dismiss}>
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
                {s.lines.slice(0, 3).map((l, n) => (
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
    </section>
  );
}

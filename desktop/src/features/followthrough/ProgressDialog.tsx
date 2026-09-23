import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, Copy, X } from "lucide-react";
import { dateLabel, type ProgressReport, type Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { Select } from "../../components/Select";
import { errorText } from "../../lib/planning";

/** Monday 00:00 of this week, or `back` weeks earlier. */
const mondayOf = (back: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - back * 7);
  return d;
};

/**
 * Proof of progress: what got done this week (or last), yours or a team's,
 * with the proof beside each — and one button to copy it as text for a
 * status update.
 */
export function ProgressDialog({ onClose }: { onClose: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [back, setBack] = useState(0);
  const [report, setReport] = useState<ProgressReport | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    client.listTeams().then(setTeams, () => setTeams([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    setReport(null);
    setError("");
    const from = mondayOf(back);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    client
      .progress(from, to, teamId || undefined)
      .then(setReport, (e) => setError(errorText(e)));
  }, [teamId, back]);
  const count = report?.people.reduce((n, p) => n + p.done.length, 0) ?? 0;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={root}
        className="modal progress-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-dialog-title"
      >
        <div className="section-heading">
          <h2 id="progress-dialog-title">
            <BadgeCheck size={18} aria-hidden="true" /> What got done
          </h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="progress-body">
          <div className="progress-controls">
            <div className="segmented" role="group" aria-label="Week">
              {["This week", "Last week"].map((label, n) => (
                <button
                  key={label}
                  aria-pressed={back === n}
                  className={back === n ? "active" : ""}
                  onClick={() => setBack(n)}
                >
                  {label}
                </button>
              ))}
            </div>
            {teams.length > 0 && (
              <Select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Just mine</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!report ? (
            !error && <p className="muted">Loading…</p>
          ) : count === 0 ? (
            <p className="muted">Nothing finished in these days yet.</p>
          ) : (
            report.people.map((p) => (
              <div key={p.user_id} className="progress-person">
                {teamId && <h3>{p.name}</h3>}
                <ul>
                  {p.done.map((t) => (
                    <li key={t.item_id}>
                      <Check size={14} aria-hidden="true" />
                      <span>
                        <strong>{t.title}</strong>
                        <small>
                          {dateLabel(t.done_at)}
                          {t.project ? ` · ${t.project}` : ""}
                        </small>
                        {t.proofs.length > 0 && (
                          <span className="progress-proofs">
                            {t.proofs.map((f, n) =>
                              f.url ? (
                                <a
                                  key={n}
                                  href={f.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {f.note || "Proof"}
                                </a>
                              ) : (
                                <em key={n}>{f.note}</em>
                              ),
                            )}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {report && count > 0 && (
            <div className="confirm-actions">
              <button
                className="secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(report.markdown)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                }
              >
                <Copy size={14} /> {copied ? "Copied" : "Copy as text"}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

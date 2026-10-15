import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, Copy, X } from "lucide-react";
import { dateLabel, type ProgressReport, type Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
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
  const focus = useModalFocus(onClose);
  const [retry, setRetry] = useState(0);
  const [teamsFailed, setTeamsFailed] = useState(false);
  const [teamsRetry, setTeamsRetry] = useState(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const node = focus.ref.current as HTMLDialogElement;
    node.showModal();
    return () => {
      node.close();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);
  useEffect(() => {
    let live = true;
    setTeamsFailed(false);
    client.listTeams().then(
      (list) => {
        if (live) setTeams(list);
      },
      () => {
        if (live) setTeamsFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [teamsRetry]);
  useEffect(() => {
    let live = true;
    setReport(null);
    setError("");
    setCopied(false);
    const from = mondayOf(back);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    client.progress(from, to, teamId || undefined).then(
      (value) => {
        if (live) setReport(value);
      },
      (error) => {
        if (live) setError(errorText(error));
      },
    );
    return () => {
      live = false;
    };
  }, [teamId, back, retry]);
  const count = report?.people.reduce((n, p) => n + p.done.length, 0) ?? 0;
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      data-modal-focus={focus.id}
      className="modal progress-dialog"
      aria-labelledby="progress-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
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
              aria-label="Progress scope"
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
        {teamsFailed && (
          <p role="alert">
            Teams couldn’t be loaded.{" "}
            <button
              className="text-button"
              onClick={() => setTeamsRetry((value) => value + 1)}
            >
              Retry teams
            </button>
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
            <button
              className="text-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </p>
        )}
        {!report ? (
          !error && <p className="muted">Loading…</p>
        ) : count === 0 ? (
          <p className="muted">No completed tasks for this period.</p>
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
                    if (copyTimer.current) clearTimeout(copyTimer.current);
                    copyTimer.current = setTimeout(
                      () => setCopied(false),
                      2000,
                    );
                  })
                  .catch((error) => setError(errorText(error)))
              }
            >
              <Copy size={14} /> {copied ? "Copied" : "Copy as text"}
            </button>
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

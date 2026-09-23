import { useEffect, useState } from "react";
import type { WorkRecord } from "@orbyn/core";
import { client } from "../../lib/api";
import { ExperimentEvidence } from "./ExperimentEvidence";
import "./plan-checks.css";
import { DateField } from "../../components/DateField";

/** A short trial log: what to change, what success means, and what happened. */
export function PlanExperiments() {
  const [rows, setRows] = useState<WorkRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [success, setSuccess] = useState("");
  const [review, setReview] = useState("");
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    client
      .listWorkRecords({ kind: "experiment", limit: 200 })
      .then((all) => setRows(all.filter((row) => row.team_id === null)));
  useEffect(() => {
    void load().catch((reason: Error) => setError(reason.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const active = rows?.filter((row) => row.status === "open") ?? [];
  const completed =
    rows?.filter((row) => row.status === "done").slice(0, 3) ?? [];
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (reason) {
      setError((reason as Error).message || "Could not save experiment.");
    } finally {
      setBusy(false);
    }
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await client.createWorkRecord({
        kind: "experiment",
        title: title.trim(),
        details: success.trim(),
        review_at: review ? new Date(`${review}T12:00:00`).toISOString() : null,
      });
      setTitle("");
      setSuccess("");
      setReview("");
      setAdding(false);
    });
  };
  return (
    <section className="plan-experiments" aria-label="Plan experiments">
      <button
        className="plan-experiments-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <strong>Plan experiments</strong>
        <span className="muted">
          {rows === null ? "Loading…" : `${active.length} in progress`}
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="plan-experiments-body">
          <p className="muted">
            Try one planning change, then check whether it helped.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!adding ? (
            <button className="secondary" onClick={() => setAdding(true)}>
              Start an experiment
            </button>
          ) : (
            <form className="plan-experiment-form" onSubmit={create}>
              <label>
                What will you try?
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={title}
                  placeholder="Keep mornings free for deep work"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label>
                What would success look like?
                <textarea
                  required
                  maxLength={4000}
                  value={success}
                  placeholder="Finish more priority work without extending my day"
                  onChange={(event) => setSuccess(event.target.value)}
                />
              </label>
              <label>
                Review on
                <DateField
                  type="date"
                  required
                  value={review}
                  onChange={(event) => setReview(event.target.value)}
                />
              </label>
              <div className="plan-experiment-actions">
                <button
                  className="primary"
                  disabled={busy || !title.trim() || !success.trim() || !review}
                >
                  Start
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {!active.length && !completed.length && (
            <p className="muted">No experiments yet.</p>
          )}
          {[...active, ...completed].map((record) => (
            <div className="plan-experiment-row" key={record.id}>
              <strong>{record.title}</strong>
              <small className="muted">
                {record.status === "done" ? "Completed" : "In progress"}
                {record.review_at &&
                  ` · Review ${new Date(record.review_at).toLocaleDateString([], { dateStyle: "medium" })}`}
              </small>
              <p>Success looks like: {record.details}</p>
              <ExperimentEvidence id={record.id} />
              {record.outcome && <p>What happened: {record.outcome}</p>}
              {record.status === "open" &&
                (outcomeFor === record.id ? (
                  <div className="plan-experiment-form">
                    <label>
                      What happened?
                      <textarea
                        value={outcome}
                        maxLength={4000}
                        onChange={(event) => setOutcome(event.target.value)}
                      />
                    </label>
                    <div className="plan-experiment-actions">
                      <button
                        className="primary"
                        disabled={busy || !outcome.trim()}
                        onClick={() =>
                          void act(async () => {
                            await client.updateWorkRecord(record.id, {
                              version: record.version,
                              outcome: outcome.trim(),
                              status: "done",
                            });
                            setOutcomeFor(null);
                            setOutcome("");
                          })
                        }
                      >
                        Finish experiment
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setOutcomeFor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => {
                      setOutcomeFor(record.id);
                      setOutcome(record.outcome);
                    }}
                  >
                    Record result
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
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
  const outcomeTarget = useRef<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const mutation = useRef(false);
  const mounted = useRef(true);
  const load = async () => {
    const version = ++requestVersion.current;
    try {
      const all = await client.listWorkRecords({
        kind: "experiment",
        limit: 200,
      });
      if (mounted.current && version === requestVersion.current)
        setRows(all.filter((row) => row.team_id === null));
    } catch (reason) {
      if (mounted.current && version === requestVersion.current)
        setError((reason as Error).message || "Could not load experiments.");
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);
  const active = rows?.filter((row) => row.status === "open") ?? [];
  const [showCompleted, setShowCompleted] = useState(false);
  const completed = rows?.filter((row) => row.status === "done") ?? [];
  const act = async (action: () => Promise<unknown>) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (reason) {
      setError((reason as Error).message || "Could not save experiment.");
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
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
        disabled={busy}
        onClick={() => setOpen(!open)}
      >
        <strong>Plan experiments</strong>
        <span className="muted">
          {rows === null
            ? error
              ? "Unavailable"
              : "Loading…"
            : `${active.length} in progress`}
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="plan-experiments-body">
          {error && !adding && outcomeFor === null && (
            <p className="error" role="alert">
              {error}
              {rows === null && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setError("");
                    void load().catch((reason: Error) =>
                      setError(reason.message),
                    );
                  }}
                >
                  Retry
                </button>
              )}
            </p>
          )}
          {!adding ? (
            <button
              className="secondary"
              disabled={busy || outcomeFor !== null}
              onClick={() => setAdding(true)}
            >
              New experiment
            </button>
          ) : (
            <ExperimentDialog
              title="New experiment"
              error={error}
              busy={busy}
              onClose={() => setAdding(false)}
            >
              <form
                className="plan-experiment-form"
                onSubmit={create}
                aria-busy={busy}
              >
                <fieldset disabled={busy} className="experiment-fields">
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
                    Success criteria
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
                      disabled={busy}
                      required
                      value={review}
                      onChange={(event) => setReview(event.target.value)}
                    />
                  </label>
                  <div className="plan-experiment-actions">
                    <button
                      className="primary"
                      disabled={
                        busy || !title.trim() || !success.trim() || !review
                      }
                    >
                      Start
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() => setAdding(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </fieldset>
              </form>
            </ExperimentDialog>
          )}
          {rows !== null && !active.length && !completed.length && (
            <p className="muted">No experiments yet.</p>
          )}
          {[
            ...active,
            ...(showCompleted ? completed : completed.slice(0, 3)),
          ].map((record) => (
            <div className="plan-experiment-row" key={record.id}>
              <strong>{record.title}</strong>
              <small className="muted">
                {record.status === "done" ? "Completed" : "In progress"}
                {record.review_at &&
                  ` · Review ${new Date(record.review_at).toLocaleDateString([], { dateStyle: "medium" })}`}
              </small>
              <details className="experiment-details">
                <summary>Experiment details</summary>
                <p>
                  <strong>Success criteria</strong>
                  <br />
                  {record.details}
                </p>
                <ExperimentEvidence id={record.id} />
                {record.outcome && (
                  <p>
                    <strong>Result</strong>
                    <br />
                    {record.outcome}
                  </p>
                )}
              </details>
              {record.status === "open" &&
                (outcomeFor === record.id ? (
                  <ExperimentDialog
                    title="Record result"
                    error={error}
                    busy={busy}
                    onClose={() => setOutcomeFor(null)}
                  >
                    <div className="plan-experiment-form" aria-busy={busy}>
                      <p>{record.title}</p>
                      <label>
                        What happened?
                        <textarea
                          value={outcome}
                          disabled={busy}
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
                              outcomeTarget.current = null;
                              setOutcome("");
                            })
                          }
                        >
                          Finish experiment
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => setOutcomeFor(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </ExperimentDialog>
                ) : (
                  <button
                    className="text-button"
                    disabled={busy || adding || outcomeFor !== null}
                    onClick={() => {
                      setOutcomeFor(record.id);
                      if (outcomeTarget.current !== record.id)
                        setOutcome(record.outcome);
                      outcomeTarget.current = record.id;
                    }}
                  >
                    Record result
                  </button>
                ))}
            </div>
          ))}
          {completed.length > 3 && (
            <button
              className="text-button"
              onClick={() => setShowCompleted((value) => !value)}
            >
              {showCompleted
                ? "Show fewer completed"
                : `Show all ${completed.length} completed`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ExperimentDialog({
  title,
  error,
  busy,
  onClose,
  children,
}: {
  title: string;
  error: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const node = focus.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      className="modal experiment-dialog"
      data-modal-focus={focus.id}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2>{title}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>,
    document.body,
  );
}

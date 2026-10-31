import {
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  routineRetryPolicy,
  type RoutineRecovery,
  type RoutineRetryPolicy,
  type RoutineRetryPolicyPage,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { Button, ErrorNotice, Field, Input, useConfirm } from "../../../ui/kit";
import { useOwned } from "../hooks";
import { Check } from "../parts";
import { unavailable, uuid } from "../words";

/** Bounded retries for one routine. Off by default, and they grant nothing new. */
export function RetryPolicyEditor({
  routineId,
  disabled,
}: {
  routineId: string;
  disabled: boolean;
}) {
  const owned = useOwned();
  const ticket = useRef(0);
  const lock = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const [page, setPage] = useState<RoutineRetryPolicyPage | null>(null);
  const [draft, setDraft] = useState<RoutineRetryPolicy | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    if (lock.current || !owned()) return;
    lock.current = true;
    const mine = ++ticket.current;
    setBusy(true);
    setError("");
    try {
      const value = await client.routineRetryPolicy(routineId);
      if (owned() && mine === ticket.current) {
        setPage(value);
        setDraft((old) => old ?? value.policy);
      }
    } catch {
      if (owned() && mine === ticket.current) {
        setPage(null);
        setError("Couldn't load recovery settings. Try again.");
      }
    } finally {
      if (mine === ticket.current) {
        lock.current = false;
        if (owned()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    !!page && !!draft && JSON.stringify(page.policy) !== JSON.stringify(draft);
  const save = async () => {
    if (!page || !draft || !dirty || disabled || lock.current || !owned())
      return;
    const checked = routineRetryPolicy.safeParse(draft);
    if (!checked.success) {
      setError(
        checked.error.issues[0]?.message ?? "Check the recovery limits.",
      );
      return;
    }
    const body = { expected_revision: page.revision, policy: checked.data };
    const key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: uuid() };
    lock.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const value = await client.updateRoutineRetryPolicy(routineId, {
        ...body,
        request_id: request.current.id,
      });
      if (owned()) {
        setPage(value);
        setDraft(value.policy);
        setSaved(true);
      }
    } catch (failure) {
      if (owned()) {
        if (unavailable(failure)) setPage(null);
        setError(messageOf(failure, "Couldn't save recovery settings."));
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const number = (
    name: keyof Omit<RoutineRetryPolicy, "enabled">,
    label: string,
  ) => (
    <Field key={name} label={label}>
      <Input
        type="number"
        value={String(draft?.[name] ?? "")}
        disabled={busy || disabled}
        onChange={(event) => {
          setSaved(false);
          setDraft((old) =>
            old ? { ...old, [name]: Number(event.target.value) } : old,
          );
        }}
      />
    </Field>
  );
  return (
    <section className="agents-policy" aria-label="Recovery settings">
      <h3>Recovery settings</h3>
      <p className="muted small">
        Retries are off by default. Only qualified failures with no effects can
        retry within these limits. New permissions are never granted.
      </p>
      {disabled && (
        <p className="small">
          Save routine changes before editing recovery settings.
        </p>
      )}
      {error && (
        <ErrorNotice
          message={error}
          onRetry={!page ? () => void load() : undefined}
        />
      )}
      {page && draft && (
        <>
          <Check
            label="Retry safe failures"
            checked={draft.enabled}
            disabled={busy || disabled}
            onChange={() => {
              setSaved(false);
              setDraft({ ...draft, enabled: !draft.enabled });
            }}
          />
          {draft.enabled && (
            <div className="agents-pair">
              {number(
                "max_attempts",
                "Total attempts per occurrence (1–5, including the first)",
              )}
              {number("token_limit", "Total token allowance (up to 1,000,000)")}
              {number(
                "max_elapsed_minutes",
                "Elapsed time limit in minutes (1–1,440)",
              )}
              {number("backoff_seconds", "Retry delay in seconds (5–3,600)")}
            </div>
          )}
          <p className="muted small">
            Changing this policy holds earlier recovery-enabled occurrences for
            review. Pausing the routine prevents new retry admissions; admitted
            work may finish.
          </p>
          <div className="agents-buttons">
            <Button
              disabled={busy || disabled || !dirty}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save recovery settings"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void load()}>
              Reload saved recovery settings
            </Button>
            {saved && (
              <span className="agents-done small" role="status">
                Recovery settings saved.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const STATES = {
  active: "Work in progress",
  waiting: "Waiting for you",
  retry_scheduled: "Retry scheduled",
  held: "Held for review",
  limited: "Recovery limit reached",
  completed: "Run finished · Review outcome",
  stopped: "Occurrence stopped",
};

/** Every bounded attempt of one scheduled occurrence. */
export function OccurrenceRecovery({
  routineId,
  occurrenceId,
  disabled,
  onOpenChat,
}: {
  routineId: string;
  occurrenceId: string;
  disabled: boolean;
  onOpenChat?: (id: string) => void;
}) {
  const confirm = useConfirm();
  const owned = useOwned();
  const ticket = useRef(0);
  const lock = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const [data, setData] = useState<RoutineRecovery | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [requested, setRequested] = useState(false);

  const load = async () => {
    if (lock.current || !owned()) return;
    lock.current = true;
    const mine = ++ticket.current;
    setBusy(true);
    setError("");
    try {
      const value = await client.routineRecovery(routineId, occurrenceId);
      if (owned() && mine === ticket.current) {
        setData(value);
        if (
          value.recovery === "enabled" &&
          value.visibility === "available" &&
          !value.attempts.some((attempt) =>
            ["queued", "running", "waiting"].includes(attempt.state),
          )
        )
          setRequested(false);
        setStale(false);
      }
    } catch (failure) {
      if (owned() && mine === ticket.current) {
        if (unavailable(failure)) setData(null);
        setError("Couldn't refresh this occurrence. Try again.");
        setStale(true);
      }
    } finally {
      if (mine === ticket.current) {
        lock.current = false;
        if (owned()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live =
    data?.recovery === "enabled" &&
    data.visibility === "available" &&
    data.attempts.some((attempt) =>
      ["queued", "running", "waiting"].includes(attempt.state),
    );
  const openState = data?.recovery === "enabled" ? data.state : null;
  useEffect(() => {
    if (
      !openState ||
      error ||
      (!["active", "waiting", "retry_scheduled"].includes(openState) &&
        !live &&
        !requested)
    )
      return;
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openState, live, requested, error]);

  const stop = async () => {
    if (
      !data ||
      data.recovery !== "enabled" ||
      disabled ||
      stale ||
      lock.current ||
      !owned()
    )
      return;
    lock.current = true;
    const yes = await confirm({
      title: "Stop this occurrence?",
      body: "Requests cancellation of current work and prevents further retries for this occurrence. Existing changes remain.",
      action: "Stop occurrence",
      danger: true,
    });
    lock.current = false;
    if (!yes || !owned()) return;
    const body = {
      expected_revision: data.revision,
      generation: data.generation,
    };
    const key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: uuid() };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await client.stopRoutineRecovery(routineId, occurrenceId, {
        ...body,
        request_id: request.current.id,
      });
      if (owned()) {
        setData(value);
        setRequested(true);
        setStale(false);
      }
    } catch (failure) {
      if (owned()) {
        if (unavailable(failure)) setData(null);
        setError(messageOf(failure, "Couldn't stop this occurrence."));
        setStale(true);
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };

  return (
    <div className="agents-stack">
      {error && <ErrorNotice message={error} />}
      <div className="agents-buttons">
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          {busy ? "Refreshing…" : "Refresh occurrence"}
        </Button>
      </div>
      {data?.recovery === "legacy" && (
        <p className="small">
          Bounded retries were not enabled for this occurrence. Its existing
          result remains in run history.
        </p>
      )}
      {data?.recovery === "enabled" && (
        <>
          <strong>{STATES[data.state]}</strong>
          <p className="small" dir="auto">
            {data.reason}
          </p>
          <p className="muted small">
            {data.attempt_count} / {data.policy.max_attempts} attempts ·{" "}
            {data.consumed_tokens} tokens used · {data.reserved_tokens} reserved
            · Recovery deadline {new Date(data.deadline).toLocaleString()}
          </p>
          {data.state === "retry_scheduled" && data.next_retry_at && (
            <p className="small">
              Next retry: {new Date(data.next_retry_at).toLocaleString()}
            </p>
          )}
          {requested && (live || data.visibility === "restricted") && (
            <p className="small">
              Stop requested. The final state of running work is not yet
              confirmed.
            </p>
          )}
          {data.visibility === "restricted" ? (
            <p className="small">
              Result details aren't available.
              {!["completed", "stopped"].includes(data.state) &&
                " You can still stop this occurrence."}
            </p>
          ) : (
            <ol className="agents-attempts">
              {data.attempts.map((attempt) => (
                <li key={attempt.id}>
                  <strong className="small">
                    Attempt {attempt.ordinal} ·{" "}
                    {(attempt.state === "done" || attempt.state === "failed") &&
                    attempt.visibility === "available" &&
                    attempt.execution_outcome
                      ? ASSISTANT_OUTCOME_LABELS[
                          attempt.execution_outcome.outcome
                        ]
                      : attempt.state === "done"
                        ? "Run finished"
                        : attempt.state === "failed"
                          ? "Run failed"
                          : attempt.state === "waiting"
                            ? "Waiting for you"
                            : attempt.state === "running"
                              ? "Running"
                              : attempt.state === "queued"
                                ? "Queued"
                                : "Result unavailable"}
                  </strong>
                  <p className="muted small">
                    {new Date(attempt.created_at).toLocaleString()} ·{" "}
                    {attempt.resume_count} recovery resumes ·{" "}
                    {attempt.settled_tokens === null
                      ? "Usage pending"
                      : `${attempt.settled_tokens} tokens charged`}
                  </p>
                  <p className="muted small">
                    {attempt.retry === "eligible"
                      ? "Failure qualified for bounded retry"
                      : attempt.retry === "reconcile"
                        ? "Reconciliation required"
                        : attempt.retry === "unavailable"
                          ? "Retry evidence unavailable"
                          : "No automatic retry"}
                  </p>
                  {attempt.visibility === "restricted" ? (
                    <p className="small">Result no longer available</p>
                  ) : (
                    <>
                      {!!attempt.summary && (
                        <p className="small" dir="auto">
                          {attempt.summary}
                        </p>
                      )}
                      {attempt.execution_outcome &&
                        assistantOutcomeDetails(attempt.execution_outcome).map(
                          (line, index) => (
                            <p key={index} className="small" dir="auto">
                              {line}
                            </p>
                          ),
                        )}
                      {onOpenChat && (
                        <Button
                          variant="ghost"
                          disabled={busy || disabled || stale}
                          onClick={() =>
                            owned() && !stale && onOpenChat(attempt.chat_id)
                          }
                        >
                          {attempt.state === "waiting"
                            ? "Open decision"
                            : "Open attempt"}
                        </Button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="muted small">
            Stop affects only this occurrence and its retries. It does not pause
            the routine or undo existing changes.
          </p>
          <div className="agents-buttons">
            <Button
              variant="danger"
              disabled={
                busy ||
                disabled ||
                stale ||
                ["completed", "stopped"].includes(data.state)
              }
              onClick={() => void stop()}
            >
              Stop this occurrence
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

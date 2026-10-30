import { RoutineQuietChecks } from "./RoutineQuietCheck";
import { RoutineOccurrenceDetails } from "./RoutineRecovery";
import { useEffect, useRef, useState } from "react";
import {
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  type AssistantRoutineRun,
  type AssistantRoutineRunsPage,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import "./routine-run-history.css";

const binding = () => {
  const value = session.binding();
  return `${value.generation}:${value.token}`;
};

type Props = {
  routineId: string;
  timezone: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpenChat?: (id: string) => void;
};
export function RoutineRunHistory({ open, onToggle, ...props }: Props) {
  return (
    <div className="routine-run-history">
      <button
        className="text-button"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={onToggle}
      >
        {open ? "Hide run history" : "Run history"}
      </button>
      {open && (
        <HistoryBody key={`${binding()}:${props.routineId}`} {...props} />
      )}
    </div>
  );
}
function HistoryBody({
  routineId,
  timezone,
  disabled,
  onOpenChat,
}: Omit<Props, "open" | "onToggle">) {
  const owner = useRef(binding()).current;
  const mounted = useRef(true);
  const sequence = useRef(0);
  const pending = useRef<number | null>(null);
  const failedPage = useRef<{ cursor?: string; append: boolean }>({
    append: false,
  });
  const [rows, setRows] = useState<AssistantRoutineRun[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const current = () => mounted.current && binding() === owner;
  const load = async (next?: string, append = false) => {
    if (!current() || pending.current !== null) return;
    const ticket = ++sequence.current;
    pending.current = ticket;
    failedPage.current = { cursor: next, append };
    setLoading(true);
    setFailed(false);
    if (!append) {
      setRows(null);
      setCursor(null);
    }
    try {
      const page: AssistantRoutineRunsPage = await client.listAgentRoutineRuns(
        routineId,
        { limit: 10, ...(next ? { cursor: next } : {}) },
      );
      if (!current() || ticket !== sequence.current) return;
      setRows((previous) => [
        ...new Map(
          [...(append ? (previous ?? []) : []), ...page.runs].map((row) => [
            row.id,
            row,
          ]),
        ).values(),
      ]);
      setCursor(page.next_cursor);
    } catch {
      if (current() && ticket === sequence.current) setFailed(true);
    } finally {
      if (pending.current === ticket) pending.current = null;
      if (current() && ticket === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      sequence.current++;
      pending.current = null;
    };
  }, []);
  const when = (value: string) =>
    new Date(value).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    });
  return (
    <div className="routine-history-content" aria-label="Routine run history">
      <div className="routine-history-actions">
        <span className="muted">Scheduled time · {timezone}</span>
        <button
          className="text-button"
          disabled={loading || disabled}
          onClick={() => void load()}
        >
          Refresh history
        </button>
      </div>
      {failed && (
        <div role="alert">
          <p>Couldn’t load run history. Try again.</p>
          <button
            className="text-button"
            disabled={loading || disabled}
            onClick={() =>
              void load(failedPage.current.cursor, failedPage.current.append)
            }
          >
            Retry history
          </button>
        </div>
      )}
      {loading && <p role="status">Loading run history…</p>}
      {rows?.length === 0 && !failed && (
        <p className="muted">No retained runs for this routine.</p>
      )}
      {rows && (
        <ol>
          {rows.map((run) => (
            <li key={run.id}>
              <strong>{when(run.scheduled_for)}</strong>
              <p>
                {(run.state === "done" || run.state === "failed") &&
                run.visibility === "available" &&
                run.execution_outcome
                  ? ASSISTANT_OUTCOME_LABELS[run.execution_outcome.outcome]
                  : run.state === "done"
                    ? "Run finished · Outcome not verified"
                    : run.state === "waiting"
                      ? "Waiting for you"
                      : run.state === "failed"
                        ? "Run failed"
                        : run.state === "queued"
                          ? "Queued"
                          : "Running"}
              </p>
              {run.resume_count > 0 && (
                <small>
                  {run.resume_count} recovery{" "}
                  {run.resume_count === 1 ? "resume" : "resumes"}
                </small>
              )}
              <small>Observed {when(run.last_observed_at)}</small>
              <RoutineOccurrenceDetails
                routineId={routineId}
                occurrenceId={run.id}
                disabled={disabled}
                onOpenChat={onOpenChat}
              />
              <RoutineQuietChecks
                routineId={routineId}
                occurrenceId={run.id}
                disabled={disabled}
                onOpenChat={onOpenChat}
              />
              {run.visibility === "restricted" ? (
                <p className="muted">Result no longer available</p>
              ) : (
                <>
                  {!!run.summary && (
                    <details className="routine-result-preview">
                      <summary>Result preview</summary>
                      <p>{run.summary}</p>
                    </details>
                  )}
                  {run.execution_outcome && (
                    <details>
                      <summary>Evidence &amp; open questions</summary>
                      <ul>
                        {assistantOutcomeDetails(run.execution_outcome).map(
                          (line, index) => (
                            <li key={index}>{line}</li>
                          ),
                        )}
                      </ul>
                    </details>
                  )}
                  {onOpenChat && (
                    <button
                      className="text-button"
                      disabled={disabled}
                      onClick={() => {
                        if (current() && !disabled) onOpenChat(run.chat_id);
                      }}
                    >
                      Open result
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {cursor && !failed && (
        <button
          className="text-button"
          disabled={loading || disabled}
          onClick={() => void load(cursor, true)}
        >
          Load 10 older runs
        </button>
      )}
    </div>
  );
}

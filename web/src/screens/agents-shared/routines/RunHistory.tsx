import {
  ASSISTANT_OUTCOME_LABELS,
  type AssistantRoutineRun,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client } from "../../../lib/session";
import { Button, ErrorNotice } from "../../../ui/kit";
import { useOwned } from "../hooks";
import { Evidence, More } from "../parts";
import { when } from "../words";
import { OccurrenceQuietChecks } from "./QuietChecks";
import { OccurrenceRecovery } from "./Recovery";

const stateWords = (run: AssistantRoutineRun) =>
  (run.state === "done" || run.state === "failed") &&
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
            : "Running";

/** Lazy history for one routine. Reading it reruns nothing. */
export function RunHistory({
  routineId,
  timezone,
  disabled,
  onOpenChat,
}: {
  routineId: string;
  timezone: string;
  disabled: boolean;
  onOpenChat?: (id: string) => void;
}) {
  const owned = useOwned();
  const ticket = useRef(0);
  const pending = useRef<number | null>(null);
  const failedPage = useRef<{ cursor?: string; append: boolean }>({
    append: false,
  });
  const [rows, setRows] = useState<AssistantRoutineRun[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = async (next?: string, append = false) => {
    if (!owned() || pending.current !== null) return;
    const mine = ++ticket.current;
    pending.current = mine;
    failedPage.current = { cursor: next, append };
    setLoading(true);
    setFailed(false);
    if (!append) {
      setRows(null);
      setCursor(null);
    }
    try {
      const page = await client.listAgentRoutineRuns(routineId, {
        limit: 10,
        ...(next ? { cursor: next } : {}),
      });
      if (!owned() || mine !== ticket.current) return;
      setRows((old) => [
        ...new Map(
          [...(append ? (old ?? []) : []), ...page.runs].map((row) => [
            row.id,
            row,
          ]),
        ).values(),
      ]);
      setCursor(page.next_cursor);
    } catch {
      if (owned() && mine === ticket.current) setFailed(true);
    } finally {
      if (pending.current === mine) pending.current = null;
      if (owned() && mine === ticket.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      ticket.current++;
      pending.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="agents-history" aria-label="Routine run history">
      <div className="agents-buttons">
        <span className="muted small">Scheduled time · {timezone}</span>
        <Button
          variant="ghost"
          disabled={loading || disabled}
          onClick={() => void load()}
        >
          Refresh history
        </Button>
      </div>
      {failed && (
        <ErrorNotice
          message="Couldn't load run history."
          onRetry={() =>
            void load(failedPage.current.cursor, failedPage.current.append)
          }
        />
      )}
      {loading && (
        <p className="muted small" role="status">
          Loading run history…
        </p>
      )}
      {rows?.length === 0 && !failed && (
        <p className="muted small">No retained runs for this routine.</p>
      )}
      {rows && (
        <ol>
          {rows.map((run) => (
            <li key={run.id}>
              <strong className="small">
                {when(run.scheduled_for, timezone)}
              </strong>
              <p className="small">{stateWords(run)}</p>
              {run.resume_count > 0 && (
                <p className="muted small">
                  {run.resume_count} recovery{" "}
                  {run.resume_count === 1 ? "resume" : "resumes"}
                </p>
              )}
              <p className="muted small">
                Observed {when(run.last_observed_at, timezone)}
              </p>
              <More summary="Attempts & recovery">
                <OccurrenceRecovery
                  routineId={routineId}
                  occurrenceId={run.id}
                  disabled={disabled}
                  onOpenChat={onOpenChat}
                />
              </More>
              <More summary="Quiet-check evidence">
                <OccurrenceQuietChecks
                  routineId={routineId}
                  occurrenceId={run.id}
                  disabled={disabled}
                  onOpenChat={onOpenChat}
                />
              </More>
              {run.visibility === "restricted" ? (
                <p className="muted small">Result no longer available</p>
              ) : (
                <>
                  {!!run.summary && (
                    <More summary="Result preview">
                      <p className="small agents-prewrap" dir="auto">
                        {run.summary}
                      </p>
                    </More>
                  )}
                  {run.execution_outcome && (
                    <Evidence receipt={run.execution_outcome} />
                  )}
                  {onOpenChat && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => {
                        if (owned() && !disabled) onOpenChat(run.chat_id);
                      }}
                    >
                      Open result
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {cursor && !failed && (
        <Button
          variant="ghost"
          disabled={loading || disabled}
          onClick={() => void load(cursor, true)}
        >
          Load 10 older runs
        </Button>
      )}
    </div>
  );
}

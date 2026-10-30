import { LaneWorkControls } from "./LaneWorkControls";
import { onSessionChange, session } from "../../lib/session";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  type OvernightNight,
  type OvernightRun,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { useConfirm } from "../../components/Confirm";
import "./overnight.css";

/** Bookkeeping status alone does not establish any proposed or applied changes. */
const hasChangeEvidence = (run: OvernightRun) =>
  !run.restricted &&
  run.kind !== "reflection" &&
  !!(run.proposal || run.steps.length || run.changes.length);

type Props = {
  nightId?: string;
  report: (error: unknown) => void;
  onOpenChat: (id: string) => void;
  onOpenReview: (id: string) => void;
  onOpen: (kind: "task" | "doc" | "project", id: string) => void;
};
/** Saved night work, with live Review choices and the existing change Undo. */
const sessionKey = () => {
  const value = session.binding();
  return `${value.generation}:${value.token}`;
};
export function OvernightView(props: Props) {
  const owner = useSyncExternalStore(onSessionChange, sessionKey);
  return (
    <OvernightSession
      key={`${owner}:${props.nightId ?? "latest"}`}
      {...props}
    />
  );
}
function OvernightSession(props: Props) {
  const owner = useRef(sessionKey()).current;
  const mounted = useRef(true);
  const request = useRef(0);
  const operation = useRef(false);
  const owns = () => mounted.current && sessionKey() === owner;
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [stale, setStale] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(10);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  const [night, setNight] = useState<OvernightNight | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const { ask } = useConfirm();
  const load = async () => {
    const ticket = ++request.current;
    try {
      const value = await client.latestAssistantNight(props.nightId);
      if (!owns() || ticket !== request.current) return;
      setNight(value);
      setLoaded(true);
      setLoadError("");
      setStale(false);
    } catch (error) {
      if (owns() && ticket === request.current) {
        setLoaded(true);
        setLoadError(
          "Couldn’t refresh Overnight. Retry before changing this snapshot.",
        );
      }
      throw error;
    }
  };
  useEffect(() => {
    let alive = true;
    let pending: Promise<void> | null = null;
    let scheduled: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (!alive || !owns() || operation.current || document.hidden) return;
      if (pending) return pending;
      pending = load()
        .catch(() => undefined)
        .finally(() => {
          pending = null;
        });
      return pending;
    };
    void refresh();
    const stop = onLive((event) => {
      if (event.kind === "changed") {
        clearTimeout(scheduled);
        scheduled = setTimeout(() => void refresh(), 250);
      }
    });
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      request.current++;
      clearTimeout(scheduled);
      stop();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [props.nightId, retry]);
  const act = async (work: () => Promise<unknown>) => {
    if (!owns() || operation.current || stale || loadError) return;
    operation.current = true;
    request.current++;
    setBusy(true);
    try {
      await work();
      if (!owns()) return;
      setStale(true);
      try {
        await load();
      } catch {
        if (owns())
          setLoadError(
            "Action saved. Couldn’t refresh Overnight. Retry before making another change.",
          );
      }
    } catch (error) {
      if (owns()) props.report(error);
    } finally {
      operation.current = false;
      if (owns()) setBusy(false);
    }
  };
  const locked = busy || stale || !!loadError;
  const bulk = async (action: "keep" | "undo") => {
    if (
      !night ||
      !(await ask({
        title:
          action === "keep" ? "Keep finished runs?" : "Undo finished runs?",
        body:
          action === "keep"
            ? "Keeps results and applies any held changes. Active runs stay open."
            : "Held changes will be declined and applied changes will be undone where they can still be restored. Runs still working will stay open.",
        confirmLabel: action === "keep" ? "Keep all" : "Undo all",
        destructive: action === "undo",
      }))
    )
      return;
    await act(() =>
      client.reviewAssistantNight(
        night.id,
        action,
        night.runs
          .filter(
            (run) =>
              run.kind !== "reflection" &&
              !run.restricted &&
              (action === "undo"
                ? run.state === "done" || run.state === "failed"
                : run.state === "done" && run.status !== "undone"),
          )
          .map((run) => ({ id: run.id, token: run.decision_token })),
      ),
    );
  };
  const stopPage = async (docId: string, runId: string) => {
    if (
      locked ||
      !owns() ||
      !(await ask({
        title: "Stop this page run?",
        body: "Stops this run and discards its unapplied proposal. The routine schedule and changes already saved are kept.",
        confirmLabel: "Stop run",
        destructive: true,
      }))
    )
      return;
    await act(() => client.stopPageMaintenanceRun(docId, runId));
  };
  if (!loaded) return <p role="status">Loading your night…</p>;
  if (!night && loadError)
    return (
      <section className="overnight">
        <h2>Overnight</h2>
        <p role="alert">{loadError}</p>
        <button
          className="secondary"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry Overnight
        </button>
      </section>
    );
  if (!night)
    return (
      <section className="overnight">
        <h2>No night work yet</h2>
        <p>Enable night shift in Settings or send a task to Tonight.</p>
        <LaneWorkControls lane="overnight" />
      </section>
    );
  const reviewRuns = night.runs.filter(
    (run) =>
      run.status !== "undone" &&
      (run.state === "waiting" ||
        run.state === "failed" ||
        !!run.question ||
        !!run.approval ||
        run.proposal?.status === "pending" ||
        (run.execution_outcome &&
          ["partial", "waiting", "failed", "interrupted", "uncertain"].includes(
            run.execution_outcome.outcome,
          ))),
  );
  const activeRuns = night.runs.filter(
    (run) =>
      !reviewRuns.includes(run) && ["queued", "running"].includes(run.state),
  );
  const historyRuns = night.runs.filter(
    (run) => !reviewRuns.includes(run) && !activeRuns.includes(run),
  );
  const currentPages = (night.page_runs ?? []).filter(
    (run) => run.state !== "done" && run.state !== "cancelled",
  );
  const historyPages = (night.page_runs ?? []).filter(
    (run) => run.state === "done" || run.state === "cancelled",
  );
  const historicalCount = historyRuns.length + historyPages.length;
  const renderRun = (run: OvernightRun) => (
    <RunCard key={run.id} run={run} busy={locked} act={act} {...props} />
  );
  return (
    <section className="overnight">
      {loadError && (
        <div>
          <p role="alert">{loadError}</p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry Overnight
          </button>
        </div>
      )}
      <header className="overnight-head">
        <div>
          <h2>Overnight review</h2>
          <p>
            {night.local_day} · {reviewRuns.length} to review ·{" "}
            {activeRuns.length} active
          </p>
          <p>{night.status === "running" ? "In progress" : "Night summary"}</p>
        </div>
        <div className="overnight-actions">
          {night.runs.some(
            (run) =>
              hasChangeEvidence(run) &&
              ["done", "failed"].includes(run.state) &&
              run.status !== "undone",
          ) && (
            <details>
              <summary>Review finished runs</summary>
              <div className="overnight-actions">
                <button
                  className="secondary"
                  disabled={
                    locked ||
                    !night.runs.some(
                      (run) =>
                        hasChangeEvidence(run) &&
                        !run.restricted &&
                        run.state === "done" &&
                        run.status !== "undone",
                    )
                  }
                  onClick={() => void bulk("keep")}
                >
                  Keep all
                </button>
                <button
                  className="secondary"
                  disabled={
                    locked ||
                    !night.runs.some(
                      (run) =>
                        hasChangeEvidence(run) &&
                        !run.restricted &&
                        ["done", "failed"].includes(run.state) &&
                        run.status !== "undone",
                    )
                  }
                  onClick={() => void bulk("undo")}
                >
                  Undo all
                </button>
              </div>
            </details>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setRetry((value) => value + 1)}
          >
            Refresh
          </button>
        </div>
      </header>
      <LaneWorkControls lane="overnight" />
      {reviewRuns.length > 0 && (
        <section className="overnight-run-group" aria-label="Review first">
          <h3>Review first</h3>
          {reviewRuns.map(renderRun)}
        </section>
      )}
      {currentPages.map((run) => (
        <section key={run.id} className="overnight-card">
          <h3>
            Page update ·{" "}
            {run.state === "waiting"
              ? "Waiting for review"
              : run.state === "failed"
                ? "Run failed"
                : run.state === "queued"
                  ? "Queued"
                  : "Running"}
          </h3>
          <button
            className="secondary"
            onClick={() => props.onOpen("doc", run.doc_id)}
          >
            {run.state === "waiting" ? "Review in page" : "Open page"}
          </button>
          {["queued", "running", "waiting"].includes(run.state) && (
            <button
              className="text-button"
              disabled={locked}
              onClick={() => void stopPage(run.doc_id, run.id)}
            >
              Stop this page run
            </button>
          )}
        </section>
      ))}
      {activeRuns.length > 0 && (
        <section
          className="overnight-run-group"
          aria-label="Running and queued"
        >
          <h3>Running &amp; queued</h3>
          {activeRuns.map(renderRun)}
        </section>
      )}
      {historicalCount > 0 && (
        <details className="overnight-history">
          <summary>Finished run history · {historicalCount}</summary>
          <div className="overnight-run-group">
            {historyRuns.slice(0, historyLimit).map(renderRun)}
            {historyPages
              .slice(0, Math.max(0, historyLimit - historyRuns.length))
              .map((run) => (
                <section key={run.id} className="overnight-card">
                  <h3>
                    Page update ·{" "}
                    {run.state === "cancelled" ? "Cancelled" : "Run finished"}
                  </h3>
                  <button
                    className="secondary"
                    onClick={() => props.onOpen("doc", run.doc_id)}
                  >
                    Open page
                  </button>
                </section>
              ))}
            {historicalCount > historyLimit && (
              <button
                className="text-button"
                onClick={() => setHistoryLimit((value) => value + 10)}
              >
                Show 10 more results
              </button>
            )}
          </div>
        </details>
      )}
      {!!night.not_done.length && (
        <section className="overnight-card">
          <h3>Unfinished work</h3>
          <ul>
            {night.not_done.map((entry, index) => (
              <li key={index}>
                <strong>{entry.title}</strong>
                <p>{entry.reason.replace(/^Not done tonight:\s*/i, "")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
function RunCard({
  run,
  busy,
  act,
  onOpenChat,
  onOpenReview,
  onOpen,
}: Props & {
  run: OvernightRun;
  busy: boolean;
  act: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const { ask } = useConfirm();
  const [stopRequested, setStopRequested] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [answer, setAnswer] = useState("");
  useEffect(() => setAnswer(""), [run.question?.id]);
  const choices = run.steps.length
    ? run.steps.map((step) => ({ key: step.id, title: step.title }))
    : (run.proposal?.changes ?? []).map((change) => ({
        key: String(change.index),
        title: change.headline,
      }));
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(choices.map((choice) => choice.key)),
  );
  useEffect(() => {
    setChosen(new Set(choices.map((choice) => choice.key)));
  }, [run.proposal?.id, choices.map((choice) => choice.key).join("|")]);
  const pending = run.proposal?.status === "pending";
  const hasChanges = hasChangeEvidence(run);
  const done =
    run.kind !== "reflection" && !run.restricted && run.state === "done";
  const keepChange = async (key: string) => {
    if (
      choices.length > 1 &&
      !(await ask({
        title: "Keep this change?",
        body: "This approves only this change. The other held changes in this run will be left out.",
        confirmLabel: "Keep change",
      }))
    )
      return;
    await act(() =>
      client.keepAssistantNightRun(
        run.id,
        run.steps.length ? { steps: [key] } : { only: [Number(key)] },
      ),
    );
  };
  const keep = () =>
    act(() =>
      client.keepAssistantNightRun(
        run.id,
        pending && chosen.size < choices.length
          ? run.steps.length
            ? { steps: [...chosen] }
            : { only: [...chosen].map(Number) }
          : {},
      ),
    );
  return (
    <article className="overnight-card">
      <div className="overnight-head">
        <h3>{run.title}</h3>
        <span>
          {["queued", "running", "waiting"].includes(run.state) &&
          (run.cancel_requested || stopRequested)
            ? "Stop requested · Awaiting confirmation"
            : run.state === "queued"
              ? "Queued"
              : run.state === "running"
                ? "Running"
                : run.state === "waiting"
                  ? "Waiting for you"
                  : run.execution_outcome
                    ? ASSISTANT_OUTCOME_LABELS[run.execution_outcome.outcome]
                    : run.state === "failed"
                      ? "Run failed"
                      : "Run finished · Review outcome"}
        </span>
      </div>
      {hasChanges && (
        <p className="muted">
          Changes{" "}
          {run.status === "partly"
            ? "partly kept"
            : run.status === "pending"
              ? "pending review"
              : run.status === "undone"
                ? "undone"
                : "kept"}
        </p>
      )}

      <p
        className={
          "overnight-summary" +
          (!summaryExpanded && run.summary.length > 360 ? " is-collapsed" : "")
        }
      >
        {run.summary || "Open the work to inspect its current result."}
      </p>
      {run.summary.length > 360 && (
        <button
          className="text-button"
          aria-expanded={summaryExpanded}
          onClick={() => setSummaryExpanded((value) => !value)}
        >
          {summaryExpanded ? "Show less" : "Read full result"}
        </button>
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
      {!run.restricted &&
        ["queued", "running", "waiting"].includes(run.state) && (
          <button
            className="text-button"
            disabled={busy || run.cancel_requested || stopRequested}
            onClick={() =>
              void (async () => {
                if (
                  !(await ask({
                    title: "Stop this run?",
                    body: "Requests cancellation. Changes already applied remain available for review and undo.",
                    confirmLabel: "Stop run",
                  }))
                )
                  return;
                await act(async () => {
                  await client.stopAssistantRun(run.job_id);
                  setStopRequested(true);
                });
              })()
            }
          >
            {stopRequested || run.cancel_requested
              ? "Stop requested"
              : "Stop this run"}
          </button>
        )}
      {!!run.reflection_sources?.length && (
        <section aria-label="Reflection sources">
          <h4>Sources</h4>
          <div className="overnight-sources">
            {run.reflection_sources.map((source) => (
              <button
                className="secondary"
                key={source.number}
                onClick={() =>
                  source.kind === "chat"
                    ? onOpenChat(source.id)
                    : onOpen("task", source.id)
                }
              >
                {source.number}. {source.title}
              </button>
            ))}
          </div>
        </section>
      )}
      {run.approval && (
        <section aria-label="Approval from your assistant">
          <p>{run.approval.text}</p>
          {!!run.approval.summary && <p>{run.approval.summary}</p>}
          {!!run.approval.detail && (
            <p className="muted">{run.approval.detail}</p>
          )}
          <div className="overnight-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  client.approveAssistantRun(
                    run.job_id,
                    true,
                    run.approval!.id,
                  ),
                )
              }
            >
              Approve
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  client.approveAssistantRun(
                    run.job_id,
                    false,
                    run.approval!.id,
                  ),
                )
              }
            >
              Decline
            </button>
          </div>
        </section>
      )}
      {run.question && (
        <section aria-label="Question from your assistant">
          <p>{run.question.text}</p>
          <div className="overnight-actions">
            {run.question.choices.map((choice) => (
              <button
                type="button"
                className="secondary"
                key={choice}
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    client.answerAssistantRun(
                      run.job_id,
                      choice,
                      run.question!.id,
                    ),
                  )
                }
              >
                {choice}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && answer.trim())
                void act(async () => {
                  await client.answerAssistantRun(
                    run.job_id,
                    answer.trim(),
                    run.question!.id,
                  );
                  setAnswer("");
                });
            }}
          >
            <label className="settings-field">
              <span className="settings-label">Your answer</span>
              <input
                maxLength={4000}
                disabled={busy}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="primary"
              disabled={busy || !answer.trim()}
            >
              Answer
            </button>
          </form>
        </section>
      )}
      <div className="overnight-actions">
        {run.chat_id && (
          <button
            className="secondary"
            onClick={() => onOpenChat(run.chat_id!)}
          >
            Open work
          </button>
        )}
        {run.proposal && (
          <button
            className="secondary"
            onClick={() => onOpenReview(run.proposal!.id)}
          >
            Open Review
          </button>
        )}
        {hasChanges && (
          <>
            <button
              className="secondary"
              disabled={
                busy ||
                !done ||
                run.restricted ||
                run.status === "undone" ||
                (pending && !chosen.size)
              }
              onClick={() => void keep()}
            >
              {pending && chosen.size < choices.length
                ? "Keep selected"
                : "Keep"}
            </button>
            <button
              className="secondary"
              disabled={
                busy ||
                !["done", "failed"].includes(run.state) ||
                run.restricted ||
                run.status === "undone"
              }
              onClick={() =>
                void act(() => client.undoAssistantNightRun(run.id))
              }
            >
              Undo
            </button>
          </>
        )}
      </div>
      {hasChanges && !!(choices.length || run.changes.length) && (
        <details>
          <summary>
            Changes (
            {pending
              ? choices.length
              : run.changes.filter((change) => change.undo_until).length}
            )
          </summary>
          {pending &&
            choices.map((choice) => (
              <div className="overnight-choice" key={choice.key}>
                <label className="overnight-choice-label">
                  <input
                    type="checkbox"
                    checked={chosen.has(choice.key)}
                    disabled={busy}
                    onChange={() =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (next.has(choice.key)) next.delete(choice.key);
                        else next.add(choice.key);
                        return next;
                      })
                    }
                  />
                  {choice.title}
                </label>
                <button
                  className="secondary"
                  disabled={busy || !done}
                  onClick={() => void keepChange(choice.key)}
                >
                  Keep change
                </button>
              </div>
            ))}
          {run.changes
            .filter((change) => change.undo_until || change.links?.length)
            .map((change) => (
              <div className="overnight-change" key={change.id}>
                <p>
                  {change.summary}
                  {change.undone_at ? " · Undone" : ""}
                </p>
                <div className="overnight-actions">
                  {change.links?.map((link) => (
                    <button
                      className="secondary"
                      key={link.kind + link.id}
                      onClick={() => onOpen(link.kind, link.id)}
                    >
                      {link.title}
                    </button>
                  ))}
                  {change.undoable && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          client.undoAssistantNightRun(run.id, [change.id]),
                        )
                      }
                    >
                      Undo change
                    </button>
                  )}
                </div>
              </div>
            ))}
        </details>
      )}
    </article>
  );
}

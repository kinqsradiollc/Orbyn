import { useEffect, useState } from "react";
import type { OvernightNight, OvernightRun } from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { useConfirm } from "../../components/Confirm";
import "./overnight.css";

type Props = {
  nightId?: string;
  report: (error: unknown) => void;
  onOpenChat: (id: string) => void;
  onOpenReview: (id: string) => void;
  onOpen: (kind: "task" | "doc" | "project", id: string) => void;
};
/** Saved night work, with live Review choices and the existing change Undo. */
export function OvernightView(props: Props) {
  const [night, setNight] = useState<OvernightNight | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const { ask } = useConfirm();
  const load = async () => {
    setNight(await client.latestAssistantNight(props.nightId));
    setLoaded(true);
  };
  useEffect(() => {
    let alive = true;
    let pending: Promise<void> | null = null;
    let scheduled: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (pending) return pending;
      pending = client
        .latestAssistantNight(props.nightId)
        .then((next) => {
          if (alive) {
            setNight(next);
            setLoaded(true);
          }
        }, props.report)
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
    return () => {
      alive = false;
      clearTimeout(scheduled);
      stop();
      window.clearInterval(timer);
    };
  }, [props.nightId]);
  const act = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      await load();
    } catch (error) {
      props.report(error);
    } finally {
      setBusy(false);
    }
  };
  const bulk = async (action: "keep" | "undo") => {
    if (
      !night ||
      !(await ask({
        title:
          action === "keep"
            ? "Keep all finished night work?"
            : "Undo all finished night work?",
        body:
          action === "keep"
            ? "Held changes will be applied. Runs still working or waiting for your answer will stay open."
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
              !run.restricted &&
              (action === "undo"
                ? run.state === "done" || run.state === "failed"
                : run.state === "done" && run.status !== "undone"),
          )
          .map((run) => ({ id: run.id, token: run.decision_token })),
      ),
    );
  };
  if (!loaded) return <p role="status">Loading your night…</p>;
  if (!night)
    return (
      <section className="overnight">
        <h2>No night work yet</h2>
        <p>
          Turn on night shift in Assistant settings, or hand a task over for
          Tonight.
        </p>
      </section>
    );
  return (
    <section className="overnight">
      <header className="overnight-head">
        <div>
          <h2>{night.local_day}</h2>
          <p>
            {night.status === "running"
              ? "Your night is still in progress."
              : "Here is what happened overnight."}
          </p>
        </div>
        <div className="overnight-actions">
          <button
            className="secondary"
            disabled={
              busy ||
              !night.runs.some(
                (run) =>
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
              busy ||
              !night.runs.some(
                (run) =>
                  !run.restricted &&
                  ["done", "failed"].includes(run.state) &&
                  run.status !== "undone",
              )
            }
            onClick={() => void bulk("undo")}
          >
            Undo all
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void act(async () => {})}
          >
            Refresh
          </button>
        </div>
      </header>
      {night.runs.map((run) => (
        <RunCard key={run.id} run={run} busy={busy} act={act} {...props} />
      ))}
      {!!night.not_done.length && (
        <section className="overnight-card">
          <h3>Not done tonight</h3>
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
  const [answer, setAnswer] = useState("");
  useEffect(() => setAnswer(""), [run.question?.text]);
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
  }, [run.proposal?.id]);
  const pending = run.proposal?.status === "pending";
  const done = !run.restricted && run.state === "done";
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
          {run.state === "queued" || run.state === "running"
            ? "Working"
            : run.state === "waiting"
              ? "Needs you"
              : run.state === "failed"
                ? "Could not finish"
                : run.status === "partly"
                  ? "Partly kept"
                  : run.status === "pending"
                    ? "Pending"
                    : run.status === "undone"
                      ? "Undone"
                      : "Kept"}
        </span>
      </div>
      <p className="overnight-summary">
        {run.summary || "Open the chat to see its progress."}
      </p>
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
            Open chat
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
          {pending && chosen.size < choices.length ? "Keep selected" : "Keep"}
        </button>
        <button
          className="secondary"
          disabled={
            busy ||
            !["done", "failed"].includes(run.state) ||
            run.restricted ||
            run.status === "undone"
          }
          onClick={() => void act(() => client.undoAssistantNightRun(run.id))}
        >
          Undo
        </button>
      </div>
      {!!(choices.length || run.changes.length) && (
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

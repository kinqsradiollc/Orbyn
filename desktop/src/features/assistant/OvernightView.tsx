import { useEffect, useState } from "react";
import type { OvernightNight, OvernightRun } from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { useConfirm } from "../../components/Confirm";
import "./overnight.css";

type Props = {
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
    setNight(await client.latestAssistantNight());
    setLoaded(true);
  };
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      client.latestAssistantNight().then((next) => {
        if (alive) {
          setNight(next);
          setLoaded(true);
        }
      }, props.report);
    void refresh();
    const stop = onLive((event) => {
      if (event.kind === "changed") void refresh();
    });
    const timer = window.setInterval(refresh, 15000);
    return () => {
      alive = false;
      stop();
      window.clearInterval(timer);
    };
  }, []);
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
    await act(() => client.reviewAssistantNight(night.id, action));
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
            disabled={busy || !night.runs.length}
            onClick={() => void bulk("keep")}
          >
            Keep all
          </button>
          <button
            className="secondary"
            disabled={busy || !night.runs.length}
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
  const done = run.state === "done";
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
              <label className="overnight-choice" key={choice.key}>
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

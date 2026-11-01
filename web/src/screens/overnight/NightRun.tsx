import {
  HttpError,
  type OvernightNight,
  type OvernightRun,
  type AgentActivityLink,
} from "@orbyn/core";
import { useEffect, useState } from "react";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, Field, Pill, TextArea } from "../../ui/kit";
import { Handoff } from "../agents-shared/Handoff";
import { useOwned } from "../agents-shared/hooks";
import { Check, Evidence, More } from "../agents-shared/parts";
import { ReplyText } from "../agents-shared/ReplyText";
import { runWords } from "../agents-shared/words";
import { tasks } from "../shared-task";
import type { NightAction } from "./useNight";

export const hasChanges = (run: OvernightRun) =>
  !run.restricted &&
  run.kind !== "reflection" &&
  !!(run.proposal || run.steps.length || run.changes.length);
const receiptMatches = (run: OvernightRun) => (value: unknown) =>
  !!value &&
  typeof value === "object" &&
  "id" in value &&
  value.id === run.id &&
  "job_id" in value &&
  value.job_id === run.job_id;
const acceptedJob = (jobId: string) => (value: unknown) => {
  if (
    value &&
    typeof value === "object" &&
    "accepted" in value &&
    value.accepted === false
  )
    throw new HttpError(
      409,
      "This waiting decision was not accepted. Refresh its current question before trying again.",
    );
  return (
    !!value &&
    typeof value === "object" &&
    "accepted" in value &&
    value.accepted === true &&
    "job_id" in value &&
    value.job_id === jobId
  );
};
const stoppedRun = (value: unknown) => {
  if (
    value &&
    typeof value === "object" &&
    "stopped" in value &&
    value.stopped === false
  )
    throw new HttpError(
      409,
      "This run already ended. Refresh its saved result.",
    );
  return (
    !!value &&
    typeof value === "object" &&
    "stopped" in value &&
    value.stopped === true
  );
};
export function NightRun({
  run,
  nightId,
  locked,
  act: commit,
}: {
  run: OvernightRun;
  nightId: string;
  locked: boolean;
  act: (action: NightAction) => Promise<boolean>;
}) {
  const owned = useOwned();
  const act = (action: NightAction) =>
    commit({
      ...action,
      destination: run.chat_id
        ? `/app/assistant?chat=${encodeURIComponent(run.chat_id)}`
        : run.proposal
          ? `/app/review/${encodeURIComponent(run.proposal.id)}`
          : `/app/overnight/${encodeURIComponent(nightId)}`,
    });
  const [expanded, setExpanded] = useState(false),
    [stopRequested, setStopRequested] = useState(false);
  const choices = run.steps.length
    ? run.steps.map((step) => ({ id: step.id, title: step.title }))
    : (run.proposal?.changes ?? []).map((change) => ({
        id: String(change.index),
        title: change.headline,
      }));
  const choiceKey = JSON.stringify([run.proposal?.id, choices]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(choices.map((choice) => choice.id)),
  );
  const [undoSelected, setUndoSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set(choices.map((choice) => choice.id)));
  }, [choiceKey]);
  const pending = run.proposal?.status === "pending";
  const active = ["queued", "running", "waiting"].includes(run.state);
  const status = runWords({
    state: run.state,
    outcome: run.execution_outcome,
    stopping: active && (run.cancel_requested || stopRequested),
  });
  const matches = (value: OvernightNight) => {
    const current = value.runs.find((one) => one.id === run.id);
    return (
      value.id === nightId &&
      !!current &&
      !current.restricted &&
      current.job_id === run.job_id &&
      current.decision_token === run.decision_token &&
      current.question?.id === run.question?.id &&
      current.approval?.id === run.approval?.id
    );
  };
  const openChat = (id: string) => {
    if (owned()) navigate(`/app/assistant?chat=${encodeURIComponent(id)}`);
  };
  const open = (link: AgentActivityLink) => {
    if (!owned()) return;
    if (link.kind === "task") tasks.open(link.id);
    else
      navigate(
        `/app/${link.kind === "doc" ? "doc" : "project"}/${encodeURIComponent(link.id)}`,
      );
  };
  const keep = async (ids?: string[]) => {
    if (
      !owned() ||
      locked ||
      run.restricted ||
      run.state !== "done" ||
      run.status === "undone"
    )
      return;
    const only =
      ids ?? (pending && selected.size < choices.length ? [...selected] : null);
    if (only && !only.length) return;
    const partial = !!only && only.length < choices.length;
    await act({
      label: partial ? "Keep selected changes" : "Keep run",
      matches,
      receipt: receiptMatches(run),
      perform: () =>
        client.keepAssistantNightRun(
          run.id,
          only
            ? run.steps.length
              ? { steps: only }
              : { only: only.map(Number) }
            : {},
        ),
      confirm: partial
        ? {
            title: "Keep only these changes?",
            body: "The selected held changes will be approved. Other held changes in this run will be left out.",
            action: "Keep selected",
          }
        : undefined,
    });
  };
  const undo = async (ids?: string[]) => {
    if (
      !owned() ||
      locked ||
      !hasChanges(run) ||
      !["done", "failed"].includes(run.state) ||
      run.status === "undone"
    )
      return;
    await act({
      label: ids ? "Undo selected changes" : "Undo run",
      matches,
      receipt: receiptMatches(run),
      perform: () => client.undoAssistantNightRun(run.id, ids),
      confirm: {
        title: ids ? "Undo these changes?" : "Undo this run?",
        body: ids
          ? "Restores only the selected changes that can still be undone. Other changes remain."
          : "Held changes will be declined. Applied changes will be restored where they can still be undone.",
        action: "Undo",
        danger: true,
      },
    });
  };
  const stop = async () => {
    if (!owned() || locked || !active || stopRequested || run.cancel_requested)
      return;
    const saved = await act({
      label: "Stop request",
      matches,
      perform: () => client.stopAssistantRun(run.job_id),
      receipt: stoppedRun,
      reconcile: (value) => {
        const current = value.runs.find(
          (one) =>
            one.id === run.id && one.job_id === run.job_id && !one.restricted,
        );
        return value.id === nightId && current?.cancel_requested
          ? "Current work confirms cancellation was requested for this exact run. Its final outcome may still be pending."
          : null;
      },
      confirm: {
        title: "Stop this run?",
        body: "Requests cancellation. Changes already saved remain available for review and undo.",
        action: "Stop run",
        danger: true,
      },
    });
    if (saved && owned()) setStopRequested(true);
  };
  const keepable =
    hasChanges(run) && run.state === "done" && run.status !== "undone";
  const canUndo =
    hasChanges(run) &&
    ["done", "failed"].includes(run.state) &&
    run.status !== "undone";
  const canUndoSelected = canUndo && !pending;
  const undoable = run.changes.filter(
    (change) => change.undoable && !change.undone_at,
  );
  const undoIds = [...undoSelected].filter((id) =>
    undoable.some((change) => change.id === id),
  );
  return (
    <article className="night-result">
      <header className="night-result-heading">
        <div>
          <h3 dir="auto">
            {run.restricted
              ? "Result unavailable"
              : run.title || "Untitled night work"}
          </h3>
          <p className="small muted">
            {run.kind === "reflection" ? "Reflection" : run.kind} ·{" "}
            <Pill tone={status.tone}>{status.text}</Pill>
          </p>
        </div>
        {!run.restricted && run.chat_id && (
          <Button variant="ghost" onClick={() => openChat(run.chat_id!)}>
            Open work
          </Button>
        )}
      </header>
      {run.restricted ? (
        <p>
          This result and its sources are no longer available. Refresh to check
          current access.
        </p>
      ) : (
        <>
          <ReplyText
            text={
              expanded || run.summary.length <= 360
                ? run.summary ||
                  "No written summary. Open work for its recorded result."
                : run.summary.slice(0, 360) + "…"
            }
          />
          {run.summary.length > 360 && (
            <Button
              variant="ghost"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : "Read full result"}
            </Button>
          )}
          {run.execution_outcome && (
            <Evidence receipt={run.execution_outcome} />
          )}
          {active && (
            <Button
              disabled={locked || stopRequested || !!run.cancel_requested}
              onClick={() => void stop()}
            >
              {stopRequested || run.cancel_requested
                ? "Stop requested · awaiting confirmation"
                : "Stop this run"}
            </Button>
          )}
          {hasChanges(run) && (
            <p className="small">
              Changes:{" "}
              {run.status === "partly"
                ? "partly kept"
                : run.status === "pending"
                  ? "pending review"
                  : run.status === "undone"
                    ? "undone"
                    : "kept"}
            </p>
          )}
          {!!run.reflection_sources?.length && (
            <More summary="Reflection sources">
              <div className="agents-buttons">
                {run.reflection_sources.map((source) => (
                  <Button
                    key={`${source.kind}:${source.id}:${source.number}`}
                    variant="ghost"
                    onClick={() =>
                      source.kind === "chat"
                        ? openChat(source.id)
                        : open({
                            kind: "task",
                            id: source.id,
                            title: source.title,
                          })
                    }
                  >
                    [{source.number}] {source.title}
                  </Button>
                ))}
              </div>
            </More>
          )}
          {run.approval && (
            <section className="night-decision" aria-label="Waiting approval">
              <h4>Approval needed</h4>
              <ReplyText text={run.approval.text} />
              {run.approval.summary && (
                <ReplyText text={run.approval.summary} />
              )}
              {run.approval.detail && (
                <More summary="Full approval detail">
                  <ReplyText text={run.approval.detail} />
                </More>
              )}
              <div className="agents-buttons">
                {[true, false].map((approved) => (
                  <Button
                    key={String(approved)}
                    disabled={locked || run.state !== "waiting"}
                    variant={approved ? "primary" : undefined}
                    onClick={() => {
                      const waiting = run.approval;
                      if (!owned() || !waiting) return;
                      void act({
                        label: approved
                          ? "Approve waiting work"
                          : "Decline waiting work",
                        matches,
                        receipt: acceptedJob(run.job_id),
                        perform: () =>
                          client.approveAssistantRun(
                            run.job_id,
                            approved,
                            waiting.id,
                          ),
                      });
                    }}
                  >
                    {approved ? "Approve once" : "Decline"}
                  </Button>
                ))}
              </div>
            </section>
          )}
          {run.question && (
            <WaitingAnswer
              key={run.question.id}
              run={run}
              locked={locked}
              matches={matches}
              act={act}
            />
          )}
          {run.proposal && (
            <Button
              onClick={() =>
                owned() &&
                navigate(`/app/review/${encodeURIComponent(run.proposal!.id)}`)
              }
            >
              Open Review
            </Button>
          )}
          {hasChanges(run) && (
            <section className="night-decision" aria-label="Review run changes">
              {pending && choices.length > 0 && (
                <>
                  <h4>Held changes</h4>
                  <p className="small muted">
                    Choose all or selected changes. Keeping a selection leaves
                    out the others.
                  </p>
                  {choices.map((choice) => (
                    <div className="night-choice" key={choice.id}>
                      <Check
                        label={choice.title}
                        checked={selected.has(choice.id)}
                        disabled={locked || !keepable}
                        onChange={(event) =>
                          setSelected((old) => {
                            const next = new Set(old);
                            if (event.target.checked) next.add(choice.id);
                            else next.delete(choice.id);
                            return next;
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        disabled={locked || !keepable}
                        onClick={() => void keep([choice.id])}
                      >
                        Keep this change
                      </Button>
                    </div>
                  ))}
                </>
              )}
              <div className="agents-buttons">
                <Button
                  disabled={
                    locked ||
                    !keepable ||
                    (pending && choices.length > 0 && !selected.size)
                  }
                  onClick={() => void keep()}
                >
                  {pending && selected.size < choices.length
                    ? "Keep selected"
                    : "Keep run"}
                </Button>
                <Button
                  variant="danger"
                  disabled={
                    locked ||
                    !["done", "failed"].includes(run.state) ||
                    run.status === "undone"
                  }
                  onClick={() => void undo()}
                >
                  Undo run
                </Button>
              </div>
              {!!run.changes.length && (
                <More summary={`Recorded changes (${run.changes.length})`}>
                  {pending && (
                    <p className="small muted">
                      While held changes are pending, Undo run declines them
                      together. Decide those held changes before undoing
                      individual recorded changes.
                    </p>
                  )}
                  <ol className="night-changes">
                    {run.changes.map((change) => (
                      <li key={change.id}>
                        <p dir="auto">
                          {change.summary}
                          {change.undone_at ? " · Undone" : ""}
                        </p>
                        <time className="small muted" dateTime={change.at}>
                          {new Date(change.at).toLocaleString()}
                        </time>
                        <div className="agents-buttons">
                          {change.links?.map((link) => (
                            <Button
                              variant="ghost"
                              key={`${link.kind}:${link.id}`}
                              onClick={() => open(link)}
                            >
                              {link.title}
                            </Button>
                          ))}
                        </div>
                        {change.undoable && !change.undone_at && (
                          <div className="night-choice">
                            <Check
                              label="Select for Undo"
                              checked={undoSelected.has(change.id)}
                              disabled={locked || !canUndoSelected}
                              onChange={(event) =>
                                setUndoSelected((old) => {
                                  const next = new Set(old);
                                  if (event.target.checked) next.add(change.id);
                                  else next.delete(change.id);
                                  return next;
                                })
                              }
                            />
                            <Button
                              variant="ghost"
                              disabled={locked || !canUndoSelected}
                              onClick={() => void undo([change.id])}
                            >
                              Undo this change
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                  {undoable.length > 0 && (
                    <Button
                      variant="danger"
                      disabled={locked || !canUndoSelected || !undoIds.length}
                      onClick={() => void undo(undoIds)}
                    >
                      Undo selected changes ({undoIds.length})
                    </Button>
                  )}
                </More>
              )}
            </section>
          )}
          {run.state === "done" && (
            <More summary="Continue in Background">
              <fieldset disabled={locked} className="night-fieldset">
                <Handoff
                  jobId={run.job_id}
                  title={run.title}
                  lane="overnight"
                  onOpenChat={openChat}
                />
              </fieldset>
            </More>
          )}
        </>
      )}
    </article>
  );
}

function WaitingAnswer({
  run,
  locked,
  matches,
  act,
}: {
  run: OvernightRun;
  locked: boolean;
  matches: NightAction["matches"];
  act: (action: NightAction) => Promise<boolean>;
}) {
  const owned = useOwned();
  const [text, setText] = useState("");
  const question = run.question;
  if (!question) return null;
  const answer = async (value: string) => {
    if (!owned() || locked || !value.trim()) return;
    const original = text;
    const saved = await act({
      label: "Answer waiting question",
      matches,
      receipt: acceptedJob(run.job_id),
      perform: () =>
        client.answerAssistantRun(run.job_id, value.trim(), question.id),
    });
    if (saved && owned())
      setText((current) => (current === original ? "" : current));
  };
  return (
    <section className="night-decision" aria-label="Waiting question">
      <h4>Your answer is needed</h4>
      <ReplyText text={question.text} />
      <div className="agents-buttons">
        {question.choices.map((choice, index) => (
          <Button
            key={index}
            disabled={locked}
            onClick={() => void answer(choice)}
          >
            {choice}
          </Button>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void answer(text);
        }}
      >
        <Field label="Your answer">
          <TextArea
            value={text}
            maxLength={4000}
            disabled={locked}
            rows={3}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={locked || !text.trim()}
        >
          Send answer
        </Button>
      </form>
    </section>
  );
}

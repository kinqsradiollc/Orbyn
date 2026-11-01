import type { AssistantRunProgress } from "@orbyn/api-client";
import { useRef, useState } from "react";
import { Button, ErrorNotice, Field, Input, useConfirm } from "../../ui/kit";
import { useOwned } from "../agents-shared/hooks";
import { More } from "../agents-shared/parts";
import { changeKindList, stepWords } from "../agents-shared/words";

type Action = (
  action: "stop" | "answer" | "approve" | "decline",
  answer?: string,
  scope?: "once" | "goal" | "routine" | "always",
) => Promise<void>;
export function Waiting({
  progress,
  act,
}: {
  progress: AssistantRunProgress;
  act: Action;
}) {
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false),
    [busy, setBusy] = useState(false),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState("");
  const latest = useRef(progress);
  latest.current = progress;
  const run = async (
    action: "stop" | "answer" | "approve" | "decline",
    text = "",
    scope: "once" | "goal" | "routine" | "always" = "once",
  ) => {
    if (!owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    const snapshot = progress;
    try {
      if (
        (action === "stop" || (action === "approve" && scope !== "once")) &&
        !(await confirm({
          title:
            action === "stop" ? "Stop this run?" : "Save this approval scope?",
          body:
            action === "stop"
              ? "Cancellation is requested; already applied changes remain."
              : scope === "always"
                ? `Future ${snapshot.waiting?.kind === "approval" ? changeKindList(snapshot.waiting.change_kinds ?? []) : ""} changes may be applied without asking.`
                : `Future supported changes for this ${scope} may be applied without asking.`,
          action: action === "stop" ? "Request stop" : "Approve and save",
          danger: action === "stop",
        }))
      )
        return;
      if (
        !owned() ||
        latest.current.job_id !== snapshot.job_id ||
        latest.current.waiting?.id !== snapshot.waiting?.id
      )
        return;
      await act(action, text, scope);
    } catch {
      if (owned())
        setError(
          "Couldn't confirm this response. The answer is kept; refresh the run before retrying.",
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const waiting = progress.state === "waiting" ? progress.waiting : null;
  return (
    <section className="assistant-waiting" aria-label="Current run">
      <p role="status">
        {progress.label ?? (waiting ? "Waiting for you" : "Working…")}
      </p>
      {error && <ErrorNotice message={error} />}
      {waiting?.kind === "person" && (
        <>
          <h3>{waiting.question}</h3>
          <div className="agents-buttons">
            {waiting.choices.map((choice) => (
              <Button
                key={choice}
                disabled={busy}
                onClick={() => void run("answer", choice)}
              >
                {choice}
              </Button>
            ))}
          </div>
          <Field label="Your answer">
            <Input
              value={answer}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing &&
                  answer.trim()
                ) {
                  e.preventDefault();
                  void run("answer", answer.trim());
                }
              }}
            />
          </Field>
          <Button
            disabled={busy || !answer.trim()}
            onClick={() => void run("answer", answer.trim())}
          >
            Send answer
          </Button>
        </>
      )}
      {waiting?.kind === "approval" && (
        <>
          <h3>{waiting.question}</h3>
          <p>{waiting.summary}</p>
          <p className="agents-prewrap">{waiting.detail}</p>
          {waiting.steps.length > 0 && (
            <ol>
              {waiting.steps.map((step, i) => (
                <li key={i}>{stepWords(step)}</li>
              ))}
            </ol>
          )}
          <div className="agents-buttons">
            <Button disabled={busy} onClick={() => void run("decline")}>
              Decline
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run("approve")}
            >
              Apply once
            </Button>
          </div>
          {(waiting.automation_kind || waiting.change_kinds?.length) && (
            <More summary="Future approvals">
              {waiting.automation_kind && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run("approve", "", waiting.automation_kind)
                  }
                >
                  Apply and allow for this {waiting.automation_kind}
                </Button>
              )}
              {!!waiting.change_kinds?.length && (
                <Button
                  disabled={busy}
                  onClick={() => void run("approve", "", "always")}
                >
                  Apply and always allow {changeKindList(waiting.change_kinds)}
                </Button>
              )}
            </More>
          )}
        </>
      )}
      <Button
        variant="ghost"
        disabled={busy || progress.label?.startsWith("Cancellation requested")}
        onClick={() => void run("stop")}
      >
        Request stop
      </Button>
    </section>
  );
}

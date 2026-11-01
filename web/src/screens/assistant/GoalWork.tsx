import {
  goalExecutionStart,
  newId,
  type Goal,
  type GoalExecutionDetails,
  type GoalExecution,
  type GoalExecutionAttempt,
  type GoalExecutionStartInput,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { useNavigate } from "../../lib/router";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  Pill,
  SelectBox,
  useConfirm,
} from "../../ui/kit";
import { useOwned, onForeground, onLive } from "../agents-shared/hooks";
import { Check, Evidence, More } from "../agents-shared/parts";
import { useTasks } from "../shared-task";

export function GoalWork({
  goal,
  onClose,
  onOpenChat,
}: {
  goal: Goal;
  onClose: () => void;
  onOpenChat: (id: string) => void;
}) {
  const tasks = useTasks();
  const navigate = useNavigate();
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false),
    reads = useRef(0);
  const [history, setHistory] = useState<GoalExecution[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [detail, setDetail] = useState<GoalExecutionDetails | null>(null),
    [attempts, setAttempts] = useState<GoalExecutionAttempt[]>([]),
    [attemptCursor, setAttemptCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [starting, setStarting] = useState(false),
    [checked, setChecked] = useState<string[]>([]);
  const [criteria, setCriteria] = useState([
    { id: newId(), text: "", kind: "person" as const },
  ]);
  const [lane, setLane] = useState<"background" | "overnight">("background"),
    [ceiling, setCeiling] = useState<"suggest" | "existing_scopes">("suggest"),
    [maxAttempts, setMaxAttempts] = useState("3"),
    [tokens, setTokens] = useState("50000"),
    [deadline, setDeadline] = useState("");
  const latest = useRef(detail);
  latest.current = detail;
  const request = useRef<{ key: string; id: string } | null>(null);
  const actionRequest = useRef(new Map<string, string>());
  const initial = useRef(
    JSON.stringify([criteria, lane, ceiling, maxAttempts, tokens, deadline]),
  ).current;
  const dirty =
    starting &&
    JSON.stringify([criteria, lane, ceiling, maxAttempts, tokens, deadline]) !==
      initial;
  const load = async (append = false) => {
    if (!owned() || lock.current) return;
    const mine = ++reads.current;
    setLoading(true);
    setError("");
    try {
      const page = await client.goalExecutions(goal.id, {
        limit: 10,
        ...(append && cursor ? { cursor } : {}),
      });
      if (!owned() || mine !== reads.current) return;
      setHistory((old) =>
        append
          ? [
              ...old,
              ...page.executions.filter(
                (row) => !old.some((x) => x.id === row.id),
              ),
            ]
          : page.executions,
      );
      setCursor(page.next_cursor);
      setStale(false);
    } catch (failure) {
      if (owned() && mine === reads.current) {
        setHistory([]);
        setStale(true);
        setError(messageOf(failure, "Couldn't load goal work."));
      }
    } finally {
      if (owned() && mine === reads.current) setLoading(false);
    }
  };
  const inspect = async (id: string, append = false) => {
    if (!owned() || lock.current) return;
    const mine = ++reads.current;
    setLoading(true);
    setError("");
    if (!append) {
      setDetail(null);
      setAttempts([]);
      setChecked([]);
    }
    try {
      const [value, page] = await Promise.all([
        client.goalExecution(id),
        client.goalExecutionAttempts(id, {
          limit: 10,
          ...(append && attemptCursor ? { cursor: attemptCursor } : {}),
        }),
      ]);
      if (!owned() || mine !== reads.current) return;
      setDetail(value);
      setAttempts((old) =>
        append
          ? [
              ...old,
              ...page.attempts.filter(
                (row) => !old.some((x) => x.id === row.id),
              ),
            ]
          : page.attempts,
      );
      setAttemptCursor(page.next_cursor);
      setStale(false);
    } catch (failure) {
      if (owned() && mine === reads.current) {
        setStale(true);
        setDetail(null);
        setError(
          messageOf(
            failure,
            "Couldn't load this execution. Reload before making a change.",
          ),
        );
      }
    } finally {
      if (owned() && mine === reads.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      reads.current++;
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (owned() && !document.hidden && !lock.current && !starting) {
        if (latest.current) void inspect(latest.current.id);
        else void load();
      }
    };
    const fg = onForeground(refresh),
      off = onLive((news) => {
        if (
          news.kind === "changed" &&
          (!news.area || news.area === "assistant")
        )
          refresh();
      });
    return () => {
      fg();
      off();
    };
  }, [starting]);
  const close = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard work criteria?",
          body: "Your unsaved criteria and limits will be lost.",
          action: "Discard",
          danger: true,
        }))
      )
        return;
      if (owned()) onClose();
    } finally {
      lock.current = false;
    }
  };
  const start = async () => {
    if (
      !owned() ||
      lock.current ||
      stale ||
      !goal.revision ||
      goal.status !== "active"
    )
      return;
    let candidate: Omit<GoalExecutionStartInput, "request_id">;
    try {
      const at = new Date(deadline);
      if (!(at.getTime() > Date.now()))
        throw new Error("Choose a future deadline.");
      candidate = {
        expected_goal_revision: goal.revision,
        criteria,
        lane,
        effect_ceiling: ceiling,
        limits: {
          max_attempts: Number(maxAttempts),
          token_limit: Number(tokens),
          deadline: at.toISOString(),
        },
      };
    } catch (failure) {
      setError(messageOf(failure, "Check the work limits."));
      return;
    }
    const key = JSON.stringify(candidate);
    if (request.current?.key !== key) request.current = { key, id: newId() };
    const parsed = goalExecutionStart.safeParse({
      ...candidate,
      request_id: request.current.id,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the criteria and limits.",
      );
      return;
    }
    lock.current = true;
    reads.current++;
    setBusy(true);
    setError("");
    try {
      const result = await client.startGoalExecution(goal.id, parsed.data);
      if (!owned()) return;
      setDetail(result);
      setStarting(false);
      setChecked([]);
      setAttempts([]);
      setAttemptCursor(null);
      setHistory((old) => [result, ...old.filter((x) => x.id !== result.id)]);
    } catch (failure) {
      if (owned()) {
        setStale(true);
        setError(
          messageOf(
            failure,
            "Couldn't confirm the start. Reload work before retrying the same request.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const control = async (action: "pause" | "resume" | "stop" | "accept") => {
    const snapshot = latest.current;
    if (!owned() || lock.current || !snapshot || stale || loading) return;
    if (
      action === "accept" &&
      (snapshot.visibility !== "available" ||
        !snapshot.can_accept ||
        !snapshot.evidence_hash ||
        !snapshot.criteria.every((c) => checked.includes(c.id)))
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      if (
        (action === "stop" || action === "accept") &&
        !(await confirm({
          title:
            action === "stop"
              ? "Stop this goal execution?"
              : "Accept this goal work?",
          body:
            action === "stop"
              ? "Running work receives a cancellation request. Applied changes remain."
              : "You have reviewed every criterion and its current evidence.",
          action: action === "stop" ? "Stop execution" : "Accept work",
          danger: action === "stop",
        }))
      )
        return;
      if (!owned() || latest.current !== snapshot) return;
      const key = JSON.stringify([
        action,
        snapshot.id,
        snapshot.revision,
        snapshot.generation,
        action === "accept" ? checked : [],
      ]);
      let id = actionRequest.current.get(key);
      if (!id) {
        id = newId();
        actionRequest.current.set(key, id);
      }
      const input = {
        request_id: id,
        expected_revision: snapshot.revision,
        generation: snapshot.generation,
      };
      reads.current++;
      setError("");
      const result =
        action === "pause"
          ? await client.pauseGoalExecution(snapshot.id, input)
          : action === "resume"
            ? await client.resumeGoalExecution(snapshot.id, {
                ...input,
                expected_config_hash: snapshot.config_hash,
              })
            : action === "stop"
              ? await client.stopGoalExecution(snapshot.id, input)
              : snapshot.visibility === "available" && snapshot.evidence_hash
                ? await client.acceptGoalExecution(snapshot.id, {
                    ...input,
                    expected_criteria_hash: snapshot.criteria_hash,
                    expected_evidence_hash: snapshot.evidence_hash,
                    accepted_criterion_ids: snapshot.criteria.map((c) => c.id),
                  })
                : null;
      if (!owned() || !result) return;
      setDetail(result);
      setChecked([]);
      setHistory((old) =>
        old.map((one) => (one.id === result.id ? result : one)),
      );
    } catch (failure) {
      if (owned()) {
        setStale(true);
        setError(
          messageOf(
            failure,
            "Couldn't confirm this change. Reload this execution before another action.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Goal work · ${goal.title}`}
      wide
      onClose={() => void close()}
      actions={
        <Button disabled={busy} onClick={() => void close()}>
          Close
        </Button>
      }
    >
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => void (detail ? inspect(detail.id) : load())}
        />
      )}
      {loading && <Loading label="Loading goal work" />}
      {!detail && !starting && (
        <>
          <p className="muted">
            An execution works toward criteria. You decide when the evidence
            satisfies the goal.
          </p>
          <Button
            disabled={
              loading ||
              busy ||
              stale ||
              goal.status !== "active" ||
              !goal.revision
            }
            onClick={() => setStarting(true)}
          >
            Start goal work
          </Button>
          {!goal.revision && (
            <p className="muted">
              Reload the goal to obtain its current revision before starting
              work.
            </p>
          )}
          <ol className="assistant-records">
            {history.map((row) => (
              <li key={row.id}>
                <Button
                  disabled={busy || loading}
                  onClick={() => void inspect(row.id)}
                >
                  {new Date(row.created_at).toLocaleString()} · {row.state}
                </Button>
                <span className="muted small">
                  {row.lane} · {row.attempt_count} attempts ·{" "}
                  {row.consumed_tokens.toLocaleString()} tokens
                </span>
              </li>
            ))}
          </ol>
          {!history.length && !loading && <p>No goal executions yet.</p>}
          {cursor && (
            <Button disabled={loading || busy} onClick={() => void load(true)}>
              Earlier executions
            </Button>
          )}
        </>
      )}
      {starting && (
        <section className="agents-stack">
          <h3>Acceptance criteria</h3>
          {criteria.map((criterion, i) => (
            <Field key={criterion.id} label={`Criterion ${i + 1}`}>
              <Input
                maxLength={500}
                disabled={busy}
                value={criterion.text}
                onChange={(e) =>
                  setCriteria((old) =>
                    old.map((c) =>
                      c.id === criterion.id
                        ? { ...c, text: e.target.value }
                        : c,
                    ),
                  )
                }
              />
              {criteria.length > 1 && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    setCriteria((old) =>
                      old.filter((c) => c.id !== criterion.id),
                    )
                  }
                >
                  Remove criterion {i + 1}
                </Button>
              )}
            </Field>
          ))}
          {criteria.length < 10 && (
            <Button
              disabled={busy}
              onClick={() =>
                setCriteria((old) => [
                  ...old,
                  { id: newId(), text: "", kind: "person" },
                ])
              }
            >
              Add criterion
            </Button>
          )}
          <Field label="Lane">
            <SelectBox
              disabled={busy}
              value={lane}
              onChange={(e) =>
                setLane(
                  e.target.value === "overnight" ? "overnight" : "background",
                )
              }
            >
              <option value="background">Background</option>
              <option value="overnight">Overnight</option>
            </SelectBox>
          </Field>
          <Field label="Changes allowed">
            <SelectBox
              disabled={busy}
              value={ceiling}
              onChange={(e) =>
                setCeiling(
                  e.target.value === "existing_scopes"
                    ? "existing_scopes"
                    : "suggest",
                )
              }
            >
              <option value="suggest">Suggest only</option>
              <option value="existing_scopes">
                Existing saved permissions
              </option>
            </SelectBox>
          </Field>
          <Field label="Maximum attempts">
            <Input
              type="number"
              min={1}
              max={20}
              value={maxAttempts}
              disabled={busy}
              onChange={(e) => setMaxAttempts(e.target.value)}
            />
          </Field>
          <Field label="Total tokens">
            <Input
              type="number"
              min={1}
              max={1000000}
              value={tokens}
              disabled={busy}
              onChange={(e) => setTokens(e.target.value)}
            />
          </Field>
          <Field label="Deadline (device time)">
            <Input
              type="datetime-local"
              value={deadline}
              disabled={busy}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            busy={busy}
            disabled={loading || stale}
            onClick={() => void start()}
          >
            Start execution
          </Button>
        </section>
      )}
      {detail && (
        <section className="agents-stack">
          <header className="agents-row">
            <h3>{detail.state}</h3>
            <Button
              disabled={busy || loading}
              onClick={() => {
                setDetail(null);
                setChecked([]);
                void load();
              }}
            >
              All executions
            </Button>
          </header>
          <p>{detail.last_transition_reason}</p>
          <p className="muted">
            {detail.lane} · {detail.attempt_count}/{detail.limits.max_attempts}{" "}
            attempts · {detail.consumed_tokens.toLocaleString()} consumed +{" "}
            {detail.reserved_tokens.toLocaleString()} reserved /{" "}
            {detail.limits.token_limit.toLocaleString()} tokens · Deadline{" "}
            {new Date(detail.limits.deadline).toLocaleString()}
          </p>
          {detail.visibility === "restricted" ? (
            <p>
              Execution evidence is restricted. Current state and limits remain
              visible.
            </p>
          ) : (
            <>
              <p>{detail.permission_summary}</p>
              {detail.result && (
                <div>
                  <Button
                    onClick={() =>
                      owned() && onOpenChat(detail.result!.chat_id)
                    }
                  >
                    Open current work
                  </Button>
                  {detail.result.summary && <p>{detail.result.summary}</p>}
                  {detail.result.execution_outcome && (
                    <Evidence receipt={detail.result.execution_outcome} />
                  )}
                </div>
              )}
              {detail.waiting_results.map((wait) => (
                <section key={wait.attempt_id}>
                  <Pill tone="amber">{wait.waiting_kind}</Pill>
                  <p>{wait.summary}</p>
                  <Button onClick={() => owned() && onOpenChat(wait.chat_id)}>
                    Open waiting work
                  </Button>
                </section>
              ))}
              {detail.criteria.map((criterion) => {
                const unit = detail.units.find(
                  (u) => u.criterion_id === criterion.id,
                );
                return (
                  <section key={criterion.id}>
                    <h4>{criterion.text}</h4>
                    <p className="muted">
                      {unit?.stage}
                      {unit?.blocker_code ? ` · ${unit.blocker_code}` : ""}
                    </p>
                    {unit?.outputs.map((output) => (
                      <div key={`${output.kind}:${output.id}`}>
                        <span>
                          {output.kind} · version {output.version}
                        </span>
                        {output.kind !== "response" && (
                          <Button
                            onClick={() => {
                              if (!owned()) return;
                              if (output.kind === "task") tasks.open(output.id);
                              else
                                navigate(
                                  `/app/${output.kind === "doc" ? "doc" : "project"}/${encodeURIComponent(output.id)}`,
                                );
                            }}
                          >
                            Open output
                          </Button>
                        )}
                      </div>
                    ))}
                    {unit?.pending_proposal_id && (
                      <Button
                        onClick={() =>
                          owned() &&
                          navigate(
                            `/app/review/${encodeURIComponent(unit.pending_proposal_id!)}`,
                          )
                        }
                      >
                        Review proposed changes
                      </Button>
                    )}
                    {detail.can_accept && (
                      <Check
                        label="I reviewed this criterion and its evidence"
                        checked={checked.includes(criterion.id)}
                        disabled={busy || stale || loading}
                        onChange={(e) =>
                          setChecked((old) =>
                            e.target.checked
                              ? [...old, criterion.id]
                              : old.filter((id) => id !== criterion.id),
                          )
                        }
                      />
                    )}
                  </section>
                );
              })}
              {detail.acceptance && (
                <p role="status">
                  Accepted{" "}
                  {new Date(detail.acceptance.accepted_at).toLocaleString()}
                </p>
              )}
              {detail.can_accept && (
                <Button
                  variant="primary"
                  busy={busy}
                  disabled={
                    stale ||
                    loading ||
                    !detail.criteria.every((c) => checked.includes(c.id))
                  }
                  onClick={() => void control("accept")}
                >
                  Accept reviewed work
                </Button>
              )}
            </>
          )}
          {!["completed", "stopped"].includes(detail.state) && (
            <div className="agents-buttons">
              <Button
                disabled={busy || loading || stale}
                onClick={() =>
                  void control(detail.admissions_paused ? "resume" : "pause")
                }
              >
                {detail.admissions_paused
                  ? "Resume admissions"
                  : "Pause admissions"}
              </Button>
              <Button
                variant="danger"
                disabled={busy || loading || stale}
                onClick={() => void control("stop")}
              >
                Stop execution
              </Button>
            </div>
          )}
          <More summary="Attempt history" open>
            <ol className="assistant-records">
              {attempts.map((row) => (
                <li key={row.id}>
                  <strong>
                    Attempt {row.ordinal} · {row.mode} · {row.state}
                  </strong>
                  <p className="muted small">
                    {row.allocated_tokens} allocated ·{" "}
                    {row.settled_tokens ?? "Unsettled"} settled tokens ·{" "}
                    {new Date(row.created_at).toLocaleString()}
                  </p>
                  {row.visibility === "available" ? (
                    <>
                      <p>{row.summary}</p>
                      {row.execution_outcome && (
                        <Evidence receipt={row.execution_outcome} />
                      )}
                      <Button
                        onClick={() => owned() && onOpenChat(row.chat_id)}
                      >
                        Open attempt
                      </Button>
                    </>
                  ) : (
                    <p>Evidence restricted</p>
                  )}
                </li>
              ))}
            </ol>
            {attemptCursor && (
              <Button
                disabled={busy || loading}
                onClick={() => void inspect(detail.id, true)}
              >
                Earlier attempts
              </Button>
            )}
            {!attempts.length && !loading && (
              <Button disabled={busy} onClick={() => void inspect(detail.id)}>
                Load attempts
              </Button>
            )}
          </More>
        </section>
      )}
    </Dialog>
  );
}

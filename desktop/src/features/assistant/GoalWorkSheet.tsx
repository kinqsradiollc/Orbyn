import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  errorMessage,
  HttpError,
  goalExecutionStart,
  type Goal,
  type GoalExecution,
  type GoalExecutionDetails,
  type GoalExecutionAttempt,
  type GoalExecutionOutput,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { SettingsEditor } from "../settings/SettingsEditor";
import { useConfirm } from "../../components/Confirm";
const uuid = () => crypto.randomUUID();
export function GoalWorkSheet(props: Props) {
  return (
    <GoalWorkBody
      key={`${session.binding().generation}:${props.goal.id}`}
      {...props}
    />
  );
}
function Frame({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <SettingsEditor title={title} pending={busy} onClose={onClose}>
      {children}
    </SettingsEditor>
  );
}
const Block = ({ children }: { children: ReactNode }) => (
  <div className="settings-subform">{children}</div>
);
const Copy = ({ children }: { children: ReactNode }) => (
  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{children}</p>
);
const Notice = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="error">
    {children}
  </p>
);
const Action = ({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) => (
  <button
    type="button"
    className="secondary"
    disabled={disabled}
    onClick={onPress}
  >
    {label}
  </button>
);
function TextField({
  label,
  value,
  onChange,
  disabled,
  multiline,
  numeric,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  numeric?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="settings-field">
      {label}
      {multiline ? (
        <textarea
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={numeric ? "number" : "text"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function Choices({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function Deadline({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      Deadline
      <input
        type="datetime-local"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function CriterionCheck({
  text,
  checked,
  disabled,
  onChange,
}: {
  text: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {text}
    </label>
  );
}

function OutputEvidence({ output }: { output: GoalExecutionOutput }) {
  const name = {
    response: "Response",
    task: "Task",
    doc: "Document",
    project: "Project",
  }[output.kind];
  const version =
    output.version.length > 16
      ? `${output.version.slice(0, 8)}…`
      : output.version;
  return (
    <details>
      <summary>
        {name} · Version {version}
      </summary>
      <Copy>Identity: {output.id}</Copy>
      <Copy>Full version: {output.version}</Copy>
    </details>
  );
}
type Props = {
  goal: Goal;
  initialMode: "start" | "history";
  permissionSummary: string;
  onClose: () => void;
  onOpenChat?: (id: string) => void;
};
const states: Record<GoalExecution["state"], string> = {
  ready: "Ready",
  active: "Working",
  waiting: "Waiting for you",
  awaiting_acceptance: "Ready for your review",
  limited: "Limit reached",
  held: "Held",
  failed: "Run failed",
  stopped: "Stopped",
  completed: "Goal accepted",
};
const observed = (value: string) => new Date(value).toLocaleString();
function GoalWorkBody({
  goal,
  initialMode,
  permissionSummary,
  onClose,
  onOpenChat,
}: Props) {
  const { ask } = useConfirm();
  const confirmDiscard = () =>
    ask({
      title: "Discard work scope draft?",
      body: "Your unsaved criteria and bounds will be discarded.",
      confirmLabel: "Discard draft",
    });
  const confirmStop = () =>
    ask({
      title: "Stop this work?",
      body: "Stops future attempts and requests cancellation of current work. Existing changes remain.",
      confirmLabel: "Stop work",
    });
  const owner = useRef(session.binding()).current;
  const mounted = useRef(true);
  const sequence = useRef(0);
  const lock = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const current = () => {
    const now = session.binding();
    return (
      mounted.current &&
      now.token === owner.token &&
      now.generation === owner.generation
    );
  };
  const [mode, setMode] = useState(initialMode);
  const [criteria, setCriteria] = useState([
    {
      id: uuid(),
      text: goal.target.length <= 500 ? goal.target : "",
      kind: "person" as const,
    },
  ]);
  const [lane, setLane] = useState<"background" | "overnight">("background");
  const [ceiling, setCeiling] = useState<"suggest" | "existing_scopes">(
    "suggest",
  );
  const [attempts, setAttempts] = useState("3");
  const [tokens, setTokens] = useState("20000");
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 86400000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  });
  const initialDraft = useRef<string | null>(null);
  const draft = JSON.stringify({
    criteria,
    lane,
    ceiling,
    attempts,
    tokens,
    deadline,
  });
  initialDraft.current ??= draft;
  useEffect(() => {
    request.current = null;
  }, [draft]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [staleSnapshot, setStaleSnapshot] = useState(false);
  const [error, setError] = useState("");
  const [list, setList] = useState<GoalExecution[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<GoalExecutionDetails | null>(null);
  const selected = useRef<string | null>(null);
  const [history, setHistory] = useState<GoalExecutionAttempt[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [review, setReview] = useState<GoalExecutionDetails | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [failedRead, setFailedRead] = useState<(() => void) | null>(null);
  const requestId = (key: string) => {
    if (request.current?.key !== key) request.current = { key, id: uuid() };
    return request.current.id;
  };
  const close = async () => {
    if (lock.current || !current()) return;
    if (draft !== initialDraft.current && !(await confirmDiscard())) return;
    if (current()) onClose();
  };
  const openChat = async (id: string) => {
    if (busy || staleSnapshot || !current()) return;
    if (draft !== initialDraft.current && !(await confirmDiscard())) return;
    if (current()) onOpenChat?.(id);
  };
  const clearUnavailable = (error: unknown) => {
    if (
      error instanceof HttpError &&
      [401, 403, 404].includes(error.statusCode)
    ) {
      setDetail(null);
      setHistory(null);
      setHistoryCursor(null);
      setReview(null);
      setChecked([]);
    }
  };
  async function read(
    task: (owned: () => boolean) => Promise<void>,
    retry: () => void,
  ) {
    if (lock.current || !current()) return;
    const ticket = ++sequence.current;
    lock.current = true;
    setLoading(true);
    setError("");
    setFailedRead(null);
    try {
      await task(() => current() && ticket === sequence.current);
      if (current() && ticket === sequence.current) setStaleSnapshot(false);
    } catch (error) {
      if (current() && ticket === sequence.current) {
        clearUnavailable(error);
        setStaleSnapshot(true);
        setError("Couldn't load goal work. Try again.");
        setFailedRead(() => retry);
      }
    } finally {
      if (ticket === sequence.current) {
        lock.current = false;
        if (current()) setLoading(false);
      }
    }
  }
  async function loadList(next?: string) {
    await read(
      async (owned) => {
        const page = await client.goalExecutions(goal.id, {
          limit: 10,
          ...(next ? { cursor: next } : {}),
        });
        if (!owned()) return;
        setList((previous) =>
          next ? [...(previous ?? []), ...page.executions] : page.executions,
        );
        setCursor(page.next_cursor);
      },
      () => void loadList(next),
    );
  }
  async function loadDetail(id: string, acceptance = false) {
    selected.current = id;
    await read(
      async (owned) => {
        const value = await client.goalExecution(id);
        if (!owned() || selected.current !== id) return;
        setDetail(value);
        if (acceptance) {
          setReview(value);
          setChecked([]);
        }
      },
      () => void loadDetail(id, acceptance),
    );
  }
  async function loadAttempts(next?: string) {
    const id = detail?.id;
    if (!id) return;
    await read(
      async (owned) => {
        const page = await client.goalExecutionAttempts(id, {
          limit: 10,
          ...(next ? { cursor: next } : {}),
        });
        if (!owned() || selected.current !== id) return;
        setHistory((previous) =>
          next ? [...(previous ?? []), ...page.attempts] : page.attempts,
        );
        setHistoryCursor(page.next_cursor);
      },
      () => void loadAttempts(next),
    );
  }
  async function mutate(task: () => Promise<GoalExecutionDetails>) {
    if (lock.current || !current()) return;
    lock.current = true;
    ++sequence.current;
    setBusy(true);
    setError("");
    setFailedRead(null);
    try {
      const value = await task();
      if (!current()) return;
      selected.current = value.id;
      setDetail(value);
      setStaleSnapshot(false);
      setMode("history");
      setReview(null);
      setChecked([]);
      setHistory(null);
      return true;
    } catch (error) {
      if (current()) {
        clearUnavailable(error);
        setStaleSnapshot(true);
        setError(errorMessage(error));
        setReview(null);
        setChecked([]);
      }
      return false;
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  const start = async () => {
    const time = new Date(deadline);
    if (!Number.isFinite(time.getTime()) || time.getTime() <= Date.now()) {
      setError("Choose a future deadline.");
      return;
    }
    const body = {
      expected_goal_revision: goal.revision,
      criteria,
      lane,
      effect_ceiling: ceiling,
      limits: {
        max_attempts: Number(attempts),
        token_limit: Number(tokens),
        deadline: time.toISOString(),
      },
    };
    const parsed = goalExecutionStart.safeParse({
      ...body,
      request_id: requestId(JSON.stringify(body)),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the work scope.");
      return;
    }
    if (await mutate(() => client.startGoalExecution(goal.id, parsed.data)))
      initialDraft.current = draft;
  };
  const control = async (action: "pause" | "resume" | "stop") => {
    if (!detail || staleSnapshot) return;
    if (lock.current || !current()) return;
    if (action === "stop") {
      lock.current = true;
      const confirmed = await confirmStop();
      lock.current = false;
      if (!confirmed || !current()) return;
    }
    if (!current()) return;
    const base = {
      expected_revision: detail.revision,
      generation: detail.generation,
    };
    const body = {
      ...base,
      request_id: requestId(JSON.stringify({ id: detail.id, action, ...base })),
    };
    await mutate(() =>
      action === "pause"
        ? client.pauseGoalExecution(detail.id, body)
        : action === "resume"
          ? client.resumeGoalExecution(detail.id, {
              ...body,
              expected_config_hash: detail.config_hash,
            })
          : client.stopGoalExecution(detail.id, body),
    );
  };
  const accept = async () => {
    if (
      staleSnapshot ||
      !review ||
      review.visibility !== "available" ||
      !review.can_accept ||
      !review.evidence_hash ||
      !review.criteria.every((c) => checked.includes(c.id))
    )
      return;
    const body = {
      expected_revision: review.revision,
      generation: review.generation,
      expected_criteria_hash: review.criteria_hash,
      expected_evidence_hash: review.evidence_hash,
      accepted_criterion_ids: review.criteria.map((c) => c.id),
    };
    await mutate(() =>
      client.acceptGoalExecution(review.id, {
        ...body,
        request_id: requestId(
          JSON.stringify({ action: "accept", id: review.id, ...body }),
        ),
      }),
    );
  };
  useEffect(() => {
    mounted.current = true;
    lock.current = false;
    return () => {
      mounted.current = false;
      lock.current = false;
      ++sequence.current;
    };
  }, []);
  useEffect(() => {
    if (mode === "history" && !detail) void loadList();
  }, [mode]);
  useEffect(() => {
    if (
      mode !== "history" ||
      !detail ||
      review ||
      error ||
      !["ready", "active", "waiting"].includes(detail.state)
    )
      return;
    const id = detail.id;
    const timer = setInterval(() => {
      if (!lock.current && current()) void loadDetail(id);
    }, 10000);
    return () => clearInterval(timer);
  }, [detail?.id, detail?.state, review, error, mode]);
  const result = detail?.visibility === "available" ? detail.result : null;
  const working =
    !!result && ["queued", "running", "waiting"].includes(result.state);
  const shownReview = review?.visibility === "available" ? review : null;
  return (
    <Frame title={goal.title} busy={busy} onClose={() => void close()}>
      <Block>
        <Action
          label="Work scope"
          disabled={busy || loading}
          onPress={() => {
            setMode("start");
            setReview(null);
          }}
        />
        <Action
          label="Work history"
          disabled={busy || loading}
          onPress={() => {
            setMode("history");
            setReview(null);
            if (!list && !detail) void loadList();
          }}
        />
        {!!error && <Notice>{error}</Notice>}
        {failedRead && (
          <Action
            label="Retry"
            disabled={busy || loading}
            onPress={failedRead}
          />
        )}
        {loading && <Copy>Loading…</Copy>}
        {mode === "start" ? (
          <Block>
            <Copy>
              Define the result you will review. Weekly check-ins remain
              separate.
            </Copy>
            {!!goal.target && <Copy>Goal target: {goal.target}</Copy>}
            {criteria.map((criterion, index) => (
              <Block key={criterion.id}>
                <TextField
                  label={`Criterion ${index + 1}`}
                  value={criterion.text}
                  multiline
                  maxLength={500}
                  disabled={busy}
                  onChange={(text) =>
                    setCriteria((rows) =>
                      rows.map((row) =>
                        row.id === criterion.id ? { ...row, text } : row,
                      ),
                    )
                  }
                />
                {criteria.length > 1 && (
                  <Action
                    label="Remove criterion"
                    disabled={busy}
                    onPress={() =>
                      setCriteria((rows) =>
                        rows.filter((row) => row.id !== criterion.id),
                      )
                    }
                  />
                )}
              </Block>
            ))}
            {criteria.length < 10 && (
              <Action
                label="Add criterion"
                disabled={busy}
                onPress={() =>
                  setCriteria((rows) => [
                    ...rows,
                    { id: uuid(), text: "", kind: "person" },
                  ])
                }
              />
            )}
            <Choices
              label="Run in"
              value={lane}
              options={[
                { value: "background", label: "Background" },
                { value: "overnight", label: "Overnight" },
              ]}
              disabled={busy}
              onChange={(value) => setLane(value as typeof lane)}
            />
            <Choices
              label="Changes"
              value={ceiling}
              options={[
                { value: "suggest", label: "Suggest changes for review" },
                { value: "existing_scopes", label: "Use existing permissions" },
              ]}
              disabled={busy}
              onChange={(value) => setCeiling(value as typeof ceiling)}
            />
            <Copy>
              {permissionSummary} This scope grants no additional access or
              automatic permissions. Provider and lane admission limits still
              apply.
            </Copy>
            <TextField
              label="Maximum attempts (1–20)"
              value={attempts}
              numeric
              disabled={busy}
              onChange={setAttempts}
            />
            <TextField
              label="Total token limit (up to 1,000,000)"
              value={tokens}
              numeric
              disabled={busy}
              onChange={setTokens}
            />
            <Deadline value={deadline} disabled={busy} onChange={setDeadline} />
            <Copy>
              Deadline uses this device’s local time. Bounds limit work; they do
              not guarantee a completed result.
            </Copy>
            {!goal.revision && (
              <Notice>
                Refresh Upcoming before starting: the goal revision is
                unavailable.
              </Notice>
            )}
            <Action
              label={busy ? "Starting…" : "Start goal work"}
              disabled={
                busy || loading || !goal.revision || goal.status !== "active"
              }
              onPress={() => void start()}
            />
          </Block>
        ) : (
          <Block>
            {!detail ? (
              <Block>
                {list?.length === 0 && <Copy>No goal work yet.</Copy>}
                {list?.map((row) => (
                  <Action
                    key={row.id}
                    label={`${states[row.state]} · ${observed(row.created_at)} · ${row.lane}`}
                    disabled={busy || loading}
                    onPress={() => {
                      setHistory(null);
                      setReview(null);
                      void loadDetail(row.id);
                    }}
                  />
                ))}
                {cursor && (
                  <Action
                    label="Load 10 older scopes"
                    disabled={busy || loading}
                    onPress={() => void loadList(cursor)}
                  />
                )}
              </Block>
            ) : (
              <Block>
                <Action
                  label="Back to work history"
                  disabled={busy || loading}
                  onPress={() => {
                    selected.current = null;
                    setDetail(null);
                    setReview(null);
                    setHistory(null);
                    void loadList();
                  }}
                />
                <Copy>
                  {states[detail.state]} · {detail.lane} ·{" "}
                  {["completed", "stopped"].includes(detail.state)
                    ? "No further attempts"
                    : detail.admissions_paused
                      ? "Future attempts paused"
                      : "Future attempts allowed within scope"}
                </Copy>
                <Copy>
                  {detail.attempt_count} / {detail.limits.max_attempts} attempts
                  · {detail.consumed_tokens} tokens used ·{" "}
                  {detail.reserved_tokens} reserved · Deadline{" "}
                  {observed(detail.limits.deadline)}
                </Copy>
                <Action
                  label="Refresh work"
                  disabled={busy || loading}
                  onPress={() => {
                    setReview(null);
                    void loadDetail(detail.id);
                  }}
                />
                {detail.visibility === "restricted" ? (
                  <Block>
                    <Copy>
                      Result details aren’t available. You can still pause new
                      work or stop this execution.
                    </Copy>
                    <Action
                      label="Pause new work"
                      disabled={
                        busy ||
                        loading ||
                        staleSnapshot ||
                        detail.admissions_paused ||
                        ["completed", "stopped"].includes(detail.state)
                      }
                      onPress={() => void control("pause")}
                    />
                    <Action
                      label="Stop this execution"
                      disabled={
                        busy ||
                        loading ||
                        staleSnapshot ||
                        ["completed", "stopped"].includes(detail.state)
                      }
                      onPress={() => void control("stop")}
                    />
                    {detail.state === "stopped" && (
                      <Copy>
                        The scope is stopped. This does not confirm that any
                        in-flight run has ended or undo existing changes.
                      </Copy>
                    )}
                  </Block>
                ) : (
                  <Block>
                    <Copy>{detail.permission_summary}</Copy>
                    {detail.criteria.map((c) => {
                      const unit = detail.units.find(
                        (unit) => unit.criterion_id === c.id,
                      );
                      return (
                        <Block key={c.id}>
                          <Copy>{c.text}</Copy>
                          <Copy>
                            {unit?.stage === "ready_for_acceptance"
                              ? "Ready for your review"
                              : unit?.stage === "satisfied"
                                ? "Accepted by you"
                                : unit?.stage === "blocked"
                                  ? "Blocked"
                                  : unit?.stage === "verify"
                                    ? "Checking result"
                                    : unit?.stage === "repair"
                                      ? "Repairing result"
                                      : "Work pending"}
                          </Copy>
                          {unit?.outputs.map((output) => (
                            <OutputEvidence
                              key={`${output.kind}:${output.id}:${output.version}`}
                              output={output}
                            />
                          ))}
                        </Block>
                      );
                    })}
                    {result && (
                      <Block>
                        <Copy>
                          {result.cancel_requested && working
                            ? "Stop requested · Awaiting confirmation"
                            : result.recovering && working
                              ? "Recovery pending"
                              : result.execution_outcome
                                ? ASSISTANT_OUTCOME_LABELS[
                                    result.execution_outcome.outcome
                                  ]
                                : result.state === "done"
                                  ? "Run finished · Outcome not verified"
                                  : result.state === "failed"
                                    ? "Run failed"
                                    : result.state === "waiting"
                                      ? "Waiting for you"
                                      : result.state === "queued"
                                        ? "Queued"
                                        : "Running"}
                        </Copy>
                        {!!result.summary && <Copy>{result.summary}</Copy>}
                        {result.execution_outcome &&
                          assistantOutcomeDetails(result.execution_outcome).map(
                            (line, i) => <Copy key={i}>{line}</Copy>,
                          )}
                        {onOpenChat && (
                          <Action
                            label={working ? "Open work" : "Open result"}
                            disabled={busy || loading || staleSnapshot}
                            onPress={() => {
                              void openChat(result.chat_id);
                            }}
                          />
                        )}
                      </Block>
                    )}
                    {detail.acceptance && (
                      <Copy>
                        Accepted by you ·{" "}
                        {observed(detail.acceptance.accepted_at)}
                      </Copy>
                    )}
                    {!detail.acceptance && (
                      <Block>
                        <Copy>
                          Pause controls future attempts; it does not stop the
                          current run. Stop requests cancellation and keeps
                          existing results.
                        </Copy>
                        <Action
                          label={
                            detail.admissions_paused
                              ? "Resume future attempts"
                              : "Pause future attempts"
                          }
                          disabled={
                            busy ||
                            loading ||
                            staleSnapshot ||
                            ["completed", "stopped"].includes(detail.state)
                          }
                          onPress={() =>
                            void control(
                              detail.admissions_paused ? "resume" : "pause",
                            )
                          }
                        />
                        <Action
                          label={
                            working ? "Stop current work" : "Stop this scope"
                          }
                          disabled={
                            busy ||
                            loading ||
                            staleSnapshot ||
                            !!result?.cancel_requested ||
                            ["completed", "stopped"].includes(detail.state)
                          }
                          onPress={() => void control("stop")}
                        />
                        <Action
                          label="Review for acceptance"
                          disabled={
                            busy ||
                            loading ||
                            staleSnapshot ||
                            !detail.can_accept
                          }
                          onPress={() => {
                            setReview(null);
                            void loadDetail(detail.id, true);
                          }}
                        />
                      </Block>
                    )}
                  </Block>
                )}
                {detail.visibility === "available" && (
                  <Block>
                    <Action
                      label="Attempt history"
                      disabled={busy || loading || staleSnapshot}
                      onPress={() => {
                        setHistory(null);
                        void loadAttempts();
                      }}
                    />
                    {history?.length === 0 && <Copy>No attempts yet.</Copy>}
                    {history?.map((row) => (
                      <Block key={row.id}>
                        <Copy>
                          Attempt {row.ordinal} · {row.mode} ·{" "}
                          {observed(row.created_at)} ·{" "}
                          {["done", "failed"].includes(row.state) &&
                          row.visibility === "available" &&
                          row.execution_outcome
                            ? ASSISTANT_OUTCOME_LABELS[
                                row.execution_outcome.outcome
                              ]
                            : row.state === "done"
                              ? "Run finished"
                              : row.state}
                        </Copy>
                        {row.visibility === "restricted" ? (
                          <Copy>Result no longer available</Copy>
                        ) : (
                          <Block>
                            {!!row.summary && <Copy>{row.summary}</Copy>}
                            {row.execution_outcome &&
                              assistantOutcomeDetails(
                                row.execution_outcome,
                              ).map((line, i) => <Copy key={i}>{line}</Copy>)}
                            {onOpenChat && (
                              <Action
                                label="Open attempt"
                                disabled={busy || loading || staleSnapshot}
                                onPress={() => {
                                  void openChat(row.chat_id);
                                }}
                              />
                            )}
                          </Block>
                        )}
                      </Block>
                    ))}
                    {historyCursor && (
                      <Action
                        label="Load 10 older attempts"
                        disabled={busy || loading || staleSnapshot}
                        onPress={() => void loadAttempts(historyCursor)}
                      />
                    )}
                  </Block>
                )}
                {detail.visibility === "available" && shownReview && (
                  <Block>
                    <Copy>
                      Review this exact result against every criterion.
                      Accepting records your judgment; it does not publish or
                      grant access.
                    </Copy>
                    {!shownReview.can_accept ? (
                      <Copy>
                        This result is not ready for acceptance. Refresh work to
                        review its current state.
                      </Copy>
                    ) : (
                      <Block>
                        {!!shownReview.result?.summary && (
                          <Copy>{shownReview.result.summary}</Copy>
                        )}
                        {shownReview.units
                          .flatMap((unit) => unit.outputs)
                          .map((output) => (
                            <OutputEvidence
                              key={`${output.kind}:${output.id}:${output.version}`}
                              output={output}
                            />
                          ))}
                        {shownReview.result?.execution_outcome &&
                          assistantOutcomeDetails(
                            shownReview.result.execution_outcome,
                          ).map((line, i) => <Copy key={i}>{line}</Copy>)}
                        {shownReview.criteria.map((c) => (
                          <CriterionCheck
                            key={c.id}
                            text={c.text}
                            checked={checked.includes(c.id)}
                            disabled={busy || loading}
                            onChange={() =>
                              setChecked((rows) =>
                                rows.includes(c.id)
                                  ? rows.filter((id) => id !== c.id)
                                  : [...rows, c.id],
                              )
                            }
                          />
                        ))}
                        <Action
                          label="Accept result"
                          disabled={
                            busy ||
                            loading ||
                            !shownReview.criteria.every((c) =>
                              checked.includes(c.id),
                            )
                          }
                          onPress={() => void accept()}
                        />
                      </Block>
                    )}
                  </Block>
                )}
              </Block>
            )}
          </Block>
        )}
      </Block>
    </Frame>
  );
}

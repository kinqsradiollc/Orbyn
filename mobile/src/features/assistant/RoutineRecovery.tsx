import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  HttpError,
  errorMessage,
  routineRetryPolicy,
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  type RoutineRetryPolicy,
  type RoutineRetryPolicyPage,
  type RoutineRecovery,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { Alert } from "../../lib/alert";
import { shared } from "../../styles";
const uuid = () => Crypto.randomUUID();
const binding = () => ({
  token: session.token,
  generation: session.generation,
});
const Block = ({ children }: { children: ReactNode }) => (
  <View style={{ gap: 8 }}>{children}</View>
);
const Copy = ({ children }: { children: ReactNode }) => (
  <Text style={shared.body}>{children}</Text>
);
const Heading = Copy;
const Notice = ({ children }: { children: ReactNode }) => (
  <Text accessibilityRole="alert" style={shared.body}>
    {children}
  </Text>
);
const Action = ({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) => <Button title={label} secondary disabled={disabled} onPress={onPress} />;
const Toggle = ({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) => (
  <Chip
    label={label}
    selected={checked}
    multi
    disabled={disabled}
    onPress={onChange}
  />
);
const NumberField = ({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) => (
  <View>
    <Text style={shared.small}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      value={value}
      editable={!disabled}
      keyboardType="number-pad"
      onChangeText={onChange}
      style={shared.input}
    />
  </View>
);

const identity = () => `${binding().generation}:${binding().token}`;
export function RoutineRetryPolicyEditor(props: {
  routineId: string;
  disabled: boolean;
}) {
  return <PolicyBody key={`${identity()}:${props.routineId}`} {...props} />;
}
function PolicyBody({
  routineId,
  disabled,
}: {
  routineId: string;
  disabled: boolean;
}) {
  const owner = useRef(identity()).current,
    mounted = useRef(true),
    sequence = useRef(0),
    lock = useRef(false),
    request = useRef<{ key: string; id: string } | null>(null);
  const current = () => mounted.current && identity() === owner;
  const [page, setPage] = useState<RoutineRetryPolicyPage | null>(null),
    [draft, setDraft] = useState<RoutineRetryPolicy | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const load = async () => {
    if (lock.current || !current()) return;
    lock.current = true;
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const value = await client.routineRetryPolicy(routineId);
      if (current() && ticket === sequence.current) {
        setPage(value);
        setDraft((previous) => previous ?? value.policy);
      }
    } catch {
      if (current() && ticket === sequence.current) {
        setPage(null);
        setError("Couldn't load recovery settings. Try again.");
      }
    } finally {
      if (ticket === sequence.current) {
        lock.current = false;
        if (current()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    lock.current = false;
    void load();
    return () => {
      mounted.current = false;
      ++sequence.current;
      lock.current = false;
    };
  }, []);
  const dirty =
    !!page && !!draft && JSON.stringify(page.policy) !== JSON.stringify(draft);
  const save = async () => {
    if (!page || !draft || !dirty || disabled || lock.current || !current())
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
      if (current()) {
        setPage(value);
        setDraft(value.policy);
        setSaved(true);
      }
    } catch (error) {
      if (current()) {
        if (
          error instanceof HttpError &&
          [401, 403, 404].includes(error.statusCode)
        )
          setPage(null);
        setError(errorMessage(error));
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const field = (
    name: keyof Omit<RoutineRetryPolicy, "enabled">,
    label: string,
  ) => (
    <NumberField
      key={name}
      label={label}
      value={String(draft?.[name] ?? "")}
      disabled={busy || disabled}
      onChange={(value) => {
        setSaved(false);
        setDraft((previous) =>
          previous ? { ...previous, [name]: Number(value) } : previous,
        );
      }}
    />
  );
  return (
    <Block>
      <Heading>Recovery settings</Heading>
      <Copy>
        Retries are off by default. Only qualified failures with no effects can
        retry within these limits. New permissions are never granted.
      </Copy>
      {disabled && (
        <Copy>Save routine changes before editing recovery settings.</Copy>
      )}
      {!!error && <Notice>{error}</Notice>}
      {!page ? (
        <Action
          label={busy ? "Loading…" : "Retry recovery settings"}
          disabled={busy}
          onPress={() => void load()}
        />
      ) : (
        draft && (
          <Block>
            <Toggle
              label="Retry safe failures"
              checked={draft.enabled}
              disabled={busy || disabled}
              onChange={() => {
                setSaved(false);
                setDraft({ ...draft, enabled: !draft.enabled });
              }}
            />
            {draft.enabled && (
              <Block>
                {field(
                  "max_attempts",
                  "Total attempts per occurrence (1–5, including the first)",
                )}
                {field(
                  "token_limit",
                  "Total token allowance (up to 1,000,000)",
                )}
                {field(
                  "max_elapsed_minutes",
                  "Elapsed time limit in minutes (1–1,440)",
                )}
                {field("backoff_seconds", "Retry delay in seconds (5–3,600)")}
              </Block>
            )}
            <Copy>
              Changing this policy holds earlier recovery-enabled occurrences
              for review. Pausing the routine prevents new retry admissions;
              admitted work may finish.
            </Copy>
            <Action
              label={busy ? "Saving…" : "Save recovery settings"}
              disabled={busy || disabled || !dirty}
              onPress={() => void save()}
            />
            <Action
              label="Reload saved recovery settings"
              disabled={busy}
              onPress={() => void load()}
            />
            {saved && <Copy>Recovery settings saved.</Copy>}
          </Block>
        )
      )}
    </Block>
  );
}

export function RoutineOccurrenceDetails(props: {
  routineId: string;
  occurrenceId: string;
  disabled: boolean;
  onOpenChat?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Block>
      <Action
        label={open ? "Hide attempts & recovery" : "Attempts & recovery"}
        disabled={props.disabled}
        onPress={() => setOpen((value) => !value)}
      />
      {open && (
        <RecoveryBody key={`${identity()}:${props.occurrenceId}`} {...props} />
      )}
    </Block>
  );
}
const recoveryStates = {
  active: "Work in progress",
  waiting: "Waiting for you",
  retry_scheduled: "Retry scheduled",
  held: "Held for review",
  limited: "Recovery limit reached",
  completed: "Run finished · Review outcome",
  stopped: "Occurrence stopped",
};
function RecoveryBody({
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
  const owner = useRef(identity()).current,
    mounted = useRef(true),
    sequence = useRef(0),
    lock = useRef(false),
    request = useRef<{ key: string; id: string } | null>(null);
  const current = () => mounted.current && identity() === owner;
  const [data, setData] = useState<RoutineRecovery | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [requested, setRequested] = useState(false);
  const confirmStop = () =>
    new Promise<boolean>((resolve) =>
      Alert.alert(
        "Stop this occurrence?",
        "Requests cancellation of current work and prevents further retries for this occurrence. Existing changes remain.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Stop occurrence", onPress: () => resolve(true) },
        ],
        { onDismiss: () => resolve(false) },
      ),
    );
  const load = async () => {
    if (lock.current || !current()) return;
    lock.current = true;
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const value = await client.routineRecovery(routineId, occurrenceId);
      if (current() && ticket === sequence.current) {
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
    } catch (error) {
      if (current() && ticket === sequence.current) {
        if (
          error instanceof HttpError &&
          [401, 403, 404].includes(error.statusCode)
        )
          setData(null);
        setError("Couldn't refresh this occurrence. Try again.");
        setStale(true);
      }
    } finally {
      if (ticket === sequence.current) {
        lock.current = false;
        if (current()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    lock.current = false;
    void load();
    return () => {
      mounted.current = false;
      ++sequence.current;
      lock.current = false;
    };
  }, []);
  const live =
    data?.recovery === "enabled" &&
    data.visibility === "available" &&
    data.attempts.some((attempt) =>
      ["queued", "running", "waiting"].includes(attempt.state),
    );
  useEffect(() => {
    if (
      !data ||
      data.recovery !== "enabled" ||
      error ||
      (!["active", "waiting", "retry_scheduled"].includes(data.state) &&
        !live &&
        !requested)
    )
      return;
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [
    data?.recovery,
    data?.recovery === "enabled" ? data.state : null,
    live,
    requested,
    error,
  ]);
  const stop = async () => {
    if (
      !data ||
      data.recovery !== "enabled" ||
      disabled ||
      stale ||
      lock.current ||
      !current()
    )
      return;
    lock.current = true;
    const confirmed = await confirmStop();
    lock.current = false;
    if (!confirmed || !current()) return;
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
      if (current()) {
        setData(value);
        setRequested(true);
        setStale(false);
      }
    } catch (error) {
      if (current()) {
        if (
          error instanceof HttpError &&
          [401, 403, 404].includes(error.statusCode)
        )
          setData(null);
        setError(errorMessage(error));
        setStale(true);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <Block>
      {!!error && <Notice>{error}</Notice>}
      <Action
        label={busy ? "Refreshing…" : "Refresh occurrence"}
        disabled={busy}
        onPress={() => void load()}
      />
      {data?.recovery === "legacy" ? (
        <Copy>
          Bounded retries were not enabled for this occurrence. Its existing
          result remains in run history.
        </Copy>
      ) : (
        data?.recovery === "enabled" && (
          <Block>
            <Heading>{recoveryStates[data.state]}</Heading>
            <Copy>{data.reason}</Copy>
            <Copy>
              {data.attempt_count} / {data.policy.max_attempts} attempts ·{" "}
              {data.consumed_tokens} tokens used · {data.reserved_tokens}{" "}
              reserved
            </Copy>
            <Copy>
              Recovery deadline: {new Date(data.deadline).toLocaleString()}
            </Copy>
            {data.state === "retry_scheduled" && data.next_retry_at && (
              <Copy>
                Next retry: {new Date(data.next_retry_at).toLocaleString()}
              </Copy>
            )}
            {requested && (live || data.visibility === "restricted") && (
              <Copy>
                Stop requested. The final state of running work is not yet
                confirmed.
              </Copy>
            )}
            {data.visibility === "restricted" ? (
              <Copy>
                Result details aren’t available.
                {!["completed", "stopped"].includes(data.state) &&
                  " You can still stop this occurrence."}
              </Copy>
            ) : (
              data.attempts.map((attempt) => (
                <Block key={attempt.id}>
                  <Copy>
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
                  </Copy>
                  <Copy>
                    {new Date(attempt.created_at).toLocaleString()} ·{" "}
                    {attempt.resume_count} recovery resumes ·{" "}
                    {attempt.settled_tokens === null
                      ? "Usage pending"
                      : `${attempt.settled_tokens} tokens charged`}
                  </Copy>
                  <Copy>
                    {attempt.retry === "eligible"
                      ? "Failure qualified for bounded retry"
                      : attempt.retry === "reconcile"
                        ? "Reconciliation required"
                        : attempt.retry === "unavailable"
                          ? "Retry evidence unavailable"
                          : "No automatic retry"}
                  </Copy>
                  {attempt.visibility === "restricted" ? (
                    <Copy>Result no longer available</Copy>
                  ) : (
                    <Block>
                      {!!attempt.summary && <Copy>{attempt.summary}</Copy>}
                      {attempt.execution_outcome &&
                        assistantOutcomeDetails(attempt.execution_outcome).map(
                          (line, index) => <Copy key={index}>{line}</Copy>,
                        )}
                      {onOpenChat && (
                        <Action
                          label={
                            attempt.state === "waiting"
                              ? "Open decision"
                              : "Open attempt"
                          }
                          disabled={busy || disabled || stale}
                          onPress={() => {
                            if (current() && !stale)
                              onOpenChat(attempt.chat_id);
                          }}
                        />
                      )}
                    </Block>
                  )}
                </Block>
              ))
            )}
            <Copy>
              Stop affects only this occurrence and its retries. It does not
              pause the routine or undo existing changes.
            </Copy>
            <Action
              label="Stop this occurrence"
              disabled={
                busy ||
                disabled ||
                stale ||
                ["completed", "stopped"].includes(data.state)
              }
              onPress={() => void stop()}
            />
          </Block>
        )
      )}
    </Block>
  );
}

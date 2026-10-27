import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, TextInput } from "react-native";
import type { OvernightNight, OvernightRun } from "@orbyn/core";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { ActionSheet, MoreMenu } from "../../components/MoreMenu";
import { InlineDetails } from "../../components/InlineDetails";
import { Switch } from "../../components/Switch";
import { session } from "../../lib/session";
import { onLive } from "../../lib/live";
import { shared } from "../../styles";
import { colors, themed } from "../../theme";

type Props = {
  nightId?: string;
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  onOpenChat: (id: string) => void;
  onOpenReview: (id: string) => void;
  onOpen: (kind: "task" | "doc" | "project", id: string) => void;
};
/** Morning review on the phone, using the same decisions as web. */
export function OvernightSheet(props: Props) {
  return (
    <OvernightSession
      key={`${session.token}:${props.nightId ?? "latest"}`}
      {...props}
    />
  );
}
function OvernightSession(props: Props) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const active = useRef(props.visible);
  active.current = props.visible;
  const operationLock = useRef(false);
  const readTicket = useRef(0);
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readTicket.current++;
    };
  }, []);
  const [retry, setRetry] = useState(0);
  const [stale, setStale] = useState(false);
  const staleRef = useRef(false);
  const [bulkPrompt, setBulkPrompt] = useState<{
    night: OvernightNight;
    action: "keep" | "undo";
  } | null>(null);
  const [night, setNight] = useState<OvernightNight | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const load = async () => {
    const ticket = ++readTicket.current;
    const value = await client.latestAssistantNight(props.nightId);
    if (!owns() || ticket !== readTicket.current) return;
    setNight(value);
    setLoading(false);
    staleRef.current = false;
    setStale(false);
    setLoadError("");
  };
  useEffect(() => {
    if (!props.visible) return;
    let alive = true;
    setLoading(!night);
    let pending: Promise<void> | null = null;
    let scheduled: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (pending || operationLock.current) return pending;
      const ticket = ++readTicket.current;
      pending = client
        .latestAssistantNight(props.nightId)
        .then(
          (value) => {
            if (alive && owns() && ticket === readTicket.current) {
              staleRef.current = false;
              setStale(false);
              setNight(value);
              setLoading(false);
              setLoadError("");
            }
          },
          (e) => {
            if (alive && owns() && ticket === readTicket.current) {
              setLoadError(errorText(e));
              setLoading(false);
            }
          },
        )
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
    const timer = setInterval(refresh, 15000);
    return () => {
      alive = false;
      readTicket.current++;
      clearTimeout(scheduled);
      stop();
      clearInterval(timer);
    };
  }, [props.visible, props.nightId, retry]);
  const act = async (operation: () => Promise<unknown>): Promise<boolean> => {
    if (!owns() || !active.current || operationLock.current || staleRef.current)
      return false;
    operationLock.current = true;
    readTicket.current++;
    setBusy(true);
    setError("");
    try {
      await operation();
      if (!owns()) return false;
      staleRef.current = true;
      setStale(true);
      try {
        await load();
      } catch (e) {
        if (owns())
          setLoadError(`Action saved. Couldn't refresh: ${errorText(e)}`);
      }
      return true;
    } catch (e) {
      if (owns()) setError(errorText(e));
      return false;
    } finally {
      operationLock.current = false;
      if (owns()) setBusy(false);
    }
  };
  const bulk = (action: "keep" | "undo") => {
    if (night && !busy && !stale) setBulkPrompt({ night, action });
  };
  const locked = busy || stale || loading;
  return (
    <Sheet
      visible={props.visible}
      title="Overnight"
      onClose={props.onClose}
      onDismiss={props.onDismiss}
      closeDisabled={busy}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <ErrorBanner
          error={error}
          onDismiss={() => {
            setError("");
          }}
        />
        {!!loadError && (
          <View>
            <ErrorBanner error={loadError} />
            <Button
              title="Refresh overnight"
              disabled={busy}
              onPress={() => setRetry((n) => n + 1)}
            />
          </View>
        )}
        {loading ? (
          <Text style={shared.small}>Loading overnight…</Text>
        ) : !night && loadError ? null : !night ? (
          <View style={s.section}>
            <Text style={shared.sectionTitle}>No night work yet</Text>
            <Text style={shared.small}>
              Enable night shift in Settings or send a task to Tonight.
            </Text>
          </View>
        ) : (
          <>
            <Text style={shared.sectionTitle}>{night.local_day}</Text>
            <Text style={shared.small}>
              {night.status === "running" ? "In progress" : "Night summary"}
            </Text>
            {night.runs.some((run) => run.kind !== "reflection") && (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  marginVertical: 12,
                }}
              >
                <Button
                  title="Keep all"
                  disabled={
                    locked ||
                    !night.runs.some(
                      (run) =>
                        run.kind !== "reflection" &&
                        !run.restricted &&
                        run.state === "done" &&
                        run.status !== "undone",
                    )
                  }
                  onPress={() => bulk("keep")}
                />
                <Button
                  title="Undo all"
                  secondary
                  disabled={
                    locked ||
                    !night.runs.some(
                      (run) =>
                        run.kind !== "reflection" &&
                        !run.restricted &&
                        ["done", "failed"].includes(run.state) &&
                        run.status !== "undone",
                    )
                  }
                  onPress={() => bulk("undo")}
                />
              </View>
            )}
            {(night.page_runs ?? []).map((run) => (
              <View key={run.id} style={s.section}>
                <Text style={shared.sectionTitle}>
                  Page update · {run.state}
                </Text>
                <InlineDetails title="Usage">
                  <Text style={shared.small}>
                    {run.estimated_tokens} estimated tokens
                  </Text>
                </InlineDetails>
                <Button
                  title={
                    run.state === "waiting" ? "Review in page" : "Open page"
                  }
                  secondary
                  onPress={() => props.onOpen("doc", run.doc_id)}
                />
              </View>
            ))}
            {night.runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                busy={locked}
                act={act}
                {...props}
              />
            ))}
            {!!night.not_done.length && (
              <View style={s.section}>
                <Text style={shared.sectionTitle}>Not done tonight</Text>
                {night.not_done.map((entry, index) => (
                  <View key={index} style={{ marginVertical: 8 }}>
                    <Text style={shared.body}>{entry.title}</Text>
                    <Text style={shared.small}>
                      {entry.reason.replace(/^Not done tonight:\s*/i, "")}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
      <ActionSheet
        visible={!!bulkPrompt}
        label="Review overnight"
        title={
          bulkPrompt?.action === "keep"
            ? "Keep finished work?"
            : "Undo finished work?"
        }
        message={
          bulkPrompt?.action === "keep"
            ? "Applies held changes. Active runs stay open."
            : "Declines held work and restores applied changes where possible. Active runs stay open."
        }
        cancelLabel="Go back"
        actions={[
          {
            label: bulkPrompt?.action === "keep" ? "Keep all" : "Undo all",
            destructive: bulkPrompt?.action === "undo",
            disabled: locked,
            onPress: () => {
              if (!bulkPrompt) return;
              const { night: snapshot, action } = bulkPrompt;
              void act(() =>
                client.reviewAssistantNight(
                  snapshot.id,
                  action,
                  snapshot.runs
                    .filter(
                      (run) =>
                        run.kind !== "reflection" &&
                        !run.restricted &&
                        run.status !== "undone" &&
                        (action === "undo"
                          ? run.state === "done" || run.state === "failed"
                          : run.state === "done"),
                    )
                    .map((run) => ({ id: run.id, token: run.decision_token })),
                ),
              );
            },
          },
        ]}
        onClose={() => setBulkPrompt(null)}
      />
    </Sheet>
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
  act: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [answer, setAnswer] = useState("");
  const mounted = useRef(true);
  const current = useRef({ run, busy, answer });
  current.current = { run, busy, answer };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
  const currentChosen = new Set(
    choices
      .filter((choice) => chosen.has(choice.key))
      .map((choice) => choice.key),
  );
  const pending = run.proposal?.status === "pending";
  const signature = JSON.stringify([
    run.proposal?.id,
    run.decision_token,
    choices,
  ]);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const [keepPrompt, setKeepPrompt] = useState<{
    key: string;
    signature: string;
  } | null>(null);
  const [undoPrompt, setUndoPrompt] = useState<string | null>(null);
  useEffect(() => {
    setKeepPrompt(null);
    setUndoPrompt(null);
  }, [signature]);
  const keepChange = (key: string) => {
    if (
      busy ||
      run.restricted ||
      run.state !== "done" ||
      run.status === "undone"
    )
      return;
    if (choices.length > 1) setKeepPrompt({ key, signature });
    else
      void act(() =>
        client.keepAssistantNightRun(
          run.id,
          run.steps.length ? { steps: [key] } : { only: [Number(key)] },
        ),
      );
  };
  return (
    <View style={s.section}>
      <Text style={shared.sectionTitle}>{run.title}</Text>
      <Text style={shared.small}>
        {run.state === "queued"
          ? "Queued"
          : run.state === "running"
            ? "Working"
            : run.state === "waiting"
              ? "Needs you"
              : run.state === "failed"
                ? "Could not finish"
                : run.kind === "reflection"
                  ? "Reflection ready"
                  : run.status === "partly"
                    ? "Partly kept"
                    : run.status === "undone"
                      ? "Undone"
                      : run.status === "pending"
                        ? "Pending"
                        : "Kept"}
      </Text>
      <Text style={[shared.body, { marginVertical: 12 }]}>
        {run.summary || "Open the chat to see its progress."}
      </Text>
      {!!run.reflection_sources?.length && (
        <InlineDetails title="Sources">
          {run.reflection_sources.map((source) => (
            <Button
              secondary
              key={source.number}
              title={`${source.number}. ${source.title}`}
              onPress={() =>
                source.kind === "chat"
                  ? onOpenChat(source.id)
                  : onOpen("task", source.id)
              }
            />
          ))}
        </InlineDetails>
      )}
      {run.approval && (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <Text style={shared.body}>{run.approval.text}</Text>
          {!!run.approval.summary && (
            <Text style={shared.body}>{run.approval.summary}</Text>
          )}
          {!!run.approval.detail && (
            <Text style={shared.small}>{run.approval.detail}</Text>
          )}
          <Button
            title="Approve"
            disabled={busy}
            onPress={() =>
              void act(() =>
                client.approveAssistantRun(run.job_id, true, run.approval!.id),
              )
            }
          />
          <Button
            title="Decline"
            secondary
            disabled={busy}
            onPress={() =>
              void act(() =>
                client.approveAssistantRun(run.job_id, false, run.approval!.id),
              )
            }
          />
        </View>
      )}
      {run.question && (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <Text style={shared.body}>{run.question.text}</Text>
          {run.question.choices.map((choice) => (
            <Button
              key={choice}
              title={choice}
              secondary
              disabled={busy}
              onPress={() =>
                void act(() =>
                  client.answerAssistantRun(
                    run.job_id,
                    choice,
                    run.question!.id,
                  ),
                )
              }
            />
          ))}
          <TextInput
            style={shared.input}
            accessibilityLabel="Your answer"
            placeholder="Your answer"
            placeholderTextColor={colors.faint}
            maxLength={4000}
            editable={!busy}
            value={answer}
            onChangeText={setAnswer}
          />
          <Button
            title="Answer"
            disabled={busy || !answer.trim()}
            onPress={async () => {
              const submitted = answer;
              const questionId = run.question!.id;
              const saved = await act(() =>
                client.answerAssistantRun(
                  run.job_id,
                  submitted.trim(),
                  questionId,
                ),
              );
              if (
                saved &&
                mounted.current &&
                current.current.run.question?.id === questionId &&
                current.current.answer === submitted
              )
                setAnswer("");
            }}
          />
        </View>
      )}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
        }}
      >
        {run.chat_id && (
          <Button
            title="Open chat"
            secondary
            onPress={() => onOpenChat(run.chat_id!)}
          />
        )}
        {run.proposal && (
          <Button
            title="Open review"
            secondary
            onPress={() => onOpenReview(run.proposal!.id)}
          />
        )}
        {run.kind !== "reflection" && (
          <>
            <Button
              title={
                pending && currentChosen.size < choices.length
                  ? "Keep selected"
                  : "Keep"
              }
              disabled={
                busy ||
                run.state !== "done" ||
                run.restricted ||
                run.status === "undone" ||
                (pending && !currentChosen.size)
              }
              onPress={() =>
                void act(() =>
                  client.keepAssistantNightRun(
                    run.id,
                    pending && currentChosen.size < choices.length
                      ? run.steps.length
                        ? { steps: [...currentChosen] }
                        : { only: [...currentChosen].map(Number) }
                      : {},
                  ),
                )
              }
            />
            <MoreMenu
              label="Run options"
              disabled={busy}
              actions={[
                {
                  label: "Undo work",
                  destructive: true,
                  disabled:
                    !["done", "failed"].includes(run.state) ||
                    run.restricted ||
                    run.status === "undone",
                  onPress: () => setUndoPrompt(signature),
                },
              ]}
            />
          </>
        )}
      </View>
      {run.kind !== "reflection" && (
        <Button
          title={expanded ? "Hide changes" : "Show changes"}
          secondary
          onPress={() => setExpanded(!expanded)}
          style={{ marginTop: 12 }}
        />
      )}
      {run.kind !== "reflection" && expanded && (
        <>
          {pending &&
            choices.map((choice) => (
              <View
                key={choice.key}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 44,
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                <Text style={[shared.body, { flex: 1 }]}>{choice.title}</Text>
                <Switch
                  accessibilityLabel={`Select ${choice.title} to keep`}
                  value={chosen.has(choice.key)}
                  disabled={busy}
                  trackColor={{ true: colors.accent }}
                  onValueChange={(value) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (value) next.add(choice.key);
                      else next.delete(choice.key);
                      return next;
                    })
                  }
                />
                <Button
                  title="Keep change"
                  secondary
                  disabled={
                    busy ||
                    run.state !== "done" ||
                    run.restricted ||
                    run.status === "undone"
                  }
                  onPress={() => keepChange(choice.key)}
                />
              </View>
            ))}
          {run.changes
            .filter((change) => change.undo_until || change.links?.length)
            .map((change) => (
              <View key={change.id} style={{ marginTop: 16, gap: 8 }}>
                <Text style={shared.body}>
                  {change.summary}
                  {change.undone_at ? " · Undone" : ""}
                </Text>
                {change.links?.map((link) => (
                  <Button
                    key={link.kind + link.id}
                    title={link.title}
                    secondary
                    onPress={() => onOpen(link.kind, link.id)}
                  />
                ))}
                {change.undoable && (
                  <Button
                    title="Undo change"
                    secondary
                    disabled={busy}
                    onPress={() =>
                      void act(() =>
                        client.undoAssistantNightRun(run.id, [change.id]),
                      )
                    }
                  />
                )}
              </View>
            ))}
        </>
      )}
      <ActionSheet
        visible={undoPrompt !== null}
        label="Undo work"
        title="Undo this work?"
        message="Held work is declined. Applied changes are restored where possible."
        cancelLabel="Keep work"
        actions={[
          {
            label: "Undo work",
            destructive: true,
            disabled: busy,
            onPress: () => {
              if (
                mounted.current &&
                !current.current.busy &&
                undoPrompt === currentSignature.current
              )
                void act(() => client.undoAssistantNightRun(run.id));
            },
          },
        ]}
        onClose={() => setUndoPrompt(null)}
      />
      <ActionSheet
        visible={keepPrompt !== null}
        label="Keep change"
        title="Keep only this change?"
        message="Other held changes in this run will be left out."
        cancelLabel="Go back"
        actions={[
          {
            label: "Keep change",
            disabled:
              busy ||
              run.restricted ||
              run.state !== "done" ||
              run.status === "undone",
            onPress: () => {
              if (
                keepPrompt !== null &&
                mounted.current &&
                !current.current.busy &&
                keepPrompt.signature === currentSignature.current &&
                choices.some((choice) => choice.key === keepPrompt.key)
              )
                void act(() =>
                  client.keepAssistantNightRun(
                    run.id,
                    run.steps.length
                      ? { steps: [keepPrompt.key] }
                      : { only: [Number(keepPrompt.key)] },
                  ),
                );
            },
          },
        ]}
        onClose={() => setKeepPrompt(null)}
      />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    section: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: 12,
      gap: 8,
    },
  }),
);

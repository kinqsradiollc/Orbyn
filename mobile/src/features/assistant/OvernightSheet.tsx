import { LaneWorkControls } from "./LaneWorkControls";
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, TextInput } from "react-native";
import {
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  type OvernightNight,
  type OvernightRun,
} from "@orbyn/core";
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

/** Bookkeeping status alone does not establish any proposed or applied changes. */
const hasChangeEvidence = (run: OvernightRun) =>
  !run.restricted &&
  run.kind !== "reflection" &&
  !!(run.proposal || run.steps.length || run.changes.length);

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
  const [historyLimit, setHistoryLimit] = useState(10);
  const [stale, setStale] = useState(false);
  const staleRef = useRef(false);
  const [bulkPrompt, setBulkPrompt] = useState<{
    night: OvernightNight;
    action: "keep" | "undo";
  } | null>(null);
  const [pageStop, setPageStop] = useState<{
    docId: string;
    runId: string;
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
  const locked = busy || stale || loading || !!loadError;
  const reviewRuns =
    night?.runs.filter(
      (run) =>
        run.status !== "undone" &&
        (run.state === "waiting" ||
          run.state === "failed" ||
          !!run.question ||
          !!run.approval ||
          run.proposal?.status === "pending" ||
          (run.execution_outcome &&
            [
              "partial",
              "waiting",
              "failed",
              "interrupted",
              "uncertain",
            ].includes(run.execution_outcome.outcome))),
    ) ?? [];
  const activeRuns =
    night?.runs.filter(
      (run) =>
        !reviewRuns.includes(run) && ["queued", "running"].includes(run.state),
    ) ?? [];
  const historyRuns =
    night?.runs.filter(
      (run) => !reviewRuns.includes(run) && !activeRuns.includes(run),
    ) ?? [];
  const currentPages = (night?.page_runs ?? []).filter(
    (run) => run.state !== "done" && run.state !== "cancelled",
  );
  const historyPages = (night?.page_runs ?? []).filter(
    (run) => run.state === "done" || run.state === "cancelled",
  );
  const historicalCount = historyRuns.length + historyPages.length;
  const renderRun = (run: OvernightRun) => (
    <RunCard key={run.id} run={run} busy={locked} act={act} {...props} />
  );
  return (
    <Sheet
      visible={props.visible}
      title="Overnight"
      onClose={props.onClose}
      onDismiss={props.onDismiss}
      closeDisabled={busy}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <LaneWorkControls lane="overnight" visible={props.visible} />
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
            <Text style={shared.sectionTitle}>Overnight review</Text>
            <Text style={shared.small}>
              {night.local_day} · {reviewRuns.length} to review ·{" "}
              {activeRuns.length} active
            </Text>
            <Text style={shared.small}>
              {night.status === "running" ? "In progress" : "Night summary"}
            </Text>
            {night.runs.some(
              (run) =>
                hasChangeEvidence(run) &&
                ["done", "failed"].includes(run.state) &&
                run.status !== "undone",
            ) && (
              <InlineDetails title="Review finished runs">
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
                          hasChangeEvidence(run) &&
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
                          hasChangeEvidence(run) &&
                          !run.restricted &&
                          ["done", "failed"].includes(run.state) &&
                          run.status !== "undone",
                      )
                    }
                    onPress={() => bulk("undo")}
                  />
                </View>
              </InlineDetails>
            )}
            {reviewRuns.length > 0 && (
              <View style={{ gap: 12 }}>
                <Text style={shared.sectionTitle}>Review first</Text>
                {reviewRuns.map(renderRun)}
              </View>
            )}
            {currentPages.map((run) => (
              <View key={run.id} style={s.section}>
                <Text style={shared.sectionTitle}>
                  Page update ·{" "}
                  {run.state === "waiting"
                    ? "Waiting for review"
                    : run.state === "failed"
                      ? "Run failed"
                      : run.state === "queued"
                        ? "Queued"
                        : "Running"}
                </Text>
                <Button
                  title={
                    run.state === "waiting" ? "Review in page" : "Open page"
                  }
                  secondary
                  onPress={() => props.onOpen("doc", run.doc_id)}
                />
                {["queued", "running", "waiting"].includes(run.state) && (
                  <Button
                    title="Stop this page run"
                    secondary
                    disabled={locked}
                    onPress={() =>
                      setPageStop({ docId: run.doc_id, runId: run.id })
                    }
                  />
                )}
              </View>
            ))}
            {activeRuns.length > 0 && (
              <View style={{ gap: 12 }}>
                <Text style={shared.sectionTitle}>Running &amp; queued</Text>
                {activeRuns.map(renderRun)}
              </View>
            )}
            {historicalCount > 0 && (
              <InlineDetails
                title={`Finished run history · ${historicalCount}`}
              >
                {historyRuns.slice(0, historyLimit).map(renderRun)}
                {historyPages
                  .slice(0, Math.max(0, historyLimit - historyRuns.length))
                  .map((run) => (
                    <View key={run.id} style={s.section}>
                      <Text style={shared.body}>
                        Page update ·{" "}
                        {run.state === "cancelled"
                          ? "Cancelled"
                          : "Run finished"}
                      </Text>
                      <Button
                        title="Open page"
                        secondary
                        onPress={() => props.onOpen("doc", run.doc_id)}
                      />
                    </View>
                  ))}
                {historicalCount > historyLimit && (
                  <Button
                    title="Show 10 more results"
                    secondary
                    onPress={() => setHistoryLimit((value) => value + 10)}
                  />
                )}
              </InlineDetails>
            )}
            {!!night.not_done.length && (
              <View style={s.section}>
                <Text style={shared.sectionTitle}>Unfinished work</Text>
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
        visible={!!pageStop}
        label="Stop current page work"
        title="Stop this page run?"
        message="Stops this run and discards its unapplied proposal. The routine schedule and changes already saved are kept."
        actions={[
          {
            label: "Stop run",
            destructive: true,
            disabled: locked,
            onPress: () => {
              const selected = pageStop;
              setPageStop(null);
              if (selected)
                void act(() =>
                  client.stopPageMaintenanceRun(selected.docId, selected.runId),
                );
            },
          },
        ]}
        onClose={() => setPageStop(null)}
      />
      <ActionSheet
        visible={!!bulkPrompt}
        label="Review overnight"
        title={
          bulkPrompt?.action === "keep"
            ? "Keep finished runs?"
            : "Undo finished runs?"
        }
        message={
          bulkPrompt?.action === "keep"
            ? "Keeps results and applies any held changes. Active runs stay open."
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
  const [stopPrompt, setStopPrompt] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
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
  const hasChanges = hasChangeEvidence(run);
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
      </Text>
      {hasChanges && (
        <Text style={shared.small}>
          Changes{" "}
          {run.status === "partly"
            ? "partly kept"
            : run.status === "pending"
              ? "pending review"
              : run.status === "undone"
                ? "undone"
                : "kept"}
        </Text>
      )}

      <Text
        style={[shared.body, { marginVertical: 12 }]}
        numberOfLines={
          !summaryExpanded && run.summary.length > 360 ? 4 : undefined
        }
      >
        {run.summary || "Open the work to inspect its current result."}
      </Text>
      {run.summary.length > 360 && (
        <Button
          title={summaryExpanded ? "Show less" : "Read full result"}
          secondary
          onPress={() => setSummaryExpanded((value) => !value)}
        />
      )}
      {run.execution_outcome && (
        <InlineDetails title="Evidence & open questions">
          {assistantOutcomeDetails(run.execution_outcome).map((line, index) => (
            <Text key={index} style={shared.small}>
              {line}
            </Text>
          ))}
        </InlineDetails>
      )}
      {!run.restricted &&
        ["queued", "running", "waiting"].includes(run.state) && (
          <>
            <Button
              title={
                stopRequested || run.cancel_requested
                  ? "Stop requested"
                  : "Stop this run"
              }
              secondary
              disabled={busy || run.cancel_requested || stopRequested}
              onPress={() => setStopPrompt(true)}
            />
            <ActionSheet
              visible={stopPrompt}
              label="Stop current run"
              title="Stop this run?"
              message="Requests cancellation. Changes already applied remain available for review and undo."
              actions={[
                {
                  label: "Stop run",
                  destructive: true,
                  disabled: busy,
                  onPress: () => {
                    const live = current.current;
                    if (
                      live.busy ||
                      live.run.cancel_requested ||
                      !["queued", "running", "waiting"].includes(live.run.state)
                    )
                      return;
                    setStopPrompt(false);
                    void act(async () => {
                      await client.stopAssistantRun(live.run.job_id);
                      if (mounted.current) setStopRequested(true);
                    });
                  },
                },
              ]}
              onClose={() => setStopPrompt(false)}
            />
          </>
        )}
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
            title="Open work"
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
        {hasChanges && (
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
      {hasChanges && (
        <Button
          title={expanded ? "Hide changes" : "Show changes"}
          secondary
          onPress={() => setExpanded(!expanded)}
          style={{ marginTop: 12 }}
        />
      )}
      {hasChanges && expanded && (
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

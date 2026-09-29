import React, { useEffect, useState } from "react";
import { ScrollView, Text, View, Switch } from "react-native";
import type { OvernightNight, OvernightRun } from "@orbyn/core";
import { Sheet, sheetStyles } from "../components/Sheet";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import { confirmAction } from "../lib/confirm";
import { onLive } from "../lib/live";
import { shared } from "../styles";
import { colors } from "../theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  onOpenChat: (id: string) => void;
  onOpenReview: (id: string) => void;
  onOpen: (kind: "task" | "doc" | "project", id: string) => void;
};
/** Morning review on the phone, using the same decisions as web. */
export function OvernightSheet(props: Props) {
  const [night, setNight] = useState<OvernightNight | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setNight(await client.latestAssistantNight());
    setLoading(false);
  };
  useEffect(() => {
    if (!props.visible) return;
    let alive = true;
    const refresh = () =>
      client.latestAssistantNight().then(
        (value) => {
          if (alive) {
            setNight(value);
            setLoading(false);
          }
        },
        (e) => {
          if (alive) setError(errorText(e));
        },
      );
    void refresh();
    const stop = onLive((event) => {
      if (event.kind === "changed") void refresh();
    });
    const timer = setInterval(refresh, 15000);
    return () => {
      alive = false;
      stop();
      clearInterval(timer);
    };
  }, [props.visible]);
  const act = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const bulk = (action: "keep" | "undo") => {
    if (!night) return;
    confirmAction(
      action === "keep" ? "Keep all finished work?" : "Undo all finished work?",
      action === "keep"
        ? "Held changes will be applied. Runs still working or waiting for your answer stay open."
        : "Held work will be declined and applied changes will be undone where they can still be restored. Active runs stay open.",
      action === "keep" ? "Keep all" : "Undo all",
      () => void act(() => client.reviewAssistantNight(night.id, action)),
      action === "undo",
    );
  };
  return (
    <Sheet
      visible={props.visible}
      title="Overnight"
      onClose={props.onClose}
      onDismiss={props.onDismiss}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        {loading ? (
          <Text style={shared.small}>Loading your night…</Text>
        ) : !night ? (
          <View style={shared.card}>
            <Text style={shared.sectionTitle}>No night work yet</Text>
            <Text style={shared.small}>
              Turn on night shift in Assistant settings, or hand over a task for
              Tonight.
            </Text>
          </View>
        ) : (
          <>
            <Text style={shared.sectionTitle}>{night.local_day}</Text>
            <Text style={shared.small}>
              {night.status === "running"
                ? "Your night is still in progress."
                : "Here is what happened overnight."}
            </Text>
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
                disabled={busy || !night.runs.length}
                onPress={() => bulk("keep")}
              />
              <Button
                title="Undo all"
                secondary
                disabled={busy || !night.runs.length}
                onPress={() => bulk("undo")}
              />
            </View>
            {night.runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                busy={busy}
                act={act}
                {...props}
              />
            ))}
            {!!night.not_done.length && (
              <View style={shared.card}>
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
  act: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
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
  return (
    <View style={[shared.card, { marginBottom: 12 }]}>
      <Text style={shared.sectionTitle}>{run.title}</Text>
      <Text style={shared.small}>
        {["queued", "running"].includes(run.state)
          ? "Working"
          : run.state === "waiting"
            ? "Needs you"
            : run.state === "failed"
              ? "Could not finish"
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {run.chat_id && (
          <Button
            title="Open chat"
            secondary
            onPress={() => onOpenChat(run.chat_id!)}
          />
        )}
        {run.proposal && (
          <Button
            title="Open Review"
            secondary
            onPress={() => onOpenReview(run.proposal!.id)}
          />
        )}
        <Button
          title={
            pending && chosen.size < choices.length ? "Keep selected" : "Keep"
          }
          disabled={
            busy ||
            run.state !== "done" ||
            run.status === "undone" ||
            (pending && !chosen.size)
          }
          onPress={() =>
            void act(() =>
              client.keepAssistantNightRun(
                run.id,
                pending && chosen.size < choices.length
                  ? run.steps.length
                    ? { steps: [...chosen] }
                    : { only: [...chosen].map(Number) }
                  : {},
              ),
            )
          }
        />
        <Button
          title="Undo"
          secondary
          disabled={
            busy ||
            !["done", "failed"].includes(run.state) ||
            run.status === "undone"
          }
          onPress={() => void act(() => client.undoAssistantNightRun(run.id))}
        />
      </View>
      <Button
        title={expanded ? "Hide changes" : "Show changes"}
        secondary
        onPress={() => setExpanded(!expanded)}
        style={{ marginTop: 12 }}
      />
      {expanded && (
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
                  marginTop: 8,
                }}
              >
                <Text style={[shared.body, { flex: 1 }]}>{choice.title}</Text>
                <Switch
                  accessibilityLabel={`Keep ${choice.title}`}
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
    </View>
  );
}

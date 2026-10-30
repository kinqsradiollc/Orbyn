import { reviewNightRuns, updateStatusLabel } from "./assistant-labels";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type {
  AssistantConversationDetails,
  AssistantSource,
} from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { shared } from "../../styles";

export function ConversationDetails({
  destinationId,
  entryId,
  revision,
  onClose,
  onSource,
  onWork,
  onActivity,
  onRefresh,
}: {
  destinationId: string;
  entryId: string;
  revision: string;
  onClose: () => void;
  onRefresh: () => void;
  onSource?: (source: AssistantSource) => void;
  onWork: (id: string) => void;
  onActivity: (lane: "background" | "overnight") => void;
}) {
  const [result, setResult] = useState<AssistantConversationDetails | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [after, setAfter] = useState<(() => void) | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const owner = session.token,
      controller = new AbortController();
    setResult(null);
    setError(false);
    void client
      .assistantConversationDetails(destinationId, entryId, controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted && session.token === owner)
            setResult(value);
        },
        () => {
          if (!controller.signal.aborted && session.token === owner)
            setError(true);
        },
      );
    return () => controller.abort();
  }, [destinationId, entryId, revision]);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState(false);
  const entry = result?.entry;
  const navigate = (action: () => void) => {
    setAfter(() => action);
    setOpen(false);
  };
  return (
    <BottomSheet
      visible={open}
      title="Details"
      onClose={() => setOpen(false)}
      afterClose={() => {
        onClose();
        after?.();
      }}
    >
      {error ? (
        <Text accessibilityRole="alert" style={shared.body}>
          This message is no longer available. Close details and refresh the
          conversation.
        </Text>
      ) : !entry ? (
        <Text accessibilityLiveRegion="polite" style={shared.body}>
          Loading details…
        </Text>
      ) : (
        <View style={{ gap: 16 }}>
          <Text style={shared.small}>
            Delivered · {new Date(entry.created_at).toLocaleString()}
          </Text>
          {entry.kind === "update" && (
            <>
              <Text style={shared.body}>{updateStatusLabel(entry)}</Text>
              {!!entry.completed_at && (
                <Text style={shared.small}>
                  Run finished · {new Date(entry.completed_at).toLocaleString()}
                </Text>
              )}
              {reviewNightRuns(entry).map((run) => (
                <View
                  key={`${run.work.kind}:${run.work.id}`}
                  style={{ gap: 8 }}
                >
                  <Text style={shared.small}>
                    {run.state === "done"
                      ? "Run finished"
                      : run.state === "waiting"
                        ? "Needs you"
                        : run.state === "failed"
                          ? "Couldn’t finish"
                          : run.state === "cancelled"
                            ? "Stopped"
                            : run.state === "queued"
                              ? "Queued"
                              : "Working"}
                  </Text>
                  <Text selectable style={shared.body}>
                    {run.text}
                  </Text>
                </View>
              ))}
              <SmallAction
                label={entry.execution_chat_id ? "View work" : "View activity"}
                disabled={false}
                onPress={() =>
                  navigate(() =>
                    entry.execution_chat_id
                      ? onWork(entry.execution_chat_id)
                      : onActivity(entry.lane),
                  )
                }
              />
            </>
          )}
          {entry.kind === "update" &&
            entry.work.kind === "job" &&
            entry.event === "question" &&
            entry.actionable !== false && (
              <SmallAction
                label="Stop work"
                destructive
                disabled={stopping}
                onPress={() => {
                  setStopping(true);
                  setStopError(false);
                  void client
                    .stopAssistantRun(entry.work.id)
                    .then(onRefresh, () => setStopError(true))
                    .finally(() => setStopping(false));
                }}
              />
            )}
          {stopError && (
            <Text accessibilityRole="alert" style={shared.body}>
              Couldn’t stop this work. Try again.
            </Text>
          )}
          {!!result?.sources.length && (
            <Text style={shared.body} accessibilityRole="header">
              Sources
            </Text>
          )}
          {result?.sources.map((source) => (
            <SmallAction
              key={`${source.kind}:${source.id}`}
              label={source.title}
              disabled={!onSource || source.kind === "project"}
              onPress={() =>
                navigate(() => {
                  if (source.kind === "doc")
                    onSource?.({
                      doc_id: source.id,
                      block_id: null,
                      title: source.title,
                      quote: "",
                    });
                  else if (source.kind === "task")
                    onSource?.({
                      kind: "task",
                      id: source.id,
                      title: source.title,
                      quote: "",
                    });
                })
              }
            />
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

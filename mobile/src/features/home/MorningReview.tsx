import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { AssistantProfileStore } from "@orbyn/api-client";
import {
  groupAssistantReview,
  assistantReviewGroupSummary,
  assistantOutcomeDetails,
  type AssistantMorningReviewItem,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session, subscribeSession } from "../../lib/session";
import { InlineDetails } from "../../components/InlineDetails";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";
import { colors, themed } from "../../theme";

const sessionKey = () =>
  session.token ? `${session.generation}:${session.token}` : "";

type Lane = "background" | "overnight";

/** Native presentation of the same bounded, current-access profile receipts. */
export function MorningReview({
  onOpenActivity,
  onOpenChat,
  onOpenReview,
}: {
  onOpenActivity: (lane: Lane) => void;
  onOpenChat?: (id: string) => void;
  onOpenReview?: () => void;
}) {
  const owner = useSyncExternalStore(subscribeSession, sessionKey);
  const store = useMemo(
    () => new AssistantProfileStore(client, sessionKey),
    [owner],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [owner]);
  useEffect(() => {
    const refresh = () => {
      if (owner && sessionKey() === owner && AppState.currentState === "active")
        void store.refresh();
    };
    refresh();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const timer = setInterval(refresh, 60_000);
    return () => {
      listener.remove();
      clearInterval(timer);
      store.reset();
    };
  }, [store, owner]);
  if (!owner) return null;
  const groups = snapshot.data ? groupAssistantReview(snapshot.data) : [];
  if (snapshot.data && !snapshot.error && !groups.length) return null;
  const open = (row: AssistantMorningReviewItem) => {
    if (sessionKey() !== owner) return;
    if (row.target === "review" && onOpenReview) onOpenReview();
    else if (row.chatId && onOpenChat) onOpenChat(row.chatId);
    else onOpenActivity(row.lane);
  };
  const renderRow = (row: AssistantMorningReviewItem) => (
    <View key={row.id} style={s.row}>
      <Text style={shared.body}>{row.title}</Text>
      <Text style={shared.small}>{row.detail}</Text>
      {row.at && (
        <Text style={shared.small}>{new Date(row.at).toLocaleString()}</Text>
      )}
      {row.summary && (
        <Text style={shared.small}>
          {row.summary.length > 240
            ? `${row.summary.slice(0, 240)}…`
            : row.summary}
        </Text>
      )}
      {row.summary && row.summary.length > 240 && (
        <InlineDetails title="Full result summary">
          <Text style={shared.body}>{row.summary}</Text>
        </InlineDetails>
      )}
      {row.execution_outcome && (
        <InlineDetails title="Evidence & open questions">
          {assistantOutcomeDetails(row.execution_outcome).map((line, index) => (
            <Text key={index} style={shared.small}>
              {line}
            </Text>
          ))}
        </InlineDetails>
      )}
      <SmallAction
        label={row.action}
        disabled={false}
        onPress={() => open(row)}
      />
    </View>
  );
  const kinds = {
    goal: "Goal",
    routine: "Routine",
    project: "Project",
    task: "Task",
    chat: "Conversation",
    activity: "Activity",
  };
  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={shared.sectionTitle} accessibilityRole="header">
          Since you were away
        </Text>
        <SmallAction
          quiet
          label={
            snapshot.loading
              ? "Refreshing…"
              : snapshot.error
                ? "Retry"
                : "Refresh"
          }
          disabled={snapshot.loading}
          onPress={() => {
            if (sessionKey() === owner) void store.refresh();
          }}
        />
      </View>
      <Text style={shared.small}>
        Latest results and active work, grouped by source.
      </Text>
      {snapshot.data && (
        <Text style={shared.small}>
          Observed {new Date(snapshot.data.observed_at).toLocaleString()}
        </Text>
      )}
      {snapshot.error ? (
        <Text style={shared.body} accessibilityRole="alert">
          Couldn’t load recent agent work. Try again.
        </Text>
      ) : !snapshot.data ? (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Loading recent agent work…
        </Text>
      ) : (
        <>
          {(showAll ? groups : groups.slice(0, 4)).map((group) => (
            <View key={group.id} style={s.group}>
              <Text style={shared.small}>{kinds[group.kind]}</Text>
              <Text style={shared.body} accessibilityRole="header">
                {group.title}
              </Text>
              <Text style={shared.small}>
                {assistantReviewGroupSummary(group)}
              </Text>
              <InlineDetails
                title={`Review ${group.items.length} ${group.items.length === 1 ? "run" : "runs"} for ${group.title}`}
              >
                {group.items.map(renderRow)}
              </InlineDetails>
            </View>
          ))}
          {groups.length > 4 && (
            <SmallAction
              label={
                showAll
                  ? "Show fewer groups"
                  : `Show all recent work (${groups.length} groups)`
              }
              disabled={false}
              onPress={() => setShowAll((value) => !value)}
            />
          )}
          {snapshot.data.profiles.some(
            (profile) => profile.work_truncated || profile.outputs_truncated,
          ) && (
            <Text style={shared.small}>
              More runs are available in agent activity and Review. This review
              shows the latest results and a bounded list of active work.
            </Text>
          )}
          <View style={s.header}>
            {onOpenReview && (
              <SmallAction
                quiet
                label="All decisions & changes"
                disabled={false}
                onPress={() => {
                  if (sessionKey() === owner) onOpenReview();
                }}
              />
            )}
            {(["background", "overnight"] as const).map((lane) => (
              <SmallAction
                key={lane}
                quiet
                label={
                  lane === "background"
                    ? "Background activity"
                    : "Overnight activity"
                }
                disabled={false}
                onPress={() => {
                  if (sessionKey() === owner) onOpenActivity(lane);
                }}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    section: { gap: 8, marginBottom: 20 },
    header: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    group: { gap: 6, paddingTop: 12 },
    row: {
      gap: 6,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      alignItems: "flex-start",
    },
  }),
);

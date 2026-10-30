import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { AssistantProfileStore } from "@orbyn/api-client";
import { recentAssistantWork, type AssistantReviewRow } from "@orbyn/core";
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
}: {
  onOpenActivity: (lane: Lane) => void;
  onOpenChat?: (id: string) => void;
}) {
  const owner = useSyncExternalStore(subscribeSession, sessionKey);
  const store = useMemo(
    () => new AssistantProfileStore(client, sessionKey),
    [owner],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
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
  const rows = snapshot.data ? recentAssistantWork(snapshot.data) : [];
  const active = rows.filter((row) => !row.chatId);
  const finished = rows.filter((row) => row.chatId);
  const finishedLabel = `Finished run history · latest ${finished.length}${finished[0]?.at ? ` · ${new Date(finished[0].at).toLocaleDateString()}` : ""}`;
  if (snapshot.data && !snapshot.error && !rows.length) return null;
  const open = (row: AssistantReviewRow) => {
    if (sessionKey() !== owner) return;
    if (row.chatId && onOpenChat) onOpenChat(row.chatId);
    else onOpenActivity(row.lane);
  };
  const renderRow = (row: AssistantReviewRow) => (
    <View key={row.id} style={s.row}>
      <Text style={shared.body}>{row.title}</Text>
      <Text style={shared.small}>{row.detail}</Text>
      {row.at && (
        <Text style={shared.small}>{new Date(row.at).toLocaleString()}</Text>
      )}
      <SmallAction
        label={row.action}
        disabled={false}
        onPress={() => open(row)}
      />
    </View>
  );
  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={shared.sectionTitle} accessibilityRole="header">
          Recent agent work
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
          {active.slice(0, 6).map(renderRow)}
          {active.length > 6 && (
            <Text style={shared.small}>
              Showing 6 of {active.length} activity entries.
            </Text>
          )}
          {finished.length > 0 && (
            <InlineDetails title={finishedLabel}>
              {finished.map(renderRow)}
            </InlineDetails>
          )}
          <View style={s.header}>
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
    row: {
      gap: 6,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      alignItems: "flex-start",
    },
  }),
);

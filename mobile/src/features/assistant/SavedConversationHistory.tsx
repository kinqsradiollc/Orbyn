import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppState, ScrollView, Text, View } from "react-native";
import { AssistantSavedHistoryStore } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";

export function SavedConversationHistory({
  destinationId,
  chatId,
  onClose,
}: {
  destinationId: string;
  chatId: string;
  onClose: () => void;
}) {
  const owner = session.token;
  const store = useMemo(
    () =>
      new AssistantSavedHistoryStore(
        client,
        destinationId,
        chatId,
        () => session.token,
      ),
    [destinationId, chatId, owner],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const scroll = useRef<ScrollView>(null),
    initial = useRef(false);
  useEffect(() => {
    initial.current = false;
    void store.refresh();
    const validate = () => {
      if (AppState.currentState === "active") void store.validate();
    };
    const timer = setInterval(validate, 15000);
    const stop = AppState.addEventListener("change", validate);
    return () => {
      clearInterval(timer);
      stop.remove();
      store.reset();
    };
  }, [store]);
  return (
    <Sheet visible title="Previous saved history" onClose={onClose}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={sheetStyles.body}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        onContentSizeChange={() => {
          if (!initial.current && state.turns.length) {
            scroll.current?.scrollToEnd({ animated: false });
            initial.current = true;
          }
        }}
      >
        {state.error ? (
          <View>
            <Text accessibilityRole="alert" style={shared.body}>
              Saved history changed or is unavailable.
            </Text>
            <SmallAction
              label="Reload"
              disabled={state.busy}
              onPress={() => void store.refresh()}
            />
          </View>
        ) : (
          <>
            {state.before !== null && (
              <SmallAction
                label="Earlier messages"
                disabled={state.busy}
                onPress={() => void store.loadEarlier()}
              />
            )}
            {state.busy && (
              <Text style={shared.small}>Loading saved history…</Text>
            )}
            {!state.busy && !state.turns.length && (
              <Text style={shared.body}>No earlier saved messages.</Text>
            )}
            {state.turns.map((turn, index) => (
              <View
                key={`${index}:${turn.turn_id ?? turn.role}`}
                style={{ gap: 8, marginVertical: 12 }}
              >
                <Text style={shared.small}>
                  {turn.role === "user" ? "You" : "Assistant"}
                </Text>
                <Text selectable style={shared.body}>
                  {turn.text}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

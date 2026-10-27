import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { AssistantControlsStore } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { InlineDetails } from "../../components/InlineDetails";
import { Switch } from "../../components/Switch";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";

export function AssistantControls({
  deliveryEnabled,
}: {
  deliveryEnabled: boolean;
}) {
  const store = useMemo(
    () =>
      new AssistantControlsStore(client, () => session.token, deliveryEnabled),
    [deliveryEnabled],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
    return () => store.reset();
  }, [store]);
  return (
    <InlineDetails title="Assistant controls">
      {state.error ? (
        <View>
          <Text accessibilityRole="alert" style={shared.small}>
            Couldn't load controls.
          </Text>
          <SmallAction
            label="Retry"
            disabled={state.busy}
            onPress={() => void store.refresh()}
          />
        </View>
      ) : !state.data ? (
        <Text style={shared.small}>Loading controls…</Text>
      ) : (
        <>
          {(
            [
              ["muted", "Mute update alerts"],
              ["background_paused", "Pause new Background work"],
              ["overnight_paused", "Pause new Overnight work"],
            ] as const
          )
            .filter(([key]) => key !== "muted" || deliveryEnabled)
            .map(([key, label]) => (
              <View
                key={key}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 8,
                }}
              >
                <Text style={[shared.body, { flex: 1 }]}>{label}</Text>
                <Switch
                  accessibilityLabel={label}
                  value={state.data![key]}
                  disabled={state.busy}
                  onValueChange={(value) => void store.set(key, value)}
                />
              </View>
            ))}
          <Text style={shared.small}>
            Admitted work continues. Stop individual jobs in Activity.
          </Text>
        </>
      )}
    </InlineDetails>
  );
}

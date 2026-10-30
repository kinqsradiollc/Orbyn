import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { AssistantControlsStore } from "@orbyn/api-client";
import { Switch } from "../../components/Switch";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { session, subscribeSession } from "../../lib/session";
import { shared } from "../../styles";

const binding = () => `${session.generation}:${session.token}`;

/** Admission pause never represents a confirmed stop of current work. */
export function LaneWorkControls({
  lane,
  visible = true,
}: {
  lane: "background" | "overnight";
  visible?: boolean;
}) {
  const owner = useSyncExternalStore(subscribeSession, binding);
  const store = useMemo(
    () => new AssistantControlsStore(client, binding, false),
    [owner],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    if (visible) void store.refresh();
    return () => store.reset();
  }, [store, visible]);
  const key = lane === "background" ? "background_paused" : "overnight_paused";
  const name = lane === "background" ? "Background" : "Overnight";
  return (
    <View style={{ gap: 8 }}>
      {state.error ? (
        <>
          <Text style={shared.small} accessibilityRole="alert">
            Couldn’t load work controls.
          </Text>
          <SmallAction
            quiet
            label="Retry controls"
            disabled={state.busy}
            onPress={() => void store.refresh()}
          />
        </>
      ) : !state.data ? (
        <Text style={shared.small}>Loading work controls…</Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={[shared.body, { flex: 1 }]}>
              Pause new {name} work
            </Text>
            <Switch
              accessibilityLabel={`Pause new ${name} work`}
              value={state.data[key]}
              disabled={state.busy}
              onValueChange={(value) => {
                if (binding() === owner) void store.set(key, value);
              }}
            />
          </View>
          <Text style={shared.small}>
            Running work continues. Stop a run separately.
          </Text>
        </>
      )}
    </View>
  );
}

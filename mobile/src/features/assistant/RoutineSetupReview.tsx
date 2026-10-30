import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { RoutineSetupStore } from "@orbyn/api-client";
import {
  ASSISTANT_CHANGE_KINDS,
  describeRrule,
  type AgentRoutineInput,
  type ApprovalScopes,
  type AssistantChangeKind,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { CHANGE_KIND_LABELS } from "./assistant-labels";
import { Button } from "../../components/Button";
import { Switch } from "../../components/Switch";
import { InlineDetails } from "../../components/InlineDetails";
import { shared } from "../../styles";
const binding = () => `${session.generation}:${session.token}`;
export function RoutineSetupReview({
  input,
  active = true,
  ruleLabel,
  onBack,
  onSaved,
  onBusy,
  onUncertain,
  onCheckUpcoming,
}: {
  input: AgentRoutineInput;
  active?: boolean;
  ruleLabel: (rule: ApprovalScopes[AssistantChangeKind]) => string;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onUncertain: (value: boolean) => void;
  onCheckUpcoming: () => void;
}) {
  const [store] = useState(
    () =>
      new RoutineSetupStore(client, input, () => Crypto.randomUUID(), binding),
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.load();
    return () => store.dispose();
  }, [store]);
  useEffect(() => onBusy(state.saving), [state.saving, onBusy]);
  useEffect(() => onUncertain(state.uncertain), [state.uncertain, onUncertain]);
  const reported = useRef(false);
  useEffect(() => {
    if (active && state.result && !reported.current) {
      reported.current = true;
      void onSaved();
    }
  }, [active, state.result, onSaved]);
  const save = () => store.save();
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Review routine setup">
      <Text style={shared.sectionTitle} accessibilityRole="header">
        Review routine
      </Text>
      <Text style={shared.body}>{input.instruction}</Text>
      <Text style={shared.small}>
        {describeRrule(input.rrule)} ·{" "}
        {new Date(input.next_run_at).toLocaleString()} · {input.timezone}
      </Text>
      <Text style={shared.sectionTitle} accessibilityRole="header">
        Execution scope
      </Text>
      <Text style={shared.body}>
        Uses your assistant’s current access across all permitted projects and
        spaces. Its existing rules still apply.
      </Text>
      {state.loading && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Loading current permissions…
        </Text>
      )}
      {!!state.error && (
        <Text style={shared.small} accessibilityRole="alert">
          {state.error}
        </Text>
      )}
      {state.context && (
        <>
          <Text style={shared.small}>
            Each run has a maximum of{" "}
            {state.context.max_run_tokens.toLocaleString()} tokens. Account and
            Overnight limits can stop it sooner. Retries are off until you
            configure recovery.
          </Text>
          <InlineDetails title="Automatic changes · optional">
            <Text style={shared.small}>
              Unchecked categories keep their saved settings. “Always”
              permissions still apply. Sensitive actions follow your current
              assistant rules.
            </Text>
            {!state.context.can_preauthorize && (
              <Text style={shared.small}>
                Automatic permissions are unavailable with your current
                assistant access. You can still save the schedule.
              </Text>
            )}
            {ASSISTANT_CHANGE_KINDS.map((kind) => {
              const prior = state.context!.approval_scopes[kind],
                selected = state.selected.includes(kind),
                label = `Allow ${CHANGE_KIND_LABELS[kind].toLowerCase()} for this routine`;
              return (
                <View style={{ gap: 6, marginVertical: 8 }} key={kind}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <Text style={[shared.body, { flex: 1 }]}>{label}</Text>
                    <Switch
                      accessibilityLabel={label}
                      disabled={
                        !state.context!.can_preauthorize ||
                        state.saving ||
                        state.uncertain ||
                        !!state.result
                      }
                      value={selected}
                      onValueChange={(enabled) => store.select(kind, enabled)}
                    />
                  </View>
                  {prior && (
                    <Text style={shared.small}>
                      Saved permission: {ruleLabel(prior)}.
                    </Text>
                  )}
                  {selected && prior && (
                    <Text style={shared.small} accessibilityLiveRegion="polite">
                      Replaces this category’s saved permission. The previous
                      goal, routine or Always setting will use normal approval
                      checks.
                    </Text>
                  )}
                </View>
              );
            })}
          </InlineDetails>
        </>
      )}
      <Button
        title="Back to schedule"
        secondary
        disabled={state.saving || state.uncertain}
        onPress={onBack}
      />
      {!state.context && !state.loading && (
        <Button
          title="Reload permissions"
          secondary
          onPress={() => void store.load()}
        />
      )}
      <Button
        title={
          state.saving
            ? "Saving…"
            : state.uncertain
              ? "Check and retry same save"
              : "Add routine"
        }
        disabled={
          !state.context || state.loading || state.saving || !!state.result
        }
        onPress={() => void save()}
      />
      {state.uncertain && (
        <Button
          title="Close and check Upcoming"
          secondary
          disabled={state.saving}
          onPress={onCheckUpcoming}
        />
      )}
    </View>
  );
}

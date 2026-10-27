import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Switch } from "../../components/Switch";
import type {
  CalendarSet,
  CalendarSubscription,
  PlannerPrefs,
  Team,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { usePlanning } from "../planner/planningContext";
import { useRun } from "../../hooks/useRun";
import { BottomSheet } from "../../components/BottomSheet";
import { Field } from "../../components/Field";
import { MoreMenu } from "../../components/MoreMenu";
import { errorText } from "../../lib/errors";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";

/** Most calendar sets (like the web's number keys 1 to 9). */
export const MAX_SETS = 9;

const newSet = (n: number): CalendarSet => ({
  id: `set-${Date.now().toString(36)}-${n}`,
  name: n === 0 ? "Work" : `Set ${n + 1}`,
  personal: true,
  team_ids: [],
  list_ids: [],
  subscription_ids: [],
});

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/**
 * Calendar sets: named views of what the calendar shows (personal items,
 * some teams, some lists). Saved with your planning settings, so they show
 * on the web too.
 */
export function CalendarSetsSheet({
  visible,
  sets,
  teams,
  onClose,
  onSaved,
}: {
  visible: boolean;
  sets: CalendarSet[];
  teams: Team[];
  onClose: () => void;
  onSaved: (prefs: PlannerPrefs) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Sheet
      visible={visible}
      title="Calendar sets"
      onClose={onClose}
      closeDisabled={pending}
    >
      {visible && (
        <Body
          sets={sets}
          teams={teams}
          onBusyChange={setPending}
          onSaved={(prefs) => {
            onSaved(prefs);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

function Body({
  sets,
  teams,
  onSaved,
  onBusyChange,
}: {
  sets: CalendarSet[];
  teams: Team[];
  onSaved: (prefs: PlannerPrefs) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { lists } = usePlanning();
  const { busy, error, setError, run } = useRun();
  const [draft, setDraft] = useState<CalendarSet[]>(() =>
    sets.length ? sets : [newSet(0)],
  );
  const [editing, setEditing] = useState<string | null>(null);
  const selected = draft.find((set) => set.id === editing);
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);
  const update = (id: string, patch: Partial<CalendarSet>) => {
    if (!saving.current)
      setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError("");
    client
      .listCalendarSubscriptions()
      .then(
        (result) => {
          if (current) setSubs(result);
        },
        (e) => {
          if (current) setLoadError(errorText(e));
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  /** A set from before subscriptions could be picked shows all of them. */
  const subsOf = (set: CalendarSet) =>
    set.subscription_ids ?? subs.map((x) => x.id);

  const save = async () => {
    if (saving.current) return;
    const unnamed = draft.find((x) => !x.name.trim());
    if (unnamed) {
      setEditing(unnamed.id);
      setError("Give this set a name.");
      return;
    }
    saving.current = true;
    onBusyChange(true);
    try {
      await run(async () => {
        const prefs = await client.updatePlannerPrefs({
          calendar_sets: draft.map((x) => ({ ...x, name: x.name.trim() })),
        });
        if (alive.current) onSaved(prefs);
      });
    } finally {
      saving.current = false;
      if (alive.current) onBusyChange(false);
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {draft.map((set) => (
            <View key={set.id} style={s.head}>
              <Text style={[shared.label, { flex: 1, minWidth: 0 }]}>
                {set.name || "Unnamed set"}
              </Text>
              <SmallAction
                label="Edit"
                disabled={busy}
                onPress={() => {
                  setEditing(set.id);
                  setError("");
                }}
              />
              <MoreMenu
                label={`Manage ${set.name || "set"}`}
                disabled={busy}
                actions={[
                  {
                    label: "Remove set",
                    destructive: true,
                    onPress: () =>
                      setDraft((d) => d.filter((x) => x.id !== set.id)),
                  },
                ]}
              />
            </View>
          ))}
          {draft.length === 0 && (
            <Text style={shared.small}>No calendar sets.</Text>
          )}
          {draft.length < MAX_SETS ? (
            <Button
              secondary
              title="Add a set"
              icon="plus"
              disabled={busy}
              onPress={() => {
                const added = newSet(draft.length);
                setDraft([...draft, added]);
                setEditing(added.id);
              }}
            />
          ) : (
            <Text style={[shared.small, s.center]}>Maximum 9 sets.</Text>
          )}
          <Button
            title={busy ? "Saving…" : "Save sets"}
            icon="check"
            disabled={busy}
            onPress={() => void save()}
          />
        </View>
      </ScrollView>
      <BottomSheet
        visible={!!selected}
        title="Edit calendar set"
        onClose={() => setEditing(null)}
        closeDisabled={busy}
      >
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        {selected && (
          <View>
            <Field label="Name">
              <TextInput
                style={[shared.input, s.gap]}
                editable={!busy}
                value={selected.name}
                onChangeText={(name) => update(selected.id, { name })}
                maxLength={40}
                placeholder="Work"
                placeholderTextColor={colors.faint}
                accessibilityLabel={"Set name"}
              />
            </Field>
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchTitle}>Personal</Text>
                <Text style={shared.small}>Your own tasks and events.</Text>
              </View>
              <Switch
                disabled={busy}
                value={selected.personal}
                trackColor={{ true: colors.accent }}
                accessibilityLabel={`${selected.name || "This set"} shows personal items`}
                onValueChange={(personal) => update(selected.id, { personal })}
              />
            </View>
            {teams.length > 0 && (
              <>
                <Text style={shared.label}>Teams</Text>
                <ChipRow label="Teams in this set" multi style={s.gap}>
                  {teams.map((t) => (
                    <Chip
                      key={t.id}
                      multi
                      disabled={busy}
                      label={t.name}
                      selected={selected.team_ids.includes(t.id)}
                      onPress={() =>
                        update(selected.id, {
                          team_ids: toggle(selected.team_ids, t.id),
                        })
                      }
                    />
                  ))}
                </ChipRow>
              </>
            )}
            {lists.length > 0 && (
              <>
                <Text style={shared.label}>Only these lists</Text>
                <ChipRow label="Lists in this set" multi>
                  {lists.map((l) => (
                    <Chip
                      key={l.id}
                      multi
                      disabled={busy}
                      color={l.color}
                      label={l.name}
                      selected={selected.list_ids.includes(l.id)}
                      onPress={() =>
                        update(selected.id, {
                          list_ids: toggle(selected.list_ids, l.id),
                        })
                      }
                    />
                  ))}
                </ChipRow>
                <Text style={[shared.small, s.hint]}>
                  None chosen shows every list.
                </Text>
              </>
            )}
            {subs.length > 0 && (
              <>
                <Text style={shared.label}>Subscribed calendars</Text>
                <ChipRow label="Subscribed calendars in this set" multi>
                  {subs.map((c) => (
                    <Chip
                      key={c.id}
                      multi
                      disabled={busy || loading || !!loadError}
                      color={c.color}
                      label={c.name}
                      selected={subsOf(selected).includes(c.id)}
                      onPress={() =>
                        update(selected.id, {
                          subscription_ids: toggle(subsOf(selected), c.id),
                        })
                      }
                    />
                  ))}
                </ChipRow>
              </>
            )}
            {loading && <Text style={shared.small}>Loading calendars…</Text>}
            {!!loadError && (
              <>
                <ErrorBanner error={loadError} />
                <Button
                  secondary
                  title="Retry calendars"
                  onPress={() => setAttempt((n) => n + 1)}
                />
              </>
            )}
            <Button
              title="Done"
              disabled={busy || !selected.name.trim()}
              onPress={() => setEditing(null)}
            />
          </View>
        )}
      </BottomSheet>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    gap: { marginBottom: 14 },
    hint: { marginTop: 8 },
    center: { textAlign: "center", marginBottom: 14 },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginBottom: 14,
    },
    switchTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
  }),
);

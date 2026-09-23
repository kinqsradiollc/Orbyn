import React, { useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { usePlanning } from "../../lib/planningContext";
import { useRun } from "../../hooks/useRun";
import { animateLayout } from "../../motion";
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
  return (
    <Sheet visible={visible} title="Calendar sets" onClose={onClose}>
      {visible && (
        <Body
          sets={sets}
          teams={teams}
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
}: {
  sets: CalendarSet[];
  teams: Team[];
  onSaved: (prefs: PlannerPrefs) => void;
}) {
  const { lists } = usePlanning();
  const { busy, error, setError, run } = useRun();
  const [draft, setDraft] = useState<CalendarSet[]>(() =>
    sets.length ? sets : [newSet(0)],
  );
  const update = (id: string, patch: Partial<CalendarSet>) =>
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  useEffect(() => {
    client.listCalendarSubscriptions().then(setSubs, () => setSubs([]));
  }, []);
  /** A set from before subscriptions could be picked shows all of them. */
  const subsOf = (set: CalendarSet) =>
    set.subscription_ids ?? subs.map((x) => x.id);

  const save = () =>
    run(async () => {
      if (draft.some((x) => !x.name.trim()))
        throw new Error("Give every set a name.");
      const prefs = await client.updatePlannerPrefs({
        calendar_sets: draft.map((x) => ({ ...x, name: x.name.trim() })),
      });
      onSaved(prefs);
    });

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.subtitle, s.intro]}>
          A set shows only some of your calendar, like just work. Pick one from
          the chips above the calendar.
        </Text>
        {draft.map((set, n) => (
          <View key={set.id} style={shared.card}>
            <View style={s.head}>
              <Text style={shared.label}>Set {n + 1}</Text>
              <SmallAction
                destructive
                label="Remove"
                disabled={busy}
                onPress={() => {
                  animateLayout();
                  setDraft(draft.filter((x) => x.id !== set.id));
                }}
              />
            </View>
            <TextInput
              style={[shared.input, s.gap]}
              value={set.name}
              onChangeText={(name) => update(set.id, { name })}
              maxLength={40}
              placeholder="Work"
              placeholderTextColor={colors.faint}
              accessibilityLabel={`Name of set ${n + 1}`}
            />
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchTitle}>Personal</Text>
                <Text style={shared.small}>Your own tasks and events.</Text>
              </View>
              <Switch
                value={set.personal}
                trackColor={{ true: colors.accent }}
                accessibilityLabel={`${set.name || "This set"} shows personal items`}
                onValueChange={(personal) => update(set.id, { personal })}
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
                      label={t.name}
                      selected={set.team_ids.includes(t.id)}
                      onPress={() =>
                        update(set.id, {
                          team_ids: toggle(set.team_ids, t.id),
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
                      color={l.color}
                      label={l.name}
                      selected={set.list_ids.includes(l.id)}
                      onPress={() =>
                        update(set.id, {
                          list_ids: toggle(set.list_ids, l.id),
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
                      color={c.color}
                      label={c.name}
                      selected={subsOf(set).includes(c.id)}
                      onPress={() =>
                        update(set.id, {
                          subscription_ids: toggle(subsOf(set), c.id),
                        })
                      }
                    />
                  ))}
                </ChipRow>
              </>
            )}
          </View>
        ))}
        {draft.length < MAX_SETS ? (
          <Button
            secondary
            title="Add a set"
            icon="plus"
            disabled={busy}
            onPress={() => {
              animateLayout();
              setDraft([...draft, newSet(draft.length)]);
            }}
          />
        ) : (
          <Text style={[shared.small, s.center]}>
            That’s the most sets you can have.
          </Text>
        )}
        <Button
          title={busy ? "Saving…" : "Save sets"}
          icon="check"
          disabled={busy}
          onPress={() => void save()}
        />
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 18 },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
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

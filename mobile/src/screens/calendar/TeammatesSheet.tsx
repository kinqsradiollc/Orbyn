import React, { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { MAX_MATES, type Teammates } from "./teammates";

/** Choosing teammates whose busy times show beside the day. */
export function TeammatesSheet({
  visible,
  teammates: t,
  onClose,
}: {
  visible: boolean;
  teammates: Teammates;
  onClose: () => void;
}) {
  const { load } = t;
  useEffect(() => {
    if (visible) load();
  }, [visible, load]);
  const full = t.selected.length >= MAX_MATES;
  return (
    <Sheet visible={visible} title="Show teammates" onClose={onClose}>
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          <ErrorBanner error={t.error} />
          {!!t.error && <Button secondary title="Retry" onPress={t.retry} />}
          <Text style={[shared.small, s.intro]}>
            Show busy times for up to {MAX_MATES} people. Event details stay
            private.
          </Text>
          {t.membersLoading ? (
            <Text style={shared.small}>Loading your teams…</Text>
          ) : t.memberError ? null : !t.mates?.length ? (
            <Text style={shared.small}>No teammates available.</Text>
          ) : (
            <View style={s.list}>
              {t.mates?.map((m, n) => {
                const on = t.selected.includes(m.user_id);
                const blocked = !on && full;
                return (
                  <Pressable
                    key={m.user_id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${m.name}${m.pinned ? ", pinned" : ""}`}
                    accessibilityState={{ checked: on, disabled: blocked }}
                    disabled={blocked}
                    onPress={() => t.toggle(m.user_id)}
                    style={({ pressed }) => [
                      s.row,
                      n > 0 && s.divider,
                      pressed && s.pressed,
                      blocked && s.blocked,
                    ]}
                  >
                    <View style={[s.check, on && s.checkOn]}>
                      {on && (
                        <Icon name="check" size={14} color={colors.onAccent} />
                      )}
                    </View>
                    <Text style={s.name}>{m.name}</Text>
                    {m.pinned && (
                      <Icon name="pin" size={13} color={colors.muted} />
                    )}
                    {on && (
                      <View
                        style={[
                          s.swatch,
                          { backgroundColor: t.colorOf(m.user_id) },
                        ]}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
          {t.selected.length > 0 && (
            <Button secondary title="Hide everyone" onPress={t.clear} />
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 12 },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 16,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    blocked: { opacity: 0.45 },
    check: {
      width: 22,
      height: 22,
      borderRadius: radii.check,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    name: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    swatch: { width: 12, height: 12, borderRadius: radii.pill },
  }),
);

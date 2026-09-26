import React, { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../motion";
import {
  createLabel,
  moveAction,
  setFavourite,
  shownActions,
  toggleHidden,
  type CreateActionId,
  type CreateArrangement,
} from "@orbyn/core";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { CONCEPT_ICON, Icon, type IconName } from "./Icon";
import { colors, controls, fonts, radii, themed } from "../theme";

/** One icon per idea, the same as everywhere else in the app. */
export const CREATE_ICONS: Record<CreateActionId, IconName> = {
  task: CONCEPT_ICON.task,
  page: CONCEPT_ICON.page,
  template: "layoutTemplate",
  scan: "scan",
  project: CONCEPT_ICON.project,
  plan: "calendarCheck",
  focus: "timer",
  ask: "sparkles",
};

/**
 * The + sheet (a long press on +): every way to start something, one row
 * each — an icon and a verb, the same height, no dividers — and "Arrange"
 * at the bottom to order them, hide the ones never used, and choose what a
 * tap on + does. The chosen action runs once the sheet has gone.
 */
export function CreateSheet({
  visible,
  arrangement,
  onArrange,
  onRun,
  onClose,
}: {
  visible: boolean;
  arrangement: CreateArrangement;
  onArrange: (next: CreateArrangement) => void;
  onRun: (id: CreateActionId) => void;
  onClose: () => void;
}) {
  const [arranging, setArranging] = useState(false);
  const chosen = useRef<CreateActionId | null>(null);
  const close = () => {
    onClose();
  };
  return (
    <BottomSheet
      visible={visible}
      title={arranging ? "Arrange" : undefined}
      label="Start something new"
      onClose={close}
      afterClose={() => {
        setArranging(false);
        const id = chosen.current;
        chosen.current = null;
        if (id) onRun(id);
      }}
      footer={
        arranging ? (
          <Button title="Done" onPress={() => setArranging(false)} />
        ) : undefined
      }
    >
      {arranging ? (
        <View style={s.list}>
          <Text style={s.lead}>
            The star is what a tap on + does. Hide what you never use.
          </Text>
          {arrangement.order.map((id, n) => {
            const hidden = arrangement.hidden.includes(id);
            const favourite = arrangement.favourite === id;
            return (
              <View key={id} style={[s.row, hidden && s.hidden]}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: favourite }}
                  accessibilityLabel={`A tap on + does ${createLabel(id)}`}
                  hitSlop={6}
                  onPress={() => onArrange(setFavourite(arrangement, id))}
                  style={s.small}
                >
                  <Icon
                    name={favourite ? "starFilled" : "star"}
                    size={17}
                    color={favourite ? colors.accent : colors.faint}
                  />
                </Pressable>
                <Icon
                  name={CREATE_ICONS[id]}
                  size={19}
                  color={colors.textSoft}
                />
                <Text style={s.label} numberOfLines={1}>
                  {createLabel(id)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${createLabel(id)} up`}
                  disabled={n === 0}
                  hitSlop={6}
                  onPress={() => onArrange(moveAction(arrangement, id, -1))}
                  style={[s.small, n === 0 && s.off]}
                >
                  <Icon name="arrowUp" size={16} color={colors.textSoft} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${createLabel(id)} down`}
                  disabled={n === arrangement.order.length - 1}
                  hitSlop={6}
                  onPress={() => onArrange(moveAction(arrangement, id, 1))}
                  style={[s.small, n === arrangement.order.length - 1 && s.off]}
                >
                  <Icon name="arrowDown" size={16} color={colors.textSoft} />
                </Pressable>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: !hidden, disabled: favourite }}
                  accessibilityLabel={`Show ${createLabel(id)}`}
                  disabled={favourite}
                  hitSlop={6}
                  onPress={() => onArrange(toggleHidden(arrangement, id))}
                  style={[s.small, favourite && s.off]}
                >
                  <Icon
                    name={hidden ? "circlePlus" : "circleMinus"}
                    size={18}
                    color={hidden ? colors.accent : colors.muted}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={s.list} accessibilityRole="menu">
          {shownActions(arrangement).map((id) => (
            <Pressable
              key={id}
              accessibilityRole="menuitem"
              onPress={() => {
                chosen.current = id;
                close();
              }}
              style={({ pressed }) => [
                s.row,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Icon name={CREATE_ICONS[id]} size={20} color={colors.textSoft} />
              <Text style={s.label}>{createLabel(id)}</Text>
              {arrangement.favourite === id && <Text style={s.tap}>Tap +</Text>}
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => setArranging(true)}
            style={({ pressed }) => [s.arrange, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.arrangeText}>Arrange</Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    list: { paddingBottom: 4 },
    lead: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      marginBottom: 8,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: controls.tap + 8,
      paddingHorizontal: 10,
      marginHorizontal: -10,
      borderRadius: radii.input,
    },
    hidden: { opacity: 0.5 },
    label: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    tap: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
    small: {
      width: 34,
      height: 34,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    off: { opacity: 0.35 },
    arrange: {
      alignSelf: "center",
      minHeight: controls.tap,
      justifyContent: "center",
      paddingHorizontal: 16,
      marginTop: 4,
    },
    arrangeText: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.muted,
    },
  }),
);

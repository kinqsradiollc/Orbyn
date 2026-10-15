import React, { useEffect, useRef } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { session } from "../../lib/session";
import { Button } from "../../components/Button";
import type { IconName } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { shared } from "../../styles";
import { colors, fonts, themed } from "../../theme";

export type MenuAction = {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  run: () => void;
};

/** A line under the menu's title; `warn` for one that needs attention. */
export type MenuFact = { text: string; warn?: boolean };

export type Menu = {
  title: string;
  detail: string;
  /** More lines under the detail ("Deadline Fri 2 Oct, 5 pm"). */
  facts?: MenuFact[];
  actions: MenuAction[];
};

/**
 * Options for something on the calendar, as a sheet of buttons (an Alert
 * shows at most three on Android). The chosen action runs once the sheet has
 * closed, so it can open another sheet or ask a question.
 */
export function ActionMenu({
  menu,
  onClose,
}: {
  menu: Menu | null;
  onClose: () => void;
}) {
  const picked = useRef(false);
  useEffect(() => {
    picked.current = false;
  }, [menu]);
  const pending = useRef<{ owner: string; run: () => void } | null>(null);
  const mounted = useRef(true);
  const menuOwner = useRef({ menu, owner: session.token });
  if (menuOwner.current.menu !== menu)
    menuOwner.current = { menu, owner: session.token };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
    };
  }, []);
  const runPending = () => {
    const next = pending.current;
    pending.current = null;
    if (mounted.current && next?.owner === session.token) next.run();
  };
  const pick = (action: MenuAction) => {
    if (
      picked.current ||
      !mounted.current ||
      menuOwner.current.owner !== session.token
    )
      return;
    picked.current = true;
    pending.current = { owner: menuOwner.current.owner, run: action.run };
    onClose();
    // iOS runs it from onDismiss, after the sheet's animation.
    if (Platform.OS !== "ios") runPending();
  };
  return (
    <Sheet
      visible={!!menu}
      title={menu?.title ?? ""}
      onClose={onClose}
      onDismiss={runPending}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          {!!menu?.detail && (
            <Text
              style={[
                shared.small,
                s.detail,
                !!menu.facts?.length && s.detailTight,
              ]}
            >
              {menu.detail}
            </Text>
          )}
          {!!menu?.facts?.length && (
            <View style={s.facts}>
              {menu.facts.map((f) => (
                <Text key={f.text} style={[shared.small, f.warn && s.warn]}>
                  {f.text}
                </Text>
              ))}
            </View>
          )}
          {menu?.actions.map((a) => (
            <Button
              key={a.label}
              secondary={!a.destructive}
              destructive={a.destructive}
              icon={a.icon}
              title={a.label}
              onPress={() => pick(a)}
            />
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    detail: { marginTop: 0, marginBottom: 16 },
    detailTight: { marginBottom: 6 },
    facts: { gap: 4, marginBottom: 16 },
    warn: { fontFamily: fonts.semibold, color: colors.warningStrong },
  }),
);

import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TOAST_MS } from "@orbyn/core";
import { FadeIn } from "../motion";
import { Icon } from "./Icon";
import { colors, fonts, radii, themed } from "../theme";

/** A short sentence, and at most one thing to do about it. */
export type ToastOptions = {
  text: string;
  action?: { label: string; run: () => void };
};

type Shown = ToastOptions & { key: number };

/*
 * One toast for the app, held outside React so anything can raise it. Sheets
 * are native modals that cover the app, so each open sheet has a host of its
 * own; only the newest host shows the toast, which puts it above whatever
 * is on top.
 */
let shown: Shown | null = null;
let count = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const hosts: number[] = [];
let nextHost = 0;
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Take the toast down now. */
export function hideToast(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  shown = null;
  emit();
}

/**
 * Show a toast at the top of the screen for four seconds: "Moved to Trash ·
 * Undo". It is what a reversible action says instead of asking first. A new
 * toast replaces the one showing.
 */
export function showToast(o: ToastOptions): void {
  if (timer) clearTimeout(timer);
  shown = { ...o, key: ++count };
  timer = setTimeout(hideToast, TOAST_MS);
  emit();
  // Read out at once: a toast is news about something just done.
  AccessibilityInfo.announceForAccessibility?.(o.text);
}

/**
 * Where the toast appears. The app's root has one, and so does every sheet;
 * the one mounted last draws it.
 */
export function ToastHost() {
  const id = useRef(++nextHost).current;
  const [, redraw] = useState(0);
  useEffect(() => {
    hosts.push(id);
    emit();
    return () => {
      hosts.splice(hosts.indexOf(id), 1);
      emit();
    };
  }, [id]);
  // Redrawn when the toast changes, and when a host comes or goes.
  useEffect(() => subscribe(() => redraw((n) => n + 1)), []);
  const toast = shown;
  const insets = useSafeAreaInsets();
  if (!toast || hosts[hosts.length - 1] !== id) return null;
  return (
    <View pointerEvents="box-none" style={[s.region, { top: insets.top + 8 }]}>
      <FadeIn key={toast.key} from="down" style={s.toast}>
        <Text style={s.text} accessibilityRole="alert">
          {toast.text}
        </Text>
        {toast.action && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              const run = toast.action!.run;
              hideToast();
              run();
            }}
            style={({ pressed }) => [s.action, pressed && s.pressed]}
          >
            <Text style={s.actionText}>{toast.action.label}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
          onPress={hideToast}
          style={({ pressed }) => [s.close, pressed && s.pressed]}
        >
          <Icon name="x" size={14} color={colors.muted} />
        </Pressable>
      </FadeIn>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    region: {
      position: "absolute",
      left: 16,
      right: 16,
      zIndex: 100,
      alignItems: "center",
    },
    toast: {
      width: "100%",
      maxWidth: 480,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 48,
      paddingLeft: 16,
      paddingRight: 6,
      paddingVertical: 6,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      shadowColor: colors.shadow,
      shadowOpacity: 0.14,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    text: {
      flex: 1,
      color: colors.text,
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 18,
    },
    action: {
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: radii.input,
      justifyContent: "center",
    },
    actionText: {
      color: colors.accent,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
    close: {
      width: 34,
      height: 34,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { backgroundColor: colors.surfaceMuted },
  }),
);

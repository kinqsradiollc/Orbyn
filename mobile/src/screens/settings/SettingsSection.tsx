import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { sectionKey } from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { readLocal, saveLocal } from "../../lib/localPrefs";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

const REMEMBER = "orbyn-settings-open";

/**
 * The section Settings' search chose (NAV-10): its heading, compared by
 * `sectionKey`, a counter so choosing it again works, and how to bring it
 * into view.
 */
export const SettingsFocus = createContext<{
  key: string;
  seq: number;
  scrollTo: (y: number) => void;
} | null>(null);

/** Opens and scrolls to itself when the search chose it. */
function useFound(title: string, onFound: () => void) {
  const focus = useContext(SettingsFocus);
  const y = useRef(0);
  const [lit, setLit] = useState(false);
  const chosen = !!focus && focus.key === sectionKey(title);
  useEffect(() => {
    if (!chosen) return;
    onFound();
    setLit(true);
    // After it has opened and laid out.
    const t = setTimeout(() => focus?.scrollTo(Math.max(0, y.current - 8)), 60);
    const off = setTimeout(() => setLit(false), 1600);
    return () => {
      clearTimeout(t);
      clearTimeout(off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, focus?.seq]);
  return {
    lit,
    onLayout: (e: { nativeEvent: { layout: { y: number } } }) => {
      y.current = e.nativeEvent.layout.y;
    },
  };
}

/** A place in Settings that is not a folding section, for the search. */
export function SettingsAnchor({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const found = useFound(name, () => {});
  return (
    <View onLayout={found.onLayout} style={found.lit && s.lit}>
      {children}
    </View>
  );
}

const openSet = (): Set<string> => {
  try {
    return new Set(JSON.parse(readLocal(REMEMBER) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};

/**
 * One settings section, folded away until it is wanted.
 *
 * Settings had grown to one screen of nearly a thousand lines, so finding
 * anything meant scrolling past everything else. This is the same fold the
 * desktop uses, so the two read alike: the heading that was a label above
 * the card becomes the thing you press to open it, and what you opened last
 * time is still open when you come back.
 */
export function SettingsSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => defaultOpen || openSet().has(title));
  const found = useFound(title, () => setOpen(true));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    const all = openSet();
    if (next) all.add(title);
    else all.delete(title);
    saveLocal(REMEMBER, JSON.stringify([...all]));
  };

  return (
    <View
      style={[shared.card, s.section, found.lit && s.lit]}
      onLayout={found.onLayout}
    >
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [s.head, pressed && s.headPressed]}
      >
        <Text style={s.title}>{title}</Text>
        <Icon
          name={open ? "chevronUp" : "chevronDown"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      {open && <View style={s.body}>{children}</View>}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    section: { padding: 0, overflow: "hidden" },
    lit: {
      borderColor: colors.accent,
      borderWidth: 2,
      borderRadius: radii.card,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 16,
    },
    headPressed: { backgroundColor: colors.surfaceMuted },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.semibold,
    },
    body: {
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 16,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
  }),
);

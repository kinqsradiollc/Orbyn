import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
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
  root?: React.RefObject<View | null>;
} | null>(null);

/** Opens and scrolls to itself when the search chose it. */
function useFound(title: string, onFound: () => void) {
  const focus = useContext(SettingsFocus);
  const y = useRef(0);
  const box = useRef<View>(null);
  const [lit, setLit] = useState(false);
  const chosen = !!focus && focus.key === sectionKey(title);
  useEffect(() => {
    if (!chosen) return;
    let live = true;
    onFound();
    setLit(true);
    // After it has opened and laid out.
    const t = setTimeout(() => {
      const fallback = () => {
        if (live) focus?.scrollTo(Math.max(0, y.current - 8));
      };
      if (box.current && focus?.root?.current) {
        try {
          box.current.measureLayout(
            focus.root.current,
            (_x, measuredY) => {
              if (live) focus.scrollTo(Math.max(0, measuredY - 8));
            },
            fallback,
          );
        } catch {
          fallback();
        }
      } else fallback();
    }, 60);
    const off = setTimeout(() => setLit(false), 1600);
    return () => {
      live = false;
      clearTimeout(t);
      clearTimeout(off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, focus?.seq]);
  return {
    lit,
    ref: box,
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
    <View ref={found.ref} onLayout={found.onLayout} style={found.lit && s.lit}>
      {children}
    </View>
  );
}

const openSet = (): Set<string> => {
  try {
    const value: unknown = JSON.parse(readLocal(REMEMBER) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
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
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(() => defaultOpen || openSet().has(title));
  const [openedOnce, setOpenedOnce] = useState(open);
  const found = useFound(title, () => {
    setOpen(true);
    setOpenedOnce(true);
  });

  const toggle = () => {
    if (disabled) return;
    const next = !open;
    setOpen(next);
    if (next) setOpenedOnce(true);
    const all = openSet();
    if (next) all.add(title);
    else all.delete(title);
    saveLocal(REMEMBER, JSON.stringify([...all]));
  };

  return (
    <View
      ref={found.ref}
      style={[shared.card, s.section, found.lit && s.lit]}
      onLayout={found.onLayout}
    >
      <Pressable
        onPress={toggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled }}
        style={({ pressed }) => [s.head, pressed && s.headPressed]}
      >
        <Text style={s.title}>{title}</Text>
        <Icon
          name={open ? "chevronUp" : "chevronDown"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      {openedOnce && (
        <View
          style={[s.body, !open && { display: "none" }]}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        >
          {children}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    section: {
      padding: 0,
      overflow: "hidden",
      borderWidth: 0,
      borderBottomWidth: 1,
      borderRadius: 0,
      backgroundColor: colors.surface,
    },
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
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    headPressed: { backgroundColor: colors.surfaceMuted },
    title: {
      flex: 1,
      minWidth: 0,
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.semibold,
    },
    body: {
      gap: 12,
      paddingHorizontal: 12,
      paddingBottom: 16,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
  }),
);

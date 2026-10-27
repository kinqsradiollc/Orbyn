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
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

const DetailContext = createContext<{
  active: string | null;
  open: (key: string | null) => void;
} | null>(null);
export function SettingsDetailProvider({
  children,
  resetKey,
  reveal,
}: {
  children: ReactNode;
  resetKey?: unknown;
  reveal?: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const latest = useRef(reveal);
  latest.current = reveal;
  const [lastReset, setLastReset] = useState(resetKey);
  if (!Object.is(lastReset, resetKey)) {
    setLastReset(resetKey);
    if (resetKey !== true) setActive(null);
  }
  return (
    <DetailContext.Provider
      value={{
        active,
        open: (key) => {
          if (key !== null) latest.current?.();
          setActive(key);
        },
      }}
    >
      {children}
    </DetailContext.Provider>
  );
}

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

/** A settings row opens a focused detail, retaining its mounted draft on Back. */
export function SettingsSection({
  title,
  children,
  defaultOpen: _defaultOpen = false,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  void _defaultOpen;
  const navigation = useContext(DetailContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = navigation ? navigation.active === title : localOpen;
  const setOpen = (value: boolean) =>
    navigation ? navigation.open(value ? title : null) : setLocalOpen(value);
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
  };

  return (
    <View
      ref={found.ref}
      style={[
        shared.card,
        s.section,
        found.lit && s.lit,
        !!navigation?.active && !open && { display: "none" },
      ]}
      onLayout={found.onLayout}
    >
      {open ? (
        <View style={s.detailHeading}>
          <Pressable
            onPress={toggle}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Back from ${title}`}
            accessibilityState={{ disabled }}
            style={({ pressed }) => [s.back, pressed && s.headPressed]}
          >
            <Icon name="chevronLeft" size={18} color={colors.text} />
            <Text style={s.backText}>Back</Text>
          </Pressable>
          <Text style={s.title} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={toggle}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          style={({ pressed }) => [s.head, pressed && s.headPressed]}
        >
          <Text style={s.title}>{title}</Text>
          <Icon name="chevronRight" size={18} color={colors.muted} />
        </Pressable>
      )}
      {openedOnce && (
        <View
          style={[s.body, !open && { display: "none" }]}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        >
          <SettingsDetailProvider resetKey={open} reveal={() => setOpen(true)}>
            {children}
          </SettingsDetailProvider>
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
    detailHeading: { gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
    back: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 44,
      paddingRight: 12,
    },
    backText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
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

/** Share one detail navigation owner without adding layout wrappers. */
export function SettingsWorkspace({
  children,
  focus,
  resetKey,
}: {
  children: ReactNode;
  focus: React.ContextType<typeof SettingsFocus>;
  resetKey: unknown;
}) {
  return (
    <SettingsFocus.Provider value={focus}>
      <SettingsDetailProvider resetKey={resetKey}>
        {children}
      </SettingsDetailProvider>
    </SettingsFocus.Provider>
  );
}

/** Overview-only destinations stay out of a focused settings detail. */
export function SettingsOverview({ children }: { children: ReactNode }) {
  const nav = useContext(DetailContext);
  const hidden = !!nav?.active;
  return (
    <View
      style={hidden ? { display: "none" } : undefined}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
    >
      {children}
    </View>
  );
}

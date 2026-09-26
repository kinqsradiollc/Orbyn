import React, { useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Pressable } from "../../motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listLayout, pageSlides, type DocBlock } from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { colors, fonts, radii, themed } from "../../theme";
import { Inline } from "./Inline";
import { MathView } from "./MathView";

/**
 * Present a page as slides (CNV-03) on a phone or iPad: the page splits at
 * its dividers and top headings, one slide at a time in large type. Tap the
 * right side or → for the next slide, the left side or ← for the one
 * before; ✕ leaves. Turning the phone sideways gives the slide more room.
 */
export function PresentSheet({
  visible,
  title,
  blocks,
  onClose,
}: {
  visible: boolean;
  title: string;
  blocks: DocBlock[];
  onClose: () => void;
}) {
  const slides = pageSlides(title, blocks);
  const [at, setAt] = useState(0);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  useEffect(() => {
    if (visible) setAt(0);
  }, [visible]);
  const slide = slides[Math.min(at, slides.length - 1)];
  const layout = listLayout(slide.blocks);
  const next = () => setAt((n) => Math.min(n + 1, slides.length - 1));
  const back = () => setAt((n) => Math.max(n - 1, 0));
  return (
    <Modal
      visible={visible}
      animationType="fade"
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      <View
        style={[
          s.screen,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 },
        ]}
        accessibilityViewIsModal
      >
        <View style={s.top}>
          <Text style={s.count}>
            {at + 1} / {slides.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop presenting"
            hitSlop={12}
            onPress={onClose}
            style={s.close}
          >
            <Icon name="x" size={22} color={colors.text} />
          </Pressable>
        </View>
        <View style={s.stage}>
          <Pressable
            quiet
            style={s.half}
            accessibilityRole="button"
            accessibilityLabel="Previous slide"
            onPress={back}
          />
          <Pressable
            quiet
            style={[s.half, s.right]}
            accessibilityRole="button"
            accessibilityLabel="Next slide"
            onPress={next}
          />
          <View
            style={[s.slide, wide && s.slideWide]}
            pointerEvents="none"
            accessibilityLiveRegion="polite"
          >
            {slide.title ? (
              <Text style={[s.title, wide && s.titleWide]}>{slide.title}</Text>
            ) : null}
            {slide.blocks.map((b, i) => (
              <SlideLine
                key={b.id ?? i}
                block={b}
                number={layout[i]?.number ?? null}
                wide={wide}
              />
            ))}
          </View>
        </View>
        <View style={s.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous slide"
            disabled={at === 0}
            hitSlop={12}
            onPress={back}
            style={[s.navButton, at === 0 && s.off]}
          >
            <Icon name="chevronLeft" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next slide"
            disabled={at >= slides.length - 1}
            hitSlop={12}
            onPress={next}
            style={[s.navButton, at >= slides.length - 1 && s.off]}
          >
            <Icon name="chevronRight" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** One line on a slide, in the slide's larger type. */
function SlideLine({
  block,
  number,
  wide,
}: {
  block: DocBlock;
  number: number | null;
  wide: boolean;
}) {
  const text = [s.text, wide && s.textWide];
  switch (block.type) {
    case "heading":
      return (
        <Inline text={block.text} style={[s.heading, wide && s.titleWide]} />
      );
    case "bullet":
    case "numbered":
    case "todo":
      return (
        <View style={s.row}>
          <Text style={text}>
            {block.type === "numbered"
              ? `${number ?? 1}.`
              : block.type === "todo"
                ? block.done
                  ? "☑"
                  : "☐"
                : "•"}
          </Text>
          <Inline text={block.text} style={[...text, s.grow]} />
        </View>
      );
    case "math":
      return <MathView tex={block.text} display />;
    case "quote":
      return <Inline text={block.text} style={[...text, s.quote]} />;
    case "image":
    case "file":
      return <Text style={s.muted}>{block.text || "Picture"}</Text>;
    case "divider":
      return null;
    default:
      return "text" in block ? <Inline text={block.text} style={text} /> : null;
  }
}

const s = themed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    top: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
    },
    count: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
    close: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.pill,
    },
    stage: { flex: 1, justifyContent: "center" },
    half: { position: "absolute", top: 0, bottom: 0, left: 0, width: "50%" },
    right: { left: "50%" },
    slide: { paddingHorizontal: 24, gap: 14 },
    slideWide: { paddingHorizontal: 64 },
    title: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
    titleWide: { fontSize: 36 },
    heading: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
    text: { fontFamily: fonts.regular, fontSize: 18, color: colors.text },
    textWide: { fontSize: 24 },
    quote: { color: colors.textSoft },
    row: { flexDirection: "row", gap: 10 },
    grow: { flex: 1 },
    muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    nav: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 24,
      paddingTop: 8,
    },
    navButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
    },
    off: { opacity: 0.4 },
  }),
);

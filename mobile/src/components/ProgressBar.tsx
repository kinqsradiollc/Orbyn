import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { motion } from "@orbyn/core";
import { easeOut, isReducedMotion, useReducedMotion } from "../motion";
import { colors } from "../theme";

/**
 * Horizontal progress bar. The fill grows from the left on mount and eases to
 * each new value over `motion.slow`; it jumps straight there under reduced motion.
 */
export function ProgressBar({
  value,
  height = 4,
  color = colors.accent,
  track = colors.divider,
  label,
}: {
  /** 0-100. */
  value: number;
  height?: number;
  color?: string;
  track?: string;
  /** Spoken name, e.g. "Write report progress". */
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const reduced = useReducedMotion();
  const fill = useRef(
    new Animated.Value(isReducedMotion() ? clamped / 100 : 0),
  ).current;
  useEffect(() => {
    if (reduced) {
      fill.stopAnimation();
      fill.setValue(clamped / 100);
      return;
    }
    const animation = Animated.timing(fill, {
      toValue: clamped / 100,
      duration: motion.slow,
      easing: easeOut,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [clamped, reduced, fill]);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      style={[
        s.track,
        { height, borderRadius: height / 2, backgroundColor: track },
      ]}
    >
      <Animated.View
        style={[
          s.fill,
          { height, backgroundColor: color, transform: [{ scaleX: fill }] },
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  track: { flex: 1, overflow: "hidden" },
  fill: { width: "100%", transformOrigin: "left" },
});

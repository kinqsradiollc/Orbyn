import React, { useEffect, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";
import { motion, staggerDelay } from "@orbyn/core";
import { easeOut } from "./easing";
import { isReducedMotion, useReducedMotion } from "./useReducedMotion";

export type FadeFrom = "up" | "down" | "left" | "right";

/** Start offset per direction: "up" rises into place, "left" enters from the left. */
const START: Record<
  FadeFrom,
  { axis: "translateX" | "translateY"; sign: 1 | -1 }
> = {
  up: { axis: "translateY", sign: 1 },
  down: { axis: "translateY", sign: -1 },
  left: { axis: "translateX", sign: -1 },
  right: { axis: "translateX", sign: 1 },
};

/**
 * Fades its children in and slides them `motion.distance` into place, once,
 * on mount. Re-renders never replay it, so list rows that stay mounted across
 * data refreshes stay still. Renders the final state under reduced motion.
 */
export function FadeIn({
  children,
  index = 0,
  from = "up",
  duration = motion.base,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  /** Position in a list; adds `staggerDelay(index)`. */
  index?: number;
  /** Direction the content travels from. */
  from?: FadeFrom;
  duration?: number;
  /** Extra delay in ms, added to the stagger. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const skip = useRef(isReducedMotion()).current;
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(skip ? 1 : 0)).current;

  useEffect(() => {
    if (skip) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: staggerDelay(index) + delay,
      easing: easeOut,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // Mount only: later prop changes must not replay the entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reduce Motion switched on mid-entrance: jump to the end.
  useEffect(() => {
    if (reduced) {
      progress.stopAnimation();
      progress.setValue(1);
    }
  }, [reduced, progress]);

  if (skip) return <Animated.View style={style}>{children}</Animated.View>;

  const { axis, sign } = START[from];
  const offset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [motion.distance * sign, 0],
  });
  const transform =
    axis === "translateX" ? [{ translateX: offset }] : [{ translateY: offset }];
  return (
    <Animated.View style={[style, { opacity: progress, transform }]}>
      {children}
    </Animated.View>
  );
}

import React, { useEffect, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";
import { motion } from "@orbyn/core";
import { easeOut } from "./easing";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Plays a quick fade/scale over `motion.base` whenever `value` changes (not on
 * mount), so a changed stat number catches the eye. Still under reduced motion.
 */
export function Bump({
  value,
  style,
  children,
}: {
  value: unknown;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    if (reduced) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
  }, [value, reduced, progress]);
  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  });
  return (
    <Animated.View
      style={[
        { alignSelf: "flex-start" },
        style,
        { opacity, transform: [{ scale }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

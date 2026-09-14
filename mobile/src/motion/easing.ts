import { Animated, Easing } from "react-native";
import { motion } from "@orbyn/core";

/** Shared curves, the same cubic-beziers the web app uses. */
export const easeOut = Easing.bezier(
  motion.easeOut[0],
  motion.easeOut[1],
  motion.easeOut[2],
  motion.easeOut[3],
);
export const easeInOut = Easing.bezier(
  motion.easeInOut[0],
  motion.easeInOut[1],
  motion.easeInOut[2],
  motion.easeInOut[3],
);

/**
 * Scale "pop": from its current value up to `peak` then settle at 1, over
 * `motion.base` in total. Used by the checkbox tick, tab icon and unread dot.
 */
export const pop = (value: Animated.Value, peak = 1.12) =>
  Animated.sequence([
    Animated.timing(value, {
      toValue: peak,
      duration: motion.base * 0.55,
      easing: easeOut,
      useNativeDriver: true,
    }),
    Animated.timing(value, {
      toValue: 1,
      duration: motion.base * 0.45,
      easing: easeInOut,
      useNativeDriver: true,
    }),
  ]);

import React, { useRef, useState } from "react";
import {
  Animated,
  Pressable,
  Platform,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { motion } from "@orbyn/core";
import { easeOut } from "./easing";
import { isReducedMotion } from "./useReducedMotion";
import { pressableWebState } from "./accessibility";

/**
 * Press feedback: scale towards `motion.pressScale` on press-in and back on
 * press-out, over `motion.fast` on the native driver. Returns handlers to put
 * on a Pressable and an animated style for whichever view should shrink.
 */
export function usePressScale(to: number = motion.pressScale) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (value: number) => {
    if (isReducedMotion()) return;
    Animated.timing(scale, {
      toValue: value,
      duration: motion.fast,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
  };
  return {
    onPressIn: () => animate(to),
    onPressOut: () => animate(1),
    style: { transform: [{ scale }] },
  };
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressState = { pressed: boolean };

/** A Pressable that shrinks slightly while pressed. Drop-in for Pressable. */
export function PressableScale({
  style,
  scaleTo,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle> | ((state: PressState) => StyleProp<ViewStyle>);
  scaleTo?: number;
}) {
  const press = usePressScale(scaleTo);
  const [pressed, setPressed] = useState(false);
  const resolved = typeof style === "function" ? style({ pressed }) : style;
  return (
    <AnimatedPressable
      {...rest}
      {...pressableWebState(rest, Platform.OS)}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true);
        press.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        press.onPressOut();
        onPressOut?.(e);
      }}
      style={[resolved, press.style]}
    />
  );
}

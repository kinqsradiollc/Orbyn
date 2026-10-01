import React, { forwardRef } from "react";
import {
  Pressable as NativePressable,
  Platform,
  type PressableProps,
  type View,
} from "react-native";
import { pressableWebState } from "./accessibility";

/** How far a pressed row, chip or button dims while the finger is down. */
export const PRESSED_OPACITY = 0.6;

const dimmed = { opacity: PRESSED_OPACITY };

/**
 * Pressable with a pressed state by default: anything you can tap dims
 * while it's held, so every row and chip answers the finger. A `style`
 * function still decides for itself (a tint instead of dimming), and
 * `quiet` leaves it alone — for backdrops that close a sheet, where there
 * is nothing to show.
 */
export const Pressable = forwardRef<View, PressableProps & { quiet?: boolean }>(
  function Pressable({ style, quiet = false, ...rest }, ref) {
    const tappable =
      !quiet && !rest.disabled && !!(rest.onPress || rest.onLongPress);
    return (
      <NativePressable
        ref={ref}
        style={
          typeof style === "function" || !tappable
            ? style
            : ({ pressed }) => [style, pressed && dimmed]
        }
        {...rest}
        {...pressableWebState(rest, Platform.OS)}
      />
    );
  },
);

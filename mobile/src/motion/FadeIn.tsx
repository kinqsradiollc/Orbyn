import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export type FadeFrom = "up" | "down" | "left" | "right";

/**
 * Stable content wrapper. Keep the existing call contract while routine content
 * appears immediately, without hidden initial frames or ornamental entrances.
 */
export function FadeIn({
  children,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  from?: FadeFrom;
  duration?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

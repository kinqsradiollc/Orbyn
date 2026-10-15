import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/** Compatibility wrapper: changed values stay readable without ornamental motion. */
export function Bump({
  style,
  children,
}: {
  value: unknown;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return <View style={[{ alignSelf: "flex-start" }, style]}>{children}</View>;
}

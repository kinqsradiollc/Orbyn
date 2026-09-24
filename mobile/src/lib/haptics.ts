import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * A light tap under the thumb for the moments that deserve one: completing a
 * task, flipping a switch, opening a long-press menu. Phones only — a browser
 * has nothing to tap with — and it never throws, because a missed tap is
 * nothing to report.
 */
export function tap(): void {
  if (Platform.OS === "web") return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

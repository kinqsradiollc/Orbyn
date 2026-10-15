import { LayoutAnimation, Platform, UIManager } from "react-native";
import { motion } from "@orbyn/core";
import { isReducedMotion } from "./useReducedMotion";

// Old-architecture Android needs LayoutAnimation switched on; on the New
// Architecture this is a no-op that warns, so only call it there.
if (
  Platform.OS === "android" &&
  !(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager
)
  UIManager.setLayoutAnimationEnabledExperimental?.(true);

/**
 * Animate the next layout commit (rows added, removed or reordered) over
 * `motion.base`. No-op on web or under reduced motion.
 */
export function animateLayout() {
  if (Platform.OS === "web" || isReducedMotion()) return;
  LayoutAnimation.configureNext(
    LayoutAnimation.create(motion.base, "easeInEaseOut", "opacity"),
  );
}

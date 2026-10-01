import type { PressableProps } from "react-native";

type StateAriaProps = Pick<
  PressableProps,
  | "aria-busy"
  | "aria-checked"
  | "aria-disabled"
  | "aria-expanded"
  | "aria-selected"
>;

/** React Native Web requires individual ARIA props for native accessibilityState. */
export function pressableWebState(
  props: PressableProps,
  platform: string,
): StateAriaProps {
  if (platform !== "web") return {};
  const state = props.accessibilityState;
  return {
    "aria-busy": props["aria-busy"] ?? state?.busy,
    "aria-checked": props["aria-checked"] ?? state?.checked,
    "aria-disabled": props.disabled
      ? true
      : (props["aria-disabled"] ?? state?.disabled),
    "aria-expanded": props["aria-expanded"] ?? state?.expanded,
    "aria-selected": props["aria-selected"] ?? state?.selected,
  };
}

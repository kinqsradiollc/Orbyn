import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  type KeyboardEvent,
} from "react-native";
import { isReducedMotion } from "../motion";

type Measurable = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

/**
 * How much of `area` the keyboard covers, to pad its bottom by so a footer
 * inside it (a message composer) sits just above the keyboard. `area` is a
 * View filling the space above whatever sits below it (the tab bar, a sheet's
 * safe area); give it `collapsable={false}` and the returned `onLayout`.
 *
 * Measured in window coordinates, so it's right in iOS page sheets (where
 * KeyboardAvoidingView's parent-relative frame is off by the sheet's offset)
 * and on Android whether the window resizes for the keyboard or not. It only
 * measures on keyboard changes, or when the area's frame changes while the
 * keyboard is up; the padding sits inside the frame, so it never feeds back.
 */
export function useKeyboardInset(
  area: RefObject<Measurable | null>,
  enabled = true,
) {
  const [inset, setInset] = useState(0);
  const shown = useRef(0);
  /** Top of the keyboard in window coordinates, or null while it's hidden. */
  const keyboardTop = useRef<number | null>(null);

  const measure = useCallback(
    (duration?: number) => {
      const top = keyboardTop.current;
      const node = area.current;
      if (top === null || !node) return;
      node.measureInWindow((_x, y, _width, height) => {
        if (keyboardTop.current !== top) return;
        const next = Math.min(
          height,
          Math.max(0, Math.round(y + height - top)),
        );
        if (Math.abs(next - shown.current) < 1) return;
        if (duration && !isReducedMotion())
          LayoutAnimation.configureNext({
            duration,
            update: { type: LayoutAnimation.Types.keyboard },
          });
        shown.current = next;
        setInset(next);
      });
    },
    [area],
  );

  useEffect(() => {
    if (!enabled) {
      keyboardTop.current = null;
      shown.current = 0;
      setInset(0);
      return;
    }
    const show = (e: KeyboardEvent) => {
      keyboardTop.current = e.endCoordinates.screenY;
      measure(Platform.OS === "ios" ? e.duration : undefined);
    };
    const hide = (e?: KeyboardEvent) => {
      keyboardTop.current = null;
      if (!shown.current) return;
      if (Platform.OS === "ios" && e?.duration && !isReducedMotion())
        LayoutAnimation.configureNext({
          duration: e.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      shown.current = 0;
      setInset(0);
    };
    // A sheet opened while the keyboard is already up gets the right inset
    // straight away rather than on the next keyboard event. `metrics` is a
    // native-only API — it does not exist in the web build, where calling it
    // threw and took the whole screen down with it — so it is asked for
    // rather than assumed.
    const current = Keyboard.metrics?.();
    if (current) {
      keyboardTop.current = current.screenY;
      measure();
    }
    const subs =
      Platform.OS === "ios"
        ? [
            Keyboard.addListener("keyboardWillChangeFrame", show),
            Keyboard.addListener("keyboardWillHide", hide),
          ]
        : [
            Keyboard.addListener("keyboardDidShow", show),
            Keyboard.addListener("keyboardDidHide", () => hide()),
          ];
    return () => {
      keyboardTop.current = null;
      subs.forEach((sub) => sub.remove());
    };
  }, [enabled, measure]);

  /** Re-measure when the area itself moves or resizes while the keyboard is up. */
  const onLayout = useCallback(() => measure(), [measure]);
  return { inset: enabled ? inset : 0, onLayout };
}

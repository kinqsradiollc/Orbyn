import { useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder } from "react-native";

/**
 * Swipe down to close (MOB-04): a sheet follows the finger down from its
 * grab handle and closes when let go far or fast enough, or springs back.
 * Returns the handlers for the part that is dragged (the handle and title)
 * and the offset to move the sheet by.
 */
export function useSwipeDown(visible: boolean, onClose: () => void) {
  const offset = useRef(new Animated.Value(0)).current;
  const close = useRef(onClose);
  close.current = onClose;
  // Each time it opens, it starts in its place.
  useEffect(() => {
    if (visible) offset.setValue(0);
  }, [visible, offset]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => offset.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 90 || g.vy > 0.8) {
            Animated.timing(offset, {
              toValue: 600,
              duration: 160,
              useNativeDriver: true,
            }).start(() => close.current());
          } else
            Animated.spring(offset, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 4,
            }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(offset, {
            toValue: 0,
            useNativeDriver: true,
          }).start(),
      }),
    [offset],
  );
  return { handlers: responder.panHandlers, offset };
}

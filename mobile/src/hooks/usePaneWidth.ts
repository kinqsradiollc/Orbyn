import { useCallback, useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";

/** Measure the work pane after navigation, safe-area padding and split panels. */
export function usePaneWidth() {
  const windowWidth = useWindowDimensions().width;
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (Number.isFinite(width) && width > 0) setMeasuredWidth(width);
  }, []);
  return { width: measuredWidth ?? windowWidth, onLayout };
}

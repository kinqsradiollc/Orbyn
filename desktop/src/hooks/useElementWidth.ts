import { useEffect, useState } from "react";
import { observeElementWidth } from "./element-width";

/** Track the mounted page itself, including delayed loading and replaced nodes. */
export function useElementWidth() {
  const [element, ref] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    return observeElementWidth(element, setWidth);
  }, [element]);
  return { ref, width };
}

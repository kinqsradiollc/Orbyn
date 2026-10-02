import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { createDiagramExportBridge } from "@orbyn/core";
import { DiagramSurface } from "../../components/DiagramSurface";

/** Use the same strict local diagram surface for authorized HTML snapshots. */
export function useDiagramExport(scope: string) {
  const [request, setRequest] = useState<string>();
  const bridge = useRef<ReturnType<typeof createDiagramExportBridge> | null>(
    null,
  );
  useEffect(() => {
    setRequest(undefined);
    // Keep the isolated engine mounted between diagrams in a batch.
    const current = createDiagramExportBridge((next) => {
      if (next) setRequest(next);
    });
    bridge.current = current;
    return () => {
      current.dispose();
      if (bridge.current === current) bridge.current = null;
    };
  }, [scope]);
  const render = useCallback((source: string) => {
    if (!bridge.current)
      return Promise.reject(
        Object.assign(new Error("Export renderer is unavailable."), {
          name: "AbortError",
        }),
      );
    return bridge.current.render(source);
  }, []);
  const receive = useCallback(
    (data: string) => bridge.current?.receive(data),
    [],
  );
  const signal = () => {
    if (!bridge.current)
      throw Object.assign(new Error("Export renderer is unavailable."), {
        name: "AbortError",
      });
    return bridge.current.signal;
  };
  return {
    render,
    signal,
    surface: request ? (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <DiagramSurface request={request} height={1} onResult={receive} />
      </View>
    ) : null,
  };
}

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { diagramKind, MERMAID_MAX_SVG, parseFlowchart } from "@orbyn/core";
import { DiagramSurface } from "./DiagramSurface";
import { InlineDetails } from "./InlineDetails";
import { colors, fonts, radii, themed } from "../theme";
import { Pressable } from "../motion";
import { saveFile } from "../lib/download";
import { openObject } from "../screens/docs/links";
import { DocNavigationContext } from "../screens/docs/doc-navigation";

/** Full local Mermaid preview; source stays available when parsing fails. */
export function MermaidDiagram({ text }: { text: string }) {
  const navigation = useContext(DocNavigationContext);
  const instance = useId();
  const { height: windowHeight } = useWindowDimensions();
  const canvasLimit = Math.min(
    480,
    Math.max(160, Math.floor(windowHeight / 2)),
  );
  const sequence = useRef(0);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panRequest, setPanRequest] = useState<string>();
  const panSequence = useRef(0);
  const [actualSize, setActualSize] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [result, setResult] = useState<{
    id: string;
    error?: string;
    svg?: string;
    height?: number;
  } | null>(null);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const mounted = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setExportError("");
  }, [text]);
  const palette = JSON.stringify({
    background: colors.surface,
    primaryColor: colors.surface,
    primaryBorderColor: colors.accent,
    primaryTextColor: colors.text,
    secondaryColor: colors.soft,
    tertiaryColor: colors.surfaceMuted,
    lineColor: colors.muted,
    textColor: colors.text,
    noteBkgColor: colors.highBg,
    noteTextColor: colors.text,
    highText: colors.highText,
    mediumText: colors.mediumText,
    lowText: colors.lowText,
  });
  const request = useMemo(
    () =>
      JSON.stringify({
        type: "orbyn-diagram",
        id: `${instance}-${++sequence.current}`,
        source: text,
        palette: JSON.parse(palette),
        zoom,
        actualSize,
        viewportWidth: viewportWidth || undefined,
      }),
    [instance, text, palette, zoom, actualSize, viewportWidth, retry],
  );
  const id = JSON.parse(request).id as string;
  const current = result?.id === id ? result : null;
  const latestRequest = useRef(id);
  latestRequest.current = id;
  useEffect(() => {
    const timeout = setTimeout(() => {
      setResult((previous) =>
        previous?.id === id
          ? previous
          : {
              id,
              error:
                "Couldn’t load the preview. Retry or read the source below.",
            },
      );
    }, 30_000);
    return () => clearTimeout(timeout);
  }, [id]);
  const receive = useCallback(
    (data: string) => {
      if (data.length > MERMAID_MAX_SVG + 100_000) return;
      try {
        const response = JSON.parse(data);
        if (response.type !== "orbyn-diagram-result" || response.id !== id)
          return;
        if (response.error && typeof response.error !== "string") return;
        if (
          response.svg &&
          (typeof response.svg !== "string" ||
            response.svg.length > MERMAID_MAX_SVG)
        )
          return;
        if (response.height !== undefined && !Number.isFinite(response.height))
          return;
        setResult(response);
      } catch {
        /* Ignore malformed messages from the isolated surface. */
      }
    },
    [id],
  );
  const links = useMemo(
    () => parseFlowchart(text)?.nodes.filter((n) => n.link) ?? [],
    [text],
  );
  return (
    <View
      style={s.box}
      onLayout={(event) => {
        const width = Math.max(
          120,
          Math.floor(event.nativeEvent.layout.width - 16),
        );
        setViewportWidth((previous) => (previous === width ? previous : width));
      }}
    >
      <View style={s.toolbar}>
        <Text style={s.label}>{diagramKind(text)} diagram</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: sourceOpen || !!current?.error }}
          onPress={() => setSourceOpen(!sourceOpen)}
          style={s.button}
        >
          <Text style={s.action}>Source</Text>
        </Pressable>
      </View>
      <InlineDetails title="Diagram controls">
        <View style={s.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom out diagram"
            accessibilityState={{ disabled: zoom <= 0.5 }}
            disabled={zoom <= 0.5}
            onPress={() => setZoom((v) => Math.max(0.5, v - 0.25))}
            style={s.button}
          >
            <Text style={s.action}>−</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom in diagram"
            accessibilityState={{ disabled: zoom >= 3 }}
            disabled={zoom >= 3}
            onPress={() => setZoom((v) => Math.min(3, v + 0.25))}
            style={s.button}
          >
            <Text style={s.action}>+</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fit diagram to width"
            onPress={() => {
              setActualSize(false);
              setZoom(1);
            }}
            style={s.button}
          >
            <Text style={s.action}>Fit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show diagram at actual size"
            accessibilityState={{ selected: actualSize }}
            onPress={() => {
              setActualSize(true);
              setZoom(1);
            }}
            style={s.button}
          >
            <Text style={s.action}>Actual size</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!current?.svg || exporting}
            accessibilityState={{
              disabled: !current?.svg || exporting,
              busy: exporting,
            }}
            onPress={() => {
              if (!current?.svg || exportLock.current) return;
              exportLock.current = true;
              setExportError("");
              setExporting(true);
              void saveFile("diagram.svg", current.svg, "image/svg+xml")
                .catch(() => {
                  if (mounted.current && latestRequest.current === id)
                    setExportError("Couldn’t export the diagram. Try again.");
                })
                .finally(() => {
                  exportLock.current = false;
                  if (mounted.current) setExporting(false);
                });
            }}
            style={s.button}
          >
            <Text style={s.action}>
              {exporting ? "Exporting…" : "Export SVG"}
            </Text>
          </Pressable>
        </View>
        {(actualSize || zoom > 1 || (current?.height ?? 0) > canvasLimit) && (
          <View style={s.toolbar}>
            <Text style={s.label}>Move diagram</Text>
            {[
              { label: "left", mark: "←", x: -160, y: 0 },
              { label: "right", mark: "→", x: 160, y: 0 },
              { label: "up", mark: "↑", x: 0, y: -160 },
              { label: "down", mark: "↓", x: 0, y: 160 },
            ].map((direction) => (
              <Pressable
                key={direction.label}
                accessibilityRole="button"
                accessibilityLabel={`Pan diagram ${direction.label}`}
                disabled={!current?.svg}
                style={s.button}
                onPress={() =>
                  setPanRequest(
                    JSON.stringify({
                      type: "orbyn-diagram-pan",
                      id,
                      sequence: ++panSequence.current,
                      x: direction.x,
                      y: direction.y,
                    }),
                  )
                }
              >
                <Text style={s.action}>{direction.mark}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </InlineDetails>
      <DiagramSurface
        request={request}
        panRequest={panRequest}
        height={Math.min(canvasLimit, Math.max(120, current?.height ?? 240))}
        onResult={receive}
      />
      {!current && <Text style={s.note}>Drawing diagram…</Text>}
      {!!current?.error && (
        <View style={s.toolbar}>
          <Text accessibilityRole="alert" style={s.note}>
            {current.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={s.button}
            onPress={() => setRetry((value) => value + 1)}
          >
            <Text style={s.action}>Retry preview</Text>
          </Pressable>
        </View>
      )}
      {!!exportError && <Text style={s.note}>{exportError}</Text>}
      {(sourceOpen || current?.error) && (
        <ScrollView style={s.source} nestedScrollEnabled>
          <ScrollView horizontal contentContainerStyle={s.sourceBody}>
            <Text selectable style={s.sourceText}>
              {text}
            </Text>
          </ScrollView>
        </ScrollView>
      )}
      {links.map((node) => (
        <Pressable
          key={node.id}
          accessibilityRole="button"
          style={s.button}
          onPress={() =>
            openObject(node.link!, undefined, navigation?.onAppLink)
          }
        >
          <Text style={s.action}>Open {node.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = themed(() => ({
  box: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: "hidden" as const,
    padding: 8,
    gap: 8,
  },
  toolbar: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 13,
    marginRight: 8,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center" as const,
  },
  action: { color: colors.accent, fontFamily: fonts.regular, fontSize: 13 },
  note: {
    flexShrink: 1,
    color: colors.textSoft,
    fontFamily: fonts.regular,
    fontSize: 13,
    padding: 8,
  },
  source: { backgroundColor: colors.surfaceMuted, maxHeight: 220 },
  sourceBody: { padding: 8 },
  sourceText: { color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
}));

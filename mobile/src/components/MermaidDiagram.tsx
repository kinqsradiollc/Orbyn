import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { diagramKind, MERMAID_MAX_SVG, parseFlowchart } from "@orbyn/core";
import { DiagramSurface } from "./DiagramSurface";
import { colors, fonts, radii, themed } from "../theme";
import { Pressable } from "../motion";
import { saveFile } from "../lib/download";
import { openObject } from "../screens/docs/links";

/** Full local Mermaid preview; source stays available when parsing fails. */
export function MermaidDiagram({ text }: { text: string }) {
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
    [instance, text, palette, zoom, actualSize, viewportWidth],
  );
  const id = JSON.parse(request).id as string;
  const current = result?.id === id ? result : null;
  useEffect(() => {
    const timeout = setTimeout(() => {
      setResult((previous) =>
        previous?.id === id
          ? previous
          : {
              id,
              error:
                "The diagram preview did not respond. Its source is available below.",
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
          onPress={() => setSourceOpen(!sourceOpen)}
          style={s.button}
        >
          <Text style={s.action}>Source</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out diagram"
          onPress={() => setZoom((v) => Math.max(0.5, v - 0.25))}
          style={s.button}
        >
          <Text style={s.action}>−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in diagram"
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
          disabled={!current?.svg}
          onPress={() => {
            setExportError("");
            if (current?.svg)
              void saveFile("diagram.svg", current.svg, "image/svg+xml").catch(
                () =>
                  setExportError(
                    "The diagram could not be exported. Try again.",
                  ),
              );
          }}
          style={s.button}
        >
          <Text style={s.action}>Export SVG</Text>
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
      <DiagramSurface
        request={request}
        panRequest={panRequest}
        height={Math.min(canvasLimit, Math.max(120, current?.height ?? 240))}
        onResult={receive}
      />
      {!current && <Text style={s.note}>Drawing diagram…</Text>}
      {!!current?.error && <Text style={s.note}>{current.error}</Text>}
      {!!exportError && <Text style={s.note}>{exportError}</Text>}
      {(sourceOpen || current?.error) && (
        <ScrollView horizontal style={s.source}>
          <Text selectable style={s.sourceText}>
            {text}
          </Text>
        </ScrollView>
      )}
      {links.map((node) => (
        <Pressable
          key={node.id}
          accessibilityRole="button"
          style={s.button}
          onPress={() => openObject(node.link!)}
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
  button: { paddingHorizontal: 10, paddingVertical: 8, minHeight: 34 },
  action: { color: colors.accent, fontFamily: fonts.regular, fontSize: 13 },
  note: {
    color: colors.textSoft,
    fontFamily: fonts.regular,
    fontSize: 13,
    padding: 8,
  },
  source: { backgroundColor: colors.surfaceMuted, padding: 8 },
  sourceText: { color: colors.text, fontFamily: "monospace", fontSize: 13 },
}));

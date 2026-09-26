import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";
import {
  layoutConnections,
  nodeLabel,
  type ConnectionMap,
  type ConnectionNode,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { openObject } from "./links";

/**
 * The Connections map (CNV-02) on the phone, in a page's or project's Info:
 * what it's linked to, one or two steps out, in the palette's tones by
 * kind. Tapping a node opens it. Things the reader can't open are never on
 * it; below the drawing, the same things are listed for screen readers and
 * small thumbs.
 */
const KIND_WORDS: Record<ConnectionNode["kind"], string> = {
  doc: "Page",
  task: "Task",
  event: "Event",
  project: "Project",
  person: "Person",
  date: "Date",
};

export function ConnectionsMap({
  kind,
  id,
  revision,
  report,
}: {
  kind: "doc" | "project";
  id: string;
  revision?: string | number;
  report: (e: unknown) => void;
}) {
  const [depth, setDepth] = useState<1 | 2>(1);
  const [map, setMap] = useState<ConnectionMap | null>(null);
  const [width, setWidth] = useState(300);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let live = true;
    client.connectionMap(kind, id, depth).then(
      (m) => live && setMap(m),
      (e) => {
        if (!live) return;
        setMap({ nodes: [], edges: [], truncated: false });
        reportRef.current(e);
      },
    );
    return () => {
      live = false;
    };
  }, [kind, id, depth, revision]);

  const size = Math.max(220, Math.min(width, 420));
  const placed = map ? layoutConnections(map, size) : [];
  const at = new Map(placed.map((n) => [n.key, n]));
  const tone = (n: ConnectionNode) =>
    n.depth === 0
      ? colors.accent
      : n.kind === "doc"
        ? colors.accent
        : n.kind === "task" || n.kind === "event"
          ? colors.textSoft
          : n.kind === "project"
            ? colors.text
            : colors.muted;
  const open = (n: ConnectionNode) =>
    n.depth > 0 && openObject({ kind: n.kind, id: n.id } as never);
  const neighbours = placed.filter((n) => n.depth > 0);
  return (
    <View
      style={s.wrap}
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
    >
      <View style={s.head}>
        <Text style={s.label}>CONNECTIONS</Text>
        <View style={s.depth} accessibilityRole="radiogroup">
          {([1, 2] as const).map((d) => (
            <Pressable
              key={d}
              accessibilityRole="radio"
              accessibilityState={{ checked: depth === d }}
              hitSlop={8}
              onPress={() => setDepth(d)}
              style={[s.depthButton, depth === d && s.depthOn]}
            >
              <Text style={[s.depthText, depth === d && s.depthTextOn]}>
                {d === 1 ? "1 step" : "2 steps"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {map === null ? (
        <Text style={s.small}>Drawing the map…</Text>
      ) : !neighbours.length ? (
        <Text style={s.small}>
          Nothing is linked here yet. Type [[ in a page to link one thing to
          another.
        </Text>
      ) : (
        <>
          <Svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={s.svg}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {map.edges.map((e) => {
              const a = at.get(e.from);
              const b = at.get(e.to);
              if (!a || !b) return null;
              return (
                <Line
                  key={`${e.from}|${e.to}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={colors.border}
                  strokeWidth={1.2}
                  strokeDasharray={
                    a.depth === 2 || b.depth === 2 ? "3 3" : undefined
                  }
                />
              );
            })}
            {placed.map((n) => {
              const r = n.depth === 0 ? 9 : n.depth === 1 ? 7 : 5;
              const below = n.depth === 0 || n.y > size / 2 + 1;
              return (
                <G key={n.key} onPress={() => open(n)}>
                  <Circle
                    cx={n.x}
                    cy={n.y}
                    r={r + 10}
                    fill="transparent"
                    stroke="none"
                  />
                  <Circle
                    cx={n.x}
                    cy={n.y}
                    r={r}
                    fill={n.depth === 0 ? colors.accent : colors.surface}
                    stroke={tone(n)}
                    strokeWidth={2}
                  />
                  <SvgText
                    x={n.x}
                    y={below ? n.y + r + 12 : n.y - r - 5}
                    fontSize={11}
                    fontFamily={fonts.medium}
                    fill={n.closed ? colors.muted : colors.text}
                    textAnchor="middle"
                  >
                    {nodeLabel(n.title, 16)}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
          <View style={s.list}>
            {neighbours.map((n) => (
              <Pressable
                key={n.key}
                accessibilityRole="button"
                accessibilityLabel={`${KIND_WORDS[n.kind]}: ${n.title}`}
                onPress={() => open(n)}
                style={({ pressed }) => [s.item, pressed && s.pressed]}
              >
                <View style={[s.dot, { borderColor: tone(n) }]} />
                <Text style={s.itemText} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={s.small}>
                  {KIND_WORDS[n.kind]}
                  {n.depth === 2 ? " · 2 steps" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {map?.truncated && (
        <Text style={s.small}>
          Showing the closest {map.nodes.length - 1}. There's more further out.
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8 },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    label: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.4,
      color: colors.muted,
    },
    depth: {
      flexDirection: "row",
      padding: 2,
      gap: 2,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
    },
    depthButton: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
    },
    depthOn: { backgroundColor: colors.surface },
    depthText: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted },
    depthTextOn: { color: colors.text },
    svg: { alignSelf: "center" },
    small: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    list: { gap: 2 },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 36,
      paddingHorizontal: 8,
      borderRadius: radii.input,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    dot: {
      width: 10,
      height: 10,
      borderRadius: radii.pill,
      borderWidth: 2,
    },
    itemText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.text,
    },
  }),
);

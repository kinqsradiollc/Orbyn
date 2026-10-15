import React, { useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";
import {
  layoutConnections,
  nodeLabel,
  type ConnectionMap,
  type ConnectionNode,
  type ObjectRef,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { openObject } from "./links";
import { DocNavigationContext } from "./doc-navigation";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { SmallAction } from "../../components/SmallAction";
import { InlineDetails } from "../../components/InlineDetails";

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

export function ConnectionsMap(
  props: React.ComponentProps<typeof ConnectionsMapBody>,
) {
  return (
    <ConnectionsMapBody
      key={`${session.token}:${props.kind}:${props.id}`}
      {...props}
    />
  );
}
function ConnectionsMapBody({
  kind,
  id,
  revision,
  report,
  onOpen,
}: {
  kind: "doc" | "project";
  id: string;
  revision?: string | number;
  report: (e: unknown) => void;
  onOpen?: (ref: ObjectRef) => void;
}) {
  const [depth, setDepth] = useState<1 | 2>(1);
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const navigation = useContext(DocNavigationContext);
  const key = JSON.stringify([kind, id, depth, revision]);
  const [result, setResult] = useState<{
    key: string;
    map: ConnectionMap;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [all, setAll] = useState(false);
  const map = result?.key === key ? result.map : null;
  const error = failure?.key === key ? failure.message : "";
  const [width, setWidth] = useState(300);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let live = true;
    setFailure(null);
    client.connectionMap(kind, id, depth).then(
      (map) => {
        if (live && session.token === owner) setResult({ key, map });
      },
      (e) => {
        if (!live || session.token !== owner) return;
        setFailure({ key, message: errorText(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [kind, id, depth, revision, retry]);

  const size = Math.max(1, Math.min(width, 420));
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
  const openable = (n: ConnectionNode) =>
    n.depth > 0 && n.kind !== "person" && n.kind !== "date";
  const open = (n: ConnectionNode) => {
    if (!mounted.current || session.token !== owner || !openable(n)) return;
    try {
      const ref = { kind: n.kind, id: n.id };
      if (onOpen) onOpen(ref);
      else openObject(ref, undefined, navigation?.onAppLink);
    } catch (e) {
      reportRef.current(e);
    }
  };
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
      {error ? (
        <View>
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
          <SmallAction
            label="Retry connections"
            disabled={false}
            onPress={() => setRetry((n) => n + 1)}
          />
        </View>
      ) : map === null ? (
        <Text style={s.small}>Loading connections…</Text>
      ) : !neighbours.length ? (
        <Text style={s.small}>No connections yet.</Text>
      ) : (
        <>
          <InlineDetails title="Map">
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
                  <G
                    key={n.key}
                    onPress={openable(n) ? () => open(n) : undefined}
                  >
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
          </InlineDetails>
          <View style={s.list}>
            {(all ? neighbours : neighbours.slice(0, 8)).map((n) => (
              <Pressable
                key={n.key}
                accessibilityRole={openable(n) ? "button" : "text"}
                accessibilityLabel={`${KIND_WORDS[n.kind]}: ${n.title}`}
                disabled={!openable(n)}
                onPress={openable(n) ? () => open(n) : undefined}
                style={({ pressed }) => [s.item, pressed && s.pressed]}
              >
                <View style={[s.dot, { borderColor: tone(n) }]} />
                <Text style={s.itemText}>{n.title}</Text>
                <Text style={s.small}>
                  {KIND_WORDS[n.kind]}
                  {n.depth === 2 ? " · 2 steps" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
          {neighbours.length > 8 && (
            <SmallAction
              label={
                all
                  ? "Show fewer"
                  : `Show all connections (${neighbours.length})`
              }
              disabled={false}
              onPress={() => setAll((v) => !v)}
            />
          )}
        </>
      )}
      {map?.truncated && (
        <Text style={s.small}>
          Closest {map.nodes.length - 1} connections shown.
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8 },
    head: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    label: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 13,
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
      paddingVertical: 8,
      minHeight: 44,
      justifyContent: "center",
      borderRadius: radii.pill,
    },
    depthOn: { backgroundColor: colors.surface },
    depthText: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
    depthTextOn: { color: colors.text },
    svg: { alignSelf: "center" },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    small: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    list: { gap: 2 },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingVertical: 8,
      flexWrap: "wrap",
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
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 140,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.text,
    },
  }),
);

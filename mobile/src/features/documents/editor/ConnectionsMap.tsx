import React, { useContext, useEffect, useRef, useState, useMemo } from "react";
import { StyleSheet, Text, View, PanResponder } from "react-native";
import { Pressable } from "../../../motion";
import Svg, {
  Circle,
  G,
  Line,
  Ellipse,
  Text as SvgText,
} from "react-native-svg";
import {
  projectSpace,
  spaceLabels,
  boundedView,
  INITIAL_SPACE_VIEW,
  type SpaceView,
  nodeLabel,
  type ConnectionMap,
  type ConnectionNode,
  type ObjectRef,
} from "@orbyn/core";
import { client } from "../../../lib/api";
import { colors, fonts, radii, themed } from "../../../theme";
import { openObject } from "./links";
import { DocNavigationContext } from "../library/doc-navigation";
import { session } from "../../../lib/session";
import { errorText } from "../../../lib/errors";
import { SmallAction } from "../../../components/SmallAction";
import { InlineDetails } from "../../../components/InlineDetails";

/**
 * The Connections map (CNV-02) on the phone, in a page's or project's Info:
 * what it's linked to, one or two steps out, in the palette's tones by
 * kind. Horizontal drag or controls orbit the 3D scene; tapping selects a
 * node, then Open follows it. The list keeps direct navigation available to
 * screen readers and small thumbs. The API decides what the reader may see.
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

  const [view, setView] = useState<SpaceView>(INITIAL_SPACE_VIEW);
  const [selected, setSelected] = useState<string | null>(null);
  const currentView = useRef(view);
  currentView.current = view;
  const gestureView = useRef(view);
  const orbit = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, g) =>
          Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: () => {
          gestureView.current = currentView.current;
        },
        onPanResponderMove: (_event, g) =>
          setView(
            boundedView({
              ...gestureView.current,
              yaw: gestureView.current.yaw + g.dx * 0.01,
              pitch: gestureView.current.pitch + g.dy * 0.01,
            }),
          ),
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );
  const size = Math.max(1, Math.min(width, 420));
  const sceneScale = size / 640;
  const placed = map ? projectSpace(map, view) : [];
  const chosen =
    map?.nodes.find((n) => n.key === selected) ??
    map?.nodes.find((n) => n.depth === 0);
  const labels = spaceLabels(placed, chosen?.key ?? "");
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
  const neighbours = (map?.nodes ?? []).filter((n) => n.depth > 0);
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
            <View style={s.orbitTools}>
              {(
                [
                  [
                    "Rotate connections left",
                    "↶",
                    () =>
                      setView((v) => boundedView({ ...v, yaw: v.yaw - 0.3 })),
                  ],
                  [
                    "Rotate connections right",
                    "↷",
                    () =>
                      setView((v) => boundedView({ ...v, yaw: v.yaw + 0.3 })),
                  ],
                  [
                    "Zoom out connections",
                    "−",
                    () =>
                      setView((v) => boundedView({ ...v, zoom: v.zoom - 0.2 })),
                  ],
                  [
                    "Zoom in connections",
                    "+",
                    () =>
                      setView((v) => boundedView({ ...v, zoom: v.zoom + 0.2 })),
                  ],
                  [
                    "Reset connections view",
                    "Reset",
                    () => setView(INITIAL_SPACE_VIEW),
                  ],
                ] as const
              ).map(([label, text, action]) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={action}
                  style={s.orbitButton}
                >
                  <Text style={s.orbitText}>{text}</Text>
                </Pressable>
              ))}
            </View>
            <View {...orbit.panHandlers}>
              <Svg
                width={size}
                height={size * 0.625}
                viewBox={`0 0 ${size} ${size * 0.625}`}
                style={s.svg}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Ellipse
                  cx={320 * sceneScale}
                  cy={200 * sceneScale}
                  rx={175 * sceneScale}
                  ry={65 * sceneScale}
                  fill="none"
                  stroke={colors.border}
                  strokeDasharray="3 8"
                />
                {map.edges.map((e) => {
                  const a = at.get(e.from),
                    b = at.get(e.to);
                  return a && b ? (
                    <Line
                      key={`${e.from}|${e.to}`}
                      x1={a.x * sceneScale}
                      y1={a.y * sceneScale}
                      x2={b.x * sceneScale}
                      y2={b.y * sceneScale}
                      stroke={
                        e.from === chosen?.key || e.to === chosen?.key
                          ? colors.accent
                          : colors.border
                      }
                      strokeWidth={1.2}
                    />
                  ) : null;
                })}
                {placed.map((n) => {
                  const label = labels.get(n.key);
                  return (
                    <G key={n.key} onPress={() => setSelected(n.key)}>
                      <Circle
                        cx={n.x * sceneScale}
                        cy={n.y * sceneScale}
                        r={22}
                        fill="transparent"
                      />
                      <Circle
                        cx={n.x * sceneScale}
                        cy={n.y * sceneScale}
                        r={(n.depth === 0 ? 13 : 9) * n.scale * sceneScale}
                        fill={n.depth === 0 ? colors.accent : colors.surface}
                        stroke={tone(n)}
                        strokeWidth={n.key === chosen?.key ? 3 : 2}
                      />
                      {label && (
                        <SvgText
                          x={label.x * sceneScale}
                          y={label.y * sceneScale}
                          fontSize={11}
                          fontFamily={fonts.medium}
                          fill={colors.text}
                          textAnchor="middle"
                        >
                          {nodeLabel(
                            n.title,
                            Math.max(9, Math.floor((18 * size) / 640)),
                          )}
                        </SvgText>
                      )}
                    </G>
                  );
                })}
              </Svg>
            </View>
            {chosen && (
              <View style={s.selection}>
                <Text style={s.small}>{KIND_WORDS[chosen.kind]}</Text>
                <Text style={s.selectionTitle} accessibilityLiveRegion="polite">
                  {chosen.title}
                </Text>
                {openable(chosen) && (
                  <SmallAction
                    label="Open selected connection"
                    disabled={false}
                    onPress={() => open(chosen)}
                  />
                )}
              </View>
            )}
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
    orbitTools: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    orbitButton: {
      minWidth: 44,
      minHeight: 44,
      paddingHorizontal: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
    },
    orbitText: { color: colors.text, fontSize: 15, fontFamily: fonts.medium },
    selection: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingVertical: 12,
      gap: 6,
    },
    selectionTitle: {
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.medium,
    },

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

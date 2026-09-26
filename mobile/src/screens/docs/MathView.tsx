import React, { useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  layoutMath,
  mathSpoken,
  type MathAccent,
  type MathNode,
} from "@orbyn/core";
import { colors, themed } from "../../theme";

/**
 * Maths typeset on the phone (EDT-12), drawn from the layout tree in
 * @orbyn/core: fractions over a rule, scripts raised and lowered, roots
 * with their bar, big operators with limits, matrices in a grid. No web
 * view and nothing to download, so it works offline and follows the
 * system text size like the words around it.
 */

/** A serif face, as maths is set: the platform's own. */
const SERIF = Platform.select({
  ios: "Times New Roman",
  android: "serif",
  default: "serif",
});

const MARKS: Record<Exclude<MathAccent, "under">, string> = {
  bar: "‾",
  hat: "^",
  vec: "→",
  dot: "˙",
  ddot: "¨",
  tilde: "~",
};

function Box({ node, size }: { node: MathNode; size: number }) {
  switch (node.k) {
    case "sym":
      return (
        <Text
          style={[
            s.sym,
            {
              fontSize: size,
              lineHeight: size * 1.25,
              fontStyle: node.font === "italic" ? "italic" : "normal",
              fontWeight: node.font === "bold" ? "700" : "400",
              marginHorizontal: node.op ? size * 0.22 : 0,
              // A named function (sin, lim) keeps a thin space after it.
              marginRight:
                node.font === "roman" && /^[a-z]{2,}$/.test(node.s)
                  ? size * 0.15
                  : node.op
                    ? size * 0.22
                    : 0,
            },
          ]}
        >
          {node.s}
        </Text>
      );
    case "row":
      return (
        <View style={s.row}>
          {node.items.map((item, i) => (
            <Box key={i} node={item} size={size} />
          ))}
        </View>
      );
    case "space":
      return <View style={{ width: Math.max(0, node.em * size) }} />;
    case "big":
      return (
        <Text
          style={[s.sym, { fontSize: size * 1.45, lineHeight: size * 1.6 }]}
        >
          {node.s}
        </Text>
      );
    case "frac": {
      const inner = size * 0.85;
      return (
        <View style={[s.frac, { marginHorizontal: size * 0.12 }]}>
          <Box node={node.num} size={inner} />
          <View
            style={[
              s.rule,
              { opacity: node.line ? 1 : 0, marginVertical: size * 0.08 },
            ]}
          />
          <Box node={node.den} size={inner} />
        </View>
      );
    }
    case "scripts": {
      const small = Math.max(9, size * 0.7);
      if (node.limits)
        return (
          <View style={s.frac}>
            {node.sup ? <Box node={node.sup} size={small} /> : null}
            <Box node={node.base} size={size} />
            {node.sub ? <Box node={node.sub} size={small} /> : null}
          </View>
        );
      return (
        <View style={s.row}>
          <Box node={node.base} size={size} />
          <View
            style={[
              s.scripts,
              {
                // Room above for the raised script, below for the lowered.
                marginTop: node.sup ? 0 : size * 0.5,
                marginBottom: node.sub ? 0 : size * 0.55,
              },
            ]}
          >
            {node.sup ? <Box node={node.sup} size={small} /> : null}
            {node.sup && node.sub ? (
              <View style={{ height: size * 0.15 }} />
            ) : null}
            {node.sub ? <Box node={node.sub} size={small} /> : null}
          </View>
        </View>
      );
    }
    case "sqrt":
      return (
        <View style={s.row}>
          {node.index ? (
            <View
              style={{ marginBottom: size * 0.6, marginRight: -size * 0.2 }}
            >
              <Box node={node.index} size={size * 0.55} />
            </View>
          ) : null}
          <Text
            style={[s.sym, { fontSize: size * 1.2, lineHeight: size * 1.4 }]}
          >
            √
          </Text>
          <View style={[s.radicand, { paddingTop: size * 0.08 }]}>
            <Box node={node.body} size={size} />
          </View>
        </View>
      );
    case "accent":
      if (node.mark === "under")
        return (
          <View style={s.under}>
            <Box node={node.body} size={size} />
          </View>
        );
      return (
        <View style={s.frac}>
          <Text
            style={[
              s.sym,
              {
                fontSize: size * 0.7,
                lineHeight: size * 0.55,
                marginBottom: -size * 0.1,
              },
            ]}
          >
            {MARKS[node.mark]}
          </Text>
          <Box node={node.body} size={size} />
        </View>
      );
    case "fence":
      return (
        <View style={s.row}>
          {node.open ? (
            <Text
              style={[
                s.sym,
                s.fence,
                { fontSize: size * 1.35, lineHeight: size * 1.6 },
              ]}
            >
              {node.open}
            </Text>
          ) : null}
          <Box node={node.body} size={size} />
          {node.close ? (
            <Text
              style={[
                s.sym,
                s.fence,
                { fontSize: size * 1.35, lineHeight: size * 1.6 },
              ]}
            >
              {node.close}
            </Text>
          ) : null}
        </View>
      );
    case "table":
      return (
        <View style={s.row}>
          {node.open ? (
            <Text
              style={[
                s.sym,
                s.fence,
                {
                  fontSize: size * (1 + node.rows.length * 0.45),
                  lineHeight: size * (1.2 + node.rows.length * 0.55),
                },
              ]}
            >
              {node.open}
            </Text>
          ) : null}
          <View style={s.grid}>
            {node.rows.map((row, r) => (
              <View key={r} style={s.row}>
                {row.map((cell, c) => (
                  <View
                    key={c}
                    style={[
                      s.cell,
                      {
                        alignItems:
                          node.align === "left" ? "flex-start" : "center",
                        marginHorizontal: size * 0.4,
                      },
                    ]}
                  >
                    <Box node={cell} size={size} />
                  </View>
                ))}
              </View>
            ))}
          </View>
          {node.close ? (
            <Text
              style={[
                s.sym,
                s.fence,
                {
                  fontSize: size * (1 + node.rows.length * 0.45),
                  lineHeight: size * (1.2 + node.rows.length * 0.55),
                },
              ]}
            >
              {node.close}
            </Text>
          ) : null}
        </View>
      );
  }
}

/**
 * One equation: `display` for a line of its own (centred, scrolled sideways
 * when wider than the screen), otherwise inline in a sentence.
 */
export function MathView({
  tex,
  display = false,
  size = 16,
}: {
  tex: string;
  display?: boolean;
  size?: number;
}) {
  const node = useMemo(() => layoutMath(tex), [tex]);
  const spoken = useMemo(() => mathSpoken(node).replace(/\s+/g, " "), [node]);
  if (!display)
    return (
      <View
        style={s.inline}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Maths: ${spoken}`}
      >
        <Box node={node} size={size} />
      </View>
    );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.display}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Maths: ${spoken}`}
    >
      <Box node={node} size={size * 1.1} />
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    sym: { color: colors.text, fontFamily: SERIF },
    fence: { color: colors.textSoft },
    row: { flexDirection: "row", alignItems: "center" },
    frac: { alignItems: "center", justifyContent: "center" },
    rule: {
      alignSelf: "stretch",
      height: StyleSheet.hairlineWidth * 2,
      backgroundColor: colors.text,
    },
    scripts: { justifyContent: "space-between" },
    radicand: { borderTopWidth: 1, borderTopColor: colors.text },
    under: { borderBottomWidth: 1, borderBottomColor: colors.text },
    grid: { gap: 4 },
    cell: { justifyContent: "center" },
    inline: { flexDirection: "row", alignItems: "center" },
    display: {
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 6,
    },
  }),
);

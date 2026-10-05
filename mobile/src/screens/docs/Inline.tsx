import React, { useContext } from "react";
import { Alert, Linking, StyleSheet, Text } from "react-native";
import {
  layoutMath,
  docLinkDestination,
  mathToText,
  mentionedPerson,
  parseDocInline,
  parseObjectHref,
  tagRuns,
  type TaggedRun,
} from "@orbyn/core";
import { colors, fonts, themed } from "../../theme";
import type { Mark } from "./marks";
import { LinkPillText } from "./links";
import { FootnoteContext } from "./footnotes";
import { MathView } from "./MathView";
import { DocNavigationContext } from "./doc-navigation";
import { webOrigin } from "../../lib/api";
import { openAppUrl } from "../../hooks/useAppLinks";

/** Maths that is more than a row of symbols: it is typeset, not spelled out. */
const typeset = (tex: string) => {
  const node = layoutMath(tex);
  return (
    node.k !== "sym" &&
    (node.k !== "row" ||
      node.items.some((n) => n.k !== "sym" && n.k !== "space"))
  );
};

/**
 * One line of text with its inline styling applied.
 *
 * The phone used to show a line exactly as it is stored, so `**bold**` read
 * as four asterisks and a word while the desktop showed it bold. The same
 * reader on two devices should see the same page, so the line is parsed here
 * the way it is parsed there.
 *
 * `marks` are stretches carrying a remark, as character ranges into the
 * line's source. The words themselves are tinted, so a remark on a phone
 * points at what it is about rather than at the whole line.
 */
export function Inline({
  text,
  style,
  marks = [],
}: {
  text: string;
  style?: object;
  marks?: Mark[];
}) {
  const notes = useContext(FootnoteContext);
  // A #tag stands apart from the words around it, on a quiet ground.
  const runs: TaggedRun[] = parseDocInline(text, notes.references).flatMap(
    (run) => tagRuns(run, text),
  );
  const navigation = useContext(DocNavigationContext);
  const followLink = (href: string) => {
    const destination = docLinkDestination(href, webOrigin);
    const report =
      navigation?.report ??
      ((error: unknown) =>
        Alert.alert(
          "Could not open link",
          error instanceof Error ? error.message : "Please try again.",
        ));
    if (!destination)
      return report(new Error("This link cannot be opened safely."));
    if (destination.kind === "fragment") {
      if (navigation) navigation.onFragment(destination.fragment);
      else report(new Error("Open this page to follow its heading link."));
    } else if (destination.kind === "app") {
      (navigation?.onAppLink ?? openAppUrl)(destination.url);
    } else void Linking.openURL(destination.url).catch(report);
  };
  return (
    <>
      {runs.map((run, i) => {
        const lit = marks.some(
          (m) => m.start < run.start + run.text.length && m.end > run.start,
        );
        const shown = run.math ? mathToText(run.text) : run.text;
        const formatting = [
          style,
          run.bold && s.bold,
          run.italic && s.italic,
          run.highlight && s.highlight,
          run.highlight && run.tint === "green" && s.green,
          run.highlight && run.tint === "rose" && s.rose,
          run.strike && s.strike,
        ];
        // A footnote's marker: its number, small; its words a tap away.
        if (run.footnote) {
          const n = notes.numbers.get(run.footnote) ?? run.footnote;
          const words = notes.texts.get(run.footnote);
          return (
            <Text
              key={i}
              style={[formatting, s.footnote]}
              accessibilityLabel={`Footnote ${n}${words ? `: ${words}` : ""}`}
              onPress={
                words ? () => notes.onShow?.(String(n), words) : undefined
              }
            >
              {` ${n}`}
            </Text>
          );
        }
        // Where the line came from (`[src: …]`): a small quiet chip.
        if (run.source)
          return (
            <Text
              key={i}
              style={[formatting, s.source]}
              accessibilityLabel={`Source: ${run.text}`}
            >
              {` ${run.text} `}
            </Text>
          );
        // Maths with a fraction, a script or a root is set as maths
        // (EDT-12); a plain run of symbols reads fine as text.
        if (run.math && typeset(run.text)) {
          const size =
            (StyleSheet.flatten(style as object) as { fontSize?: number })
              ?.fontSize ?? 16;
          return <MathView key={i} tex={run.text} size={size} />;
        }
        // A link made with the picker reads as a pill with the thing's
        // live title, and opens it in the app rather than the browser.
        if (run.link && parseObjectHref(run.link))
          return (
            <LinkPillText
              key={i}
              href={run.link}
              label={run.text}
              style={formatting}
            />
          );
        // "@Anna": someone named in the page, a quiet pill, not a link.
        const person = !!run.link && !!mentionedPerson(run.link);
        return (
          <Text
            key={i}
            style={[
              formatting,
              (run.code || run.math) && s.code,
              !!run.link && !person && s.link,
              person && s.mention,
              !!run.tag && s.tag,
              lit && s.marked,
            ]}
            onPress={
              run.link && !person ? () => followLink(run.link!) : undefined
            }
          >
            {shown}
          </Text>
        );
      })}
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    bold: { fontFamily: fonts.semibold },
    italic: { fontStyle: "italic" },
    // There is no monospace face bundled, so code is set apart by its
    // ground rather than by its letterforms.
    code: { backgroundColor: colors.surfaceMuted },
    link: { color: colors.accent, textDecorationLine: "underline" },
    mention: {
      backgroundColor: colors.accentSoft,
      color: colors.accent,
      fontFamily: fonts.medium,
    },
    // Words with a remark: the soft tint with an accent line under them, as
    // on the web, so they don't read as ==highlighted== words.
    marked: {
      backgroundColor: colors.warningSoft,
      textDecorationLine: "underline",
      textDecorationStyle: "solid",
      textDecorationColor: colors.accent,
    },
    // ==Highlighted== words, on the same soft tint as the web.
    highlight: { backgroundColor: colors.warningSoft },
    // The highlighter's other colours, the palette's own tints (EDT-05).
    green: { backgroundColor: colors.accentSoft },
    rose: { backgroundColor: colors.highBg },
    strike: { textDecorationLine: "line-through", color: colors.muted },
    footnote: { color: colors.accent, fontSize: 11, lineHeight: 14 },
    // A line's source, small and quiet like the chip the web draws.
    source: {
      backgroundColor: colors.surfaceMuted,
      color: colors.muted,
      fontSize: 11,
    },
    // A #tag, quiet like the chip the web draws.
    tag: { backgroundColor: colors.surfaceMuted, color: colors.textSoft },
  }),
);

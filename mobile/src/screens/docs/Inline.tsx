import React from "react";
import { Linking, StyleSheet, Text } from "react-native";
import { mathToText, parseDocInline } from "@orbyn/core";
import { colors, fonts, themed } from "../../theme";
import type { Mark } from "./marks";

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
  return (
    <>
      {parseDocInline(text).map((run, i) => {
        const lit = marks.some(
          (m) => m.start < run.start + run.text.length && m.end > run.start,
        );
        const shown = run.math ? mathToText(run.text) : run.text;
        return (
          <Text
            key={i}
            style={[
              style,
              run.bold && s.bold,
              run.italic && s.italic,
              (run.code || run.math) && s.code,
              !!run.link && s.link,
              lit && s.marked,
            ]}
            onPress={
              run.link ? () => void Linking.openURL(run.link!) : undefined
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
    marked: { backgroundColor: colors.warningSoft },
  }),
);

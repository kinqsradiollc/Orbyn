import React from "react";
import { Linking, Text, type StyleProp, type TextStyle } from "react-native";
import { colors } from "../theme";

/** http(s) addresses in running text; trailing punctuation stays outside. */
const URL = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]}'’”]/gi;

/** Text split into plain runs and web addresses. */
export function splitLinks(text: string) {
  const parts: { text: string; url?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(URL)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: match[0], url: match[0] });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Plain text whose web addresses open in the browser when tapped. */
export function LinkedText({
  text,
  style,
  onError,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Called when a link can't be opened. */
  onError?: (message: string) => void;
}) {
  return (
    <Text style={style} selectable>
      {splitLinks(text).map((part, n) =>
        part.url ? (
          <Text
            key={n}
            accessibilityRole="link"
            style={{ color: colors.accent, textDecorationLine: "underline" }}
            onPress={() =>
              void Linking.openURL(part.url!).catch(() =>
                onError?.("That link couldn’t be opened."),
              )
            }
          >
            {part.text}
          </Text>
        ) : (
          <Text key={n}>{part.text}</Text>
        ),
      )}
    </Text>
  );
}

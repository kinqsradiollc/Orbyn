import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, type TextStyle } from "react-native";
import { parseLookIcon } from "@orbyn/core";
import { fileLink } from "../screens/docs/RichBlocks";
import { colors } from "../theme";
import { Icon, type IconName } from "./Icon";

/**
 * Covers and icons (W6) shared across devices. LookEditor changes the
 * appearance; these views draw its current values.
 */

/** Emoji take a size from the type scale, as all type does. */
const EMOJI: Record<number, TextStyle> = StyleSheet.create({
  13: { fontSize: 13, lineHeight: 17 },
  15: { fontSize: 15, lineHeight: 19 },
  18: { fontSize: 18, lineHeight: 22 },
  24: { fontSize: 24, lineHeight: 28 },
  36: { fontSize: 36, lineHeight: 40 },
});

/** An icon value drawn: an emoji, or the app's icon of that name. */
export function LookIconView({
  icon,
  size = 18,
  color = colors.textSoft,
}: {
  icon: string | null | undefined;
  size?: number;
  color?: string;
}) {
  const read = parseLookIcon(icon);
  if (!read) return null;
  if (read.kind === "emoji")
    return (
      <Text style={EMOJI[size] ?? EMOJI[18]} accessible={false}>
        {read.text}
      </Text>
    );
  return <Icon name={read.name as IconName} size={size} color={color} />;
}

/** A cover picture, read-only: nothing while it loads or when it's gone. */
export function CoverImage({
  fileId,
  height,
  style,
}: {
  fileId: string | null | undefined;
  height: number;
  style?: object;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!fileId) return;
    let live = true;
    fileLink(fileId).then(
      (l) => live && setUrl(l.url),
      () => live && setUrl(null),
    );
    return () => {
      live = false;
    };
  }, [fileId]);
  if (!fileId || !url) return null;
  return (
    <Image
      source={{ uri: url }}
      style={[
        { height, width: "100%", backgroundColor: colors.surfaceMuted },
        style,
      ]}
      resizeMode="cover"
      accessible={false}
    />
  );
}

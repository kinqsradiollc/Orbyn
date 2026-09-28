import React, { useEffect, useState } from "react";
import { Image, Text } from "react-native";
import { parseLookIcon } from "@orbyn/core";
import { fileLink } from "../screens/docs/RichBlocks";
import { colors } from "../theme";
import { Icon, type IconName } from "./Icon";

/**
 * Covers and icons (W6) on the phone, read-only: what a project, a page or
 * a Home hub wears. Setting them is the web's.
 */

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
      <Text style={{ fontSize: size, lineHeight: size + 4 }} accessible={false}>
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

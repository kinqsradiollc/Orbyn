import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  LOOK_EMOJI,
  LOOK_ICON_NAMES,
  LOOK_ICON_LABELS,
  isEmoji,
  pageFileType,
  pageFileInput,
  type CoverPicture,
  type Look,
} from "@orbyn/core";
import { Pressable } from "../motion";
import { session } from "../lib/session";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import { colors, fonts, radii, themed } from "../theme";
import { Segmented } from "./Segmented";
import { InlineDetails } from "./InlineDetails";
import { MoreMenu } from "./MoreMenu";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { ErrorBanner } from "./ErrorBanner";
import { CoverImage, LookIconView } from "./Look";

/** Edit a page or project's appearance using the same account-owned file store as web. */
export function LookEditor({
  title,
  look,
  uploadTo,
  onSave,
  onClose,
}: {
  title: string;
  look: Look;
  uploadTo?: string | null;
  onSave: (look: Look) => Promise<void>;
  onClose: () => void;
}) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const pending = useRef(false);
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [category, setCategory] = useState<"emoji" | "icons" | "custom">(
    look.icon?.startsWith("icon:") ? "icons" : "emoji",
  );
  const [phase, setPhase] = useState<"upload" | "save" | null>(null);
  const [pictureError, setPictureError] = useState("");
  const [readAttempt, setReadAttempt] = useState(0);
  const pictureRead = useRef(0);
  const [icon, setIcon] = useState(look.icon);
  const [cover, setCover] = useState(look.cover_file_id);
  const [typed, setTyped] = useState("");
  const [pictures, setPictures] = useState<CoverPicture[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const request = ++pictureRead.current;
    setPictureError("");
    client.myPictures().then(
      (all) => {
        if (alive && owns() && request === pictureRead.current)
          setPictures(all);
      },
      (e) => {
        if (alive && owns() && request === pictureRead.current)
          setPictureError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [readAttempt]);
  const upload = async () => {
    if (!uploadTo || !owns() || pending.current) return;
    pending.current = true;
    setPhase("upload");
    setBusy(true);
    setError("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/png", "image/jpeg", "image/gif", "image/webp"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !owns()) return;
      const asset = picked.assets[0];
      if (!asset) throw new Error("Choose a picture first.");
      const mime = pageFileType(asset.name, asset.mimeType ?? undefined);
      if (!mime || !mime.startsWith("image/"))
        throw new Error("Choose a PNG, JPEG, GIF or WebP picture.");
      if (
        asset.size !== undefined &&
        (asset.size < 1 || asset.size > 200 * 1024 * 1024)
      )
        throw new Error("Choose a picture up to 200 MB.");
      const body =
        Platform.OS === "web" && asset.file
          ? asset.file
          : await (await fetch(asset.uri)).blob();
      if (!owns()) return;
      const metadata = pageFileInput.safeParse({
        name: asset.name.trim().slice(0, 300) || "Cover",
        bytes: body.size,
        mime,
      });
      if (!metadata.success) throw new Error("Choose a picture up to 200 MB.");
      const made = await client.createPageFile(uploadTo, metadata.data);
      if (!owns()) return;
      await client.uploadPageFile(made.upload_path, body, mime);
      if (!owns()) return;
      pictureRead.current += 1;
      setCover(made.file.id);
      setPictures((all) => [
        {
          id: made.file.id,
          name: made.file.name,
          doc_id: uploadTo,
          doc_title: null,
          width: made.file.width,
          height: made.file.height,
          created_at: made.file.created_at,
        },
        ...(all ?? []).filter((picture) => picture.id !== made.file.id),
      ]);
      setReadAttempt((attempt) => attempt + 1);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      pending.current = false;
      if (owns()) {
        setBusy(false);
        setPhase(null);
      }
    }
  };
  const save = async () => {
    if (!owns() || pending.current) return;
    pending.current = true;
    setPhase("save");
    setBusy(true);
    setError("");
    try {
      const nextIcon =
        category === "custom" && typed.trim() ? typed.trim() : icon;
      if (category === "custom" && typed.trim() && !isEmoji(typed.trim()))
        throw new Error("Type or paste one emoji.");
      await onSave({ icon: nextIcon, cover_file_id: cover });
      if (owns()) onClose();
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      pending.current = false;
      if (owns()) {
        setBusy(false);
        setPhase(null);
      }
    }
  };
  const previewIcon =
    category === "custom" && isEmoji(typed.trim()) ? typed.trim() : icon;
  return (
    <BottomSheet
      visible
      title="Appearance"
      onClose={() => {
        if (!pending.current && owns()) onClose();
      }}
      footer={
        <Button
          title={
            phase === "upload"
              ? "Uploading…"
              : phase === "save"
                ? "Saving…"
                : "Save"
          }
          disabled={busy}
          onPress={() => void save()}
        />
      }
    >
      {!!error && <ErrorBanner error={error} />}
      <View style={s.preview}>
        <LookIconView icon={previewIcon} size={24} />
        <Text style={s.title}>{title}</Text>
      </View>
      <CoverImage fileId={cover} height={120} style={s.cover} />
      <Text style={s.heading}>Icon</Text>
      <Segmented
        options={["emoji", "icons", "custom"] as const}
        value={category}
        labels={{ emoji: "Emoji", icons: "Icons", custom: "Custom" }}
        onChange={setCategory}
        disabled={busy}
        accessibilityLabel="Icon choices"
      />
      <View style={s.grid}>
        {category === "emoji" &&
          LOOK_EMOJI.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${value}`}
              accessibilityState={{ selected: icon === value }}
              disabled={busy}
              style={[s.choice, icon === value && s.selected]}
              onPress={() => setIcon(value)}
            >
              <LookIconView icon={value} size={24} />
            </Pressable>
          ))}
        {category === "icons" &&
          LOOK_ICON_NAMES.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${LOOK_ICON_LABELS[name]} icon`}
              accessibilityState={{ selected: icon === `icon:${name}` }}
              disabled={busy}
              style={[s.choice, icon === `icon:${name}` && s.selected]}
              onPress={() => setIcon(`icon:${name}`)}
            >
              <LookIconView icon={`icon:${name}`} size={24} />
            </Pressable>
          ))}
      </View>
      {category === "custom" && (
        <>
          <TextInput
            accessibilityLabel="Custom emoji"
            placeholder="Type or paste an emoji"
            placeholderTextColor={colors.faint}
            value={typed}
            onChangeText={setTyped}
            editable={!busy}
            maxLength={16}
            style={s.input}
          />
        </>
      )}
      <Text style={s.heading}>Cover</Text>
      {uploadTo && (
        <Button
          title="Upload cover picture"
          disabled={busy}
          onPress={() => void upload()}
        />
      )}
      <InlineDetails title="Choose an existing picture" reveal={!!pictureError}>
        {!!pictureError && <ErrorBanner error={pictureError} />}
        {pictures === null ? (
          <Text style={s.note}>
            {pictureError ? "Pictures unavailable." : "Loading pictures…"}
          </Text>
        ) : !pictures.length ? (
          <Text style={s.note}>No pictures yet.</Text>
        ) : (
          pictures.map((picture) => (
            <Pressable
              key={picture.id}
              accessibilityRole="button"
              accessibilityLabel={`Use ${picture.name} as cover`}
              accessibilityState={{ selected: cover === picture.id }}
              disabled={busy}
              style={[s.picture, cover === picture.id && s.selected]}
              onPress={() => setCover(picture.id)}
            >
              <CoverImage fileId={picture.id} height={80} style={s.cover} />
              <Text style={s.note}>{picture.name}</Text>
            </Pressable>
          ))
        )}
        {!!pictureError && (
          <Button
            title="Retry pictures"
            secondary
            disabled={busy}
            onPress={() => setReadAttempt((attempt) => attempt + 1)}
          />
        )}
      </InlineDetails>
      <MoreMenu
        label="Appearance options"
        disabled={busy}
        actions={[
          {
            label: "Remove icon",
            disabled: !icon && !typed.trim(),
            onPress: () => {
              if (owns() && !pending.current) {
                setIcon(null);
                setTyped("");
              }
            },
          },
          {
            label: "Remove cover",
            disabled: !cover,
            onPress: () => {
              if (owns() && !pending.current) setCover(null);
            },
          },
        ]}
      />
    </BottomSheet>
  );
}
const s = themed(() =>
  StyleSheet.create({
    preview: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 18,
    },
    heading: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 15,
      marginTop: 16,
      marginBottom: 10,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choice: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      padding: 8,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
    },
    selected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    input: {
      fontSize: Platform.OS === "web" ? 16 : 15,
      color: colors.text,
      fontFamily: fonts.regular,
      padding: 12,
      marginVertical: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
    },
    cover: { borderRadius: radii.input },
    picture: {
      padding: 10,
      marginBottom: 10,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
    },
    note: { color: colors.textSoft, fontFamily: fonts.regular, fontSize: 13 },
  }),
);

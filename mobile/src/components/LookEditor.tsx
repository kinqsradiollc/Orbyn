import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  LOOK_EMOJI,
  LOOK_ICON_NAMES,
  LOOK_ICON_LABELS,
  isEmoji,
  pageFileType,
  type CoverPicture,
  type Look,
} from "@orbyn/core";
import { Pressable } from "../motion";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import { colors, fonts, radii, themed } from "../theme";
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
  const [icon, setIcon] = useState(look.icon);
  const [cover, setCover] = useState(look.cover_file_id);
  const [typed, setTyped] = useState("");
  const [pictures, setPictures] = useState<CoverPicture[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    client.myPictures().then(
      (all) => {
        if (alive) setPictures(all);
      },
      (e) => {
        if (alive) setError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  const upload = async () => {
    if (!uploadTo || busy) return;
    setBusy(true);
    setError("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/png", "image/jpeg", "image/gif", "image/webp"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const mime = pageFileType(asset.name, asset.mimeType ?? undefined);
      if (!mime || !mime.startsWith("image/"))
        throw new Error("Choose a PNG, JPEG, GIF or WebP picture.");
      const body =
        Platform.OS === "web" && asset.file
          ? asset.file
          : await (await fetch(asset.uri)).blob();
      const made = await client.createPageFile(uploadTo, {
        name: asset.name.slice(0, 300) || "Cover",
        bytes: body.size,
        mime,
      });
      await client.uploadPageFile(made.upload_path, body, mime);
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
        ...(all ?? []),
      ]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ icon, cover_file_id: cover });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      visible
      title={`Cover and icon · ${title}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button
          title={busy ? "Saving…" : "Save appearance"}
          disabled={busy}
          onPress={() => void save()}
        />
      }
    >
      {!!error && <ErrorBanner error={error} />}
      <View style={s.preview}>
        <LookIconView icon={icon} size={24} />
        <Text style={s.title}>{title}</Text>
      </View>
      <CoverImage fileId={cover} height={120} style={s.cover} />
      <Text style={s.heading}>Icon</Text>
      <View style={s.grid}>
        {LOOK_EMOJI.map((value) => (
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
        {LOOK_ICON_NAMES.map((name) => (
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
      <Button
        title="Use emoji"
        disabled={busy || !typed.trim()}
        onPress={() => {
          if (isEmoji(typed.trim())) {
            setIcon(typed.trim());
            setTyped("");
            setError("");
          } else setError("Type or paste an emoji.");
        }}
      />
      <Button
        title="Remove icon"
        disabled={busy || !icon}
        onPress={() => setIcon(null)}
      />
      <Text style={s.heading}>Cover</Text>
      {uploadTo && (
        <Button
          title="Upload cover picture"
          disabled={busy}
          onPress={() => void upload()}
        />
      )}
      {pictures === null ? (
        <View>
          <Text style={s.note}>
            {error ? "Pictures could not be loaded." : "Loading your pictures…"}
          </Text>
          {!!error && (
            <Button
              title="Retry pictures"
              disabled={busy}
              onPress={() => {
                setError("");
                void client
                  .myPictures()
                  .then(setPictures, (e) => setError(errorText(e)));
              }}
            />
          )}
        </View>
      ) : !pictures.length ? (
        <Text style={s.note}>
          No pictures yet. Add a picture to a page to use it here.
        </Text>
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
      <Button
        title="Remove cover"
        disabled={busy || !cover}
        onPress={() => setCover(null)}
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
      backgroundColor: colors.surfaceMuted,
    },
    input: {
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

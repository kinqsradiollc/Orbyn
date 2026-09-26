import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../motion";
import { PAGE_TAG_LIMIT, type DocTag, type Tag } from "@orbyn/core";
import { Chip, ChipRow } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, controls, fonts, radii, themed } from "../../theme";

/**
 * A page's tags under its title, on the phone: its chips, and "Tag" to
 * choose from the page's own space's tags or make a new one. Typing "#tag"
 * in a line adds to the same row.
 */
export function PageTags({
  docId,
  teamId,
  tags,
  canWrite,
  onChange,
  report,
}: {
  docId: string;
  teamId: string | null;
  tags: DocTag[];
  canWrite: boolean;
  onChange: (tags: DocTag[]) => void;
  report: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [offered, setOffered] = useState<Tag[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const inSpace = (t: Tag) =>
    teamId ? t.team_id === teamId : t.team_id === null;

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next)
      client.listTags().then((all) => setOffered(all.filter(inSpace)), report);
  };

  const set = (ids: string[]) => {
    setBusy(true);
    client
      .setDocTags(docId, ids)
      .then(({ tags: next }) => onChange(next), report)
      .finally(() => setBusy(false));
  };

  /** Add a tag by name, made in the page's space if it's new. */
  const add = () => {
    const wanted = name.trim().replace(/^#/, "");
    if (!wanted) return;
    setBusy(true);
    client
      .addDocTags(docId, [wanted])
      .then(({ tags: next }) => {
        onChange(next);
        setName("");
        return client.listTags();
      }, report)
      .then((all) => all && setOffered(all.filter(inSpace)), report)
      .finally(() => setBusy(false));
  };

  if (!tags.length && !canWrite) return null;
  const on = new Set(tags.map((t) => t.id));
  return (
    <View style={s.wrap}>
      <View style={s.row} accessibilityLabel="Tags on this page">
        {tags.map((t) => (
          <View key={t.id} style={s.tag}>
            <View style={[s.dot, { backgroundColor: t.color }]} />
            <Text style={s.tagText} numberOfLines={1}>
              {t.name}
            </Text>
          </View>
        ))}
        {canWrite && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={tags.length ? "Change tags" : "Add a tag"}
            hitSlop={TAG_SLOP}
            onPress={toggleOpen}
            style={({ pressed }) => [s.add, (pressed || open) && s.addOn]}
          >
            <Icon name="tag" size={13} color={colors.muted} />
            <Text style={s.addText}>{tags.length ? "Tags" : "Tag"}</Text>
          </Pressable>
        )}
      </View>
      {open && canWrite && (
        <View style={s.panel}>
          {offered === null ? (
            <Text style={s.hint}>Loading…</Text>
          ) : offered.length ? (
            <ChipRow label="Tags" multi>
              {offered.map((t) => (
                <Chip
                  key={t.id}
                  compact
                  multi
                  label={t.name}
                  color={t.color}
                  selected={on.has(t.id)}
                  disabled={
                    busy || (!on.has(t.id) && on.size >= PAGE_TAG_LIMIT)
                  }
                  onPress={() =>
                    set(
                      on.has(t.id)
                        ? tags.filter((x) => x.id !== t.id).map((x) => x.id)
                        : [...on, t.id],
                    )
                  }
                />
              ))}
            </ChipRow>
          ) : (
            <Text style={s.hint}>No tags here yet.</Text>
          )}
          <View style={s.newRow}>
            <TextInput
              style={s.input}
              value={name}
              placeholder="New tag"
              placeholderTextColor={colors.faint}
              maxLength={40}
              autoCapitalize="none"
              returnKeyType="done"
              onChangeText={setName}
              onSubmitEditing={add}
              accessibilityLabel="New tag name"
            />
            <SmallAction
              label="Add"
              disabled={busy || !name.trim()}
              onPress={add}
            />
          </View>
          <Text style={s.hint}>Or type #tag in a line.</Text>
        </View>
      )}
    </View>
  );
}

/** The tag row's chips are drawn small; this brings "Tag" up to a full tap. */
const CHIP_HEIGHT = 26;
const TAG_SLOP = {
  top: (controls.tap - CHIP_HEIGHT) / 2,
  bottom: (controls.tap - CHIP_HEIGHT) / 2,
  left: 6,
  right: 6,
};

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8, marginTop: -6 },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
    },
    tag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      maxWidth: "100%",
      minHeight: CHIP_HEIGHT,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
    },
    dot: { width: 6, height: 6, borderRadius: radii.pill },
    tagText: { color: colors.textSoft, fontSize: 13, fontFamily: fonts.medium },
    add: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: CHIP_HEIGHT,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
    },
    addOn: { backgroundColor: colors.surfaceMuted },
    addText: { color: colors.muted, fontSize: 13, fontFamily: fonts.medium },
    panel: {
      gap: 10,
      padding: 12,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    newRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    input: {
      flex: 1,
      minWidth: 0,
      minHeight: controls.tap - 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.regular,
    },
    hint: { color: colors.muted, fontSize: 11 },
  }),
);

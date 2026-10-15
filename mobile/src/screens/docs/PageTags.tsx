import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../motion";
import { PAGE_TAG_LIMIT, type DocTag, type Tag } from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { Icon } from "../../components/Icon";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import {
  inputFontSize,
  colors,
  controls,
  fonts,
  radii,
  themed,
} from "../../theme";

/**
 * A page's tags under its title, on the phone: its chips, and "Tag" to
 * choose from the page's own space's tags or make a new one. Typing "#tag"
 * in a line adds to the same row.
 */
export function PageTags(props: Parameters<typeof PageTagsBody>[0]) {
  return (
    <PageTagsBody
      key={`${session.token}:${props.docId}:${props.teamId ?? "personal"}`}
      {...props}
    />
  );
}

function PageTagsBody({
  docId,
  teamId,
  tags,
  canWrite,
  onChange,
  onBusyChange,
}: {
  docId: string;
  teamId: string | null;
  tags: DocTag[];
  canWrite: boolean;
  onChange: (tags: DocTag[]) => void;
  report: (e: unknown) => void;
  onBusyChange?: (pending: boolean) => void;
}) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const owns = () => mounted.current && session.token === owner;
  const busyChanged = useRef(onBusyChange);
  busyChanged.current = onBusyChange;
  const permission = useRef(canWrite);
  permission.current = canWrite;
  const mutation = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
      if (mutation.current) {
        mutation.current = false;
        busyChanged.current?.(false);
      }
    };
  }, []);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [offered, setOffered] = useState<Tag[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const inSpace = (t: Tag) =>
    teamId ? t.team_id === teamId : t.team_id === null;

  const load = () => {
    const epoch = ++request.current;
    setFailed(false);
    setOffered(null);
    void client.listTags().then(
      (all) => {
        if (owns() && epoch === request.current)
          setOffered(all.filter(inSpace));
      },
      (reason) => {
        if (owns() && epoch === request.current) {
          setFailed(true);
          setError(errorText(reason));
        }
      },
    );
  };
  const toggleOpen = () => {
    if (!owns() || !permission.current || mutation.current) return;
    setOpen(true);
    load();
  };

  const change = async (
    write: () => Promise<{ tags: DocTag[] }>,
    added?: string,
  ) => {
    if (!owns() || !permission.current || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    busyChanged.current?.(true);
    try {
      const result = await write();
      if (!owns()) return false;
      onChange(result.tags);
      if (added)
        setName((current) =>
          current.trim().replace(/^#/, "") === added ? "" : current,
        );
      return true;
    } catch (reason) {
      if (owns()) setError(errorText(reason));
      return false;
    } finally {
      mutation.current = false;
      if (owns()) {
        setBusy(false);
        busyChanged.current?.(false);
      }
    }
  };
  const set = (ids: string[]) =>
    void change(() => client.setDocTags(docId, ids));
  const add = () => {
    const wanted = name.trim().replace(/^#/, "");
    if (!wanted || tags.length >= PAGE_TAG_LIMIT) return;
    void change(() => client.addDocTags(docId, [wanted]), wanted).then(
      (saved) => {
        if (saved && owns() && open) load();
      },
    );
  };

  if (!tags.length && !canWrite) return null;
  const on = new Set(tags.map((t) => t.id));
  return (
    <View style={s.wrap}>
      <View style={s.row} accessibilityLabel="Tags on this page">
        {tags.map((t) => (
          <View key={t.id} style={s.tag}>
            <View style={[s.dot, { backgroundColor: t.color }]} />
            <Text style={s.tagText}>{t.name}</Text>
          </View>
        ))}
        {canWrite && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open, disabled: busy }}
            disabled={busy}
            accessibilityLabel={tags.length ? "Change tags" : "Add a tag"}
            onPress={toggleOpen}
            style={({ pressed }) => [s.add, (pressed || open) && s.addOn]}
          >
            <Icon name="tag" size={13} color={colors.muted} />
            <Text style={s.addText}>{tags.length ? "Tags" : "Tag"}</Text>
          </Pressable>
        )}
      </View>
      {open && canWrite && (
        <BottomSheet
          visible={open}
          title="Page tags"
          closeDisabled={busy}
          onClose={() => {
            if (!mutation.current) {
              request.current++;
              setOpen(false);
            }
          }}
        >
          <View style={s.panel}>
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            <TextInput
              style={s.input}
              value={query}
              onChangeText={setQuery}
              editable={!busy}
              placeholder="Find a tag"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Find a tag"
              autoCapitalize="none"
            />
            {failed ? (
              <View accessibilityRole="alert">
                <Text style={s.hint}>Couldn't load tags.</Text>
                <SmallAction label="Retry" disabled={busy} onPress={load} />
              </View>
            ) : offered === null ? (
              <Text style={s.hint}>Loading…</Text>
            ) : offered.length ? (
              <View accessibilityRole="list">
                {offered
                  .filter((t) =>
                    t.name.toLowerCase().includes(query.trim().toLowerCase()),
                  )
                  .map((t) => (
                    <Pressable
                      key={t.id}
                      accessibilityRole="checkbox"
                      accessibilityLabel={t.name}
                      accessibilityState={{
                        checked: on.has(t.id),
                        disabled:
                          busy || (!on.has(t.id) && on.size >= PAGE_TAG_LIMIT),
                      }}
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
                      style={({ pressed }) => [s.choice, pressed && s.addOn]}
                    >
                      <View style={[s.dot, { backgroundColor: t.color }]} />
                      <Text style={s.choiceText}>{t.name}</Text>
                      {on.has(t.id) && (
                        <Icon name="check" size={16} color={colors.accent} />
                      )}
                    </Pressable>
                  ))}
                {!offered.some((t) =>
                  t.name.toLowerCase().includes(query.trim().toLowerCase()),
                ) && <Text style={s.hint}>No matching tags.</Text>}
              </View>
            ) : (
              <Text style={s.hint}>No tags here yet.</Text>
            )}
            <View style={s.newRow}>
              <TextInput
                style={s.input}
                editable={!busy}
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
                disabled={busy || !name.trim() || tags.length >= PAGE_TAG_LIMIT}
                onPress={add}
              />
            </View>
          </View>
        </BottomSheet>
      )}
    </View>
  );
}

const CHIP_HEIGHT = 26;

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8 },
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
    tagText: {
      color: colors.textSoft,
      fontSize: 13,
      fontFamily: fonts.medium,
      flexShrink: 1,
    },
    add: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: controls.tap,
      paddingHorizontal: 10,
      borderRadius: radii.input,
    },
    addOn: { backgroundColor: colors.surfaceMuted },
    addText: { color: colors.muted, fontSize: 13, fontFamily: fonts.medium },
    panel: {
      gap: 10,
      paddingVertical: 8,
    },
    newRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    input: {
      flex: 1,
      minWidth: 0,
      minHeight: controls.tap,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: inputFontSize,
      fontFamily: fonts.regular,
    },
    choice: {
      minHeight: 44,
      paddingVertical: 8,
      paddingHorizontal: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: radii.input,
    },
    choiceText: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.text,
    },
    error: { fontSize: 13, color: colors.danger },
    hint: { color: colors.muted, fontSize: 13 },
  }),
);

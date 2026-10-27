import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../../motion";
import {
  blankDate,
  fillTemplate,
  newBlockId,
  type Doc,
  type DocBlock,
  type LinkOption,
  type ObjectRef,
  type PageTemplate,
} from "@orbyn/core";
import { BottomSheet } from "../../../components/BottomSheet";
import { Icon } from "../../../components/Icon";
import { client } from "../../../lib/api";
import { errorText } from "../../../lib/errors";
import { deviceTimeZone } from "../../planner/planning";
import {
  inputFontSize,
  colors,
  controls,
  fonts,
  radii,
  themed,
} from "../../../theme";
import { LinkPickerPanel } from "./links";

/**
 * Three page actions from D4b on the phone: "Merge into…" (ORG-05), a
 * template's lines put where the line is, and choosing the page (or one of
 * its headings) to embed (LNK-08).
 */

/** "Merge into…": find the page this one goes into, then merge. */
export function MergeSheet({
  visible,
  doc,
  version,
  onClose,
  onMerged,
}: {
  visible: boolean;
  doc: Pick<Doc, "id" | "title">;
  /** The version the page is at, once what was typed is saved. */
  version: () => Promise<number>;
  onClose: () => void;
  onMerged: (into: Doc, relinked: number) => void;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<LinkOption[]>([]);
  const [picked, setPicked] = useState<LinkOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    active.current = visible;
    setPicked(null);
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, [visible, doc.id]);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setLoading(true);
    setSearchError("");
    setFound([]);
    const t = setTimeout(() => {
      void client
        .pickLinks(q, 20)
        .then(
          (hits) =>
            live &&
            setFound(hits.filter((h) => h.kind === "doc" && h.id !== doc.id)),
          (failure) => live && setSearchError(errorText(failure)),
        )
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, doc.id, visible, retry]);
  const merge = async () => {
    if (!picked || pending.current) return;
    const ownGeneration = generation.current;
    const current = () =>
      active.current && generation.current === ownGeneration;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const currentVersion = await version();
      if (!current()) return;
      const done = await client.mergeDoc(doc.id, picked.id, currentVersion);
      if (current()) onMerged(done.doc, done.relinked);
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <BottomSheet
      visible={visible}
      title="Merge into…"
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <Pressable
          accessibilityRole="button"
          disabled={!picked || busy}
          onPress={() => void merge()}
          style={({ pressed }) => [
            s.primary,
            pressed && s.primaryPressed,
            (!picked || busy) && { opacity: 0.45 },
          ]}
        >
          <Text style={s.primaryText}>{busy ? "Merging…" : "Merge"}</Text>
        </Pressable>
      }
    >
      <Text style={s.muted}>
        “{doc.title || "Untitled"}” joins the target with comments and tasks.
        Links redirect; this page moves to Trash and can be restored.
      </Text>
      {picked && <Text style={s.muted}>Into: {picked.title}</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <TextInput
        value={q}
        editable={!busy}
        onChangeText={(v) => {
          setQ(v);
          setPicked(null);
        }}
        placeholder="Find a page"
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        style={s.search}
        accessibilityLabel="Find the page to merge into"
      />
      <View style={s.list}>
        {found.map((f) => {
          const on = picked?.id === f.id;
          return (
            <Pressable
              key={f.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              disabled={busy}
              onPress={() => setPicked(f)}
              style={({ pressed }) => [
                s.row,
                on && s.rowOn,
                pressed && !on && s.pressed,
              ]}
            >
              <Icon name="fileText" size={16} color={colors.muted} />
              <View style={s.rowText}>
                <Text style={s.rowTitle}>{f.title}</Text>
                {f.hint ? <Text style={s.rowHint}>{f.hint}</Text> : null}
              </View>
              {on && <Icon name="check" size={16} color={colors.accent} />}
            </Pressable>
          );
        })}
        {loading && <Text style={s.muted}>Finding pages…</Text>}
        {!!searchError && (
          <View>
            <Text accessibilityRole="alert" style={s.error}>
              {searchError}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setRetry((value) => value + 1)}
              style={s.row}
            >
              <Text style={s.rowTitle}>Retry</Text>
            </Pressable>
          </View>
        )}
        {!loading && !searchError && !found.length && (
          <Text style={s.muted}>
            {q ? "No page is called that." : "Type to find a page."}
          </Text>
        )}
      </View>
    </BottomSheet>
  );
}

/** Templates to put in the page where the line is. */
export function TemplateSheet({
  visible,
  doc,
  onPick,
  onClose,
  report,
}: {
  visible: boolean;
  doc: Pick<Doc, "title" | "project_name">;
  onPick: (lines: DocBlock[]) => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setTemplates(null);
    setError("");
    void client.listPageTemplates().then(
      (items) => {
        if (active) setTemplates(items);
      },
      (failure) => {
        if (active) {
          setError(errorText(failure));
          setTemplates(null);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [visible, retry]);
  const values = useMemo(
    () => ({
      date: blankDate(new Date(), deviceTimeZone()),
      title: doc.title,
      project: doc.project_name ?? "",
    }),
    [doc.title, doc.project_name],
  );
  return (
    <BottomSheet visible={visible} title="Insert a template" onClose={onClose}>
      {templates === null && !error && <Text style={s.muted}>Loading…</Text>}
      {!!error && (
        <View>
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRetry((value) => value + 1)}
            style={s.row}
          >
            <Text style={s.rowTitle}>Retry</Text>
          </Pressable>
        </View>
      )}
      {templates?.length === 0 && (
        <Text style={s.muted}>
          No templates yet. Save a page as one from its ⋯.
        </Text>
      )}
      <View style={s.list}>
        {templates?.map((t) => (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            onPress={() => {
              const { content } = fillTemplate(t, values, doc.title);
              onPick(
                content.map((b) => ({ ...b, id: newBlockId() }) as DocBlock),
              );
              onClose();
            }}
            style={({ pressed }) => [s.row, pressed && s.pressed]}
          >
            <Icon name="layoutTemplate" size={16} color={colors.muted} />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{t.name}</Text>
              {t.description ? (
                <Text style={s.rowHint} numberOfLines={2}>
                  {t.description}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

/**
 * Choose what to embed: a page, or one of its headings with `Page#` typed
 * in the search, as in a link.
 */
export function EmbedSheet({
  visible,
  onPick,
  onClose,
  report,
}: {
  visible: boolean;
  onPick: (ref: ObjectRef) => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  return (
    <BottomSheet visible={visible} title="Embed a page" onClose={onClose}>
      <Text style={s.muted}>
        Find the page. Add # and a heading's words to show only that part.
      </Text>
      {visible && (
        <LinkPickerPanel
          onPick={(ref) => {
            onClose();
            onPick(ref);
          }}
          onCreate={() => {}}
          onClose={onClose}
          report={report}
        />
      )}
    </BottomSheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    error: { color: colors.danger, fontSize: 13 },
    search: {
      minHeight: controls.tap,
      marginVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
    },
    list: { gap: 2, marginTop: 6 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: controls.tap,
      paddingHorizontal: 8,
      borderRadius: radii.input,
    },
    rowOn: { backgroundColor: colors.accentSoft },
    pressed: { backgroundColor: colors.surfaceMuted },
    rowText: { flex: 1, minWidth: 0, gap: 1 },
    rowTitle: { color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
    rowHint: { color: colors.muted, fontSize: 11 },
    primary: {
      minHeight: controls.tap,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
    primaryPressed: { backgroundColor: colors.accentPressed },
    primaryText: {
      color: colors.onAccent,
      fontFamily: fonts.semibold,
      fontSize: 15,
    },
  }),
);

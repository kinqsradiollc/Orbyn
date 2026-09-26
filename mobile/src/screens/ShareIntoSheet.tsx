import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  captureTask,
  choiceKey,
  choiceLabel,
  readChoices,
  rememberChoice,
  shortAddress,
  siteOf,
  type CaptureDestination,
  type CaptureResult,
  type DocSummary,
  type Folder,
  type Project,
  type ShareChoice,
  type SharedContent,
} from "@orbyn/core";
import { BottomSheet } from "../components/BottomSheet";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { Icon, type IconName } from "../components/Icon";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { deviceTimeZone } from "../lib/planning";
import { colors, controls, fonts, radii, themed } from "../theme";

/** Where the last three destinations are kept, on this device. */
const CHOICES_KEY = "orbyn-share-choices";

type Kind = ShareChoice["kind"];

/**
 * "Save to Orbyn", for a link or some text shared from another app: the
 * link's title and site at the top, the last three places used as chips,
 * then where it can go — an Inbox task "Read: …", today's agenda, a page,
 * a new page in a folder, or a project — and one Save.
 */
export function ShareIntoSheet({
  shared,
  canWriteIn,
  onClose,
  onSaved,
}: {
  /** What was shared; the sheet shows while there is something. */
  shared: SharedContent | null;
  /** Whether this person may add to a team's things (null: their own). */
  canWriteIn: (teamId: string | null) => boolean;
  onClose: () => void;
  onSaved: (result: CaptureResult) => void;
}) {
  const [title, setTitle] = useState<string | null>(null);
  const [site, setSite] = useState("");
  const [kept, setKept] = useState<ShareChoice[]>(() =>
    readChoices(readLocal(CHOICES_KEY)),
  );
  const [kind, setKind] = useState<Kind>("inbox");
  /** The page, folder or project chosen for the kinds that need one. */
  const [picked, setPicked] = useState<{
    id: string | null;
    label: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<DocSummary[] | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A new share starts from the place used last, with its title looked up.
  useEffect(() => {
    if (!shared) return;
    const last = readChoices(readLocal(CHOICES_KEY));
    setKept(last);
    choose(last[0] ?? { kind: "inbox" });
    setError("");
    setQuery("");
    setTitle(null);
    setSite(shared.url ? siteOf(shared.url) : "");
    if (shared.url)
      client.linkPreview(shared.url).then(
        (p) => {
          setTitle(p.title);
          setSite(p.site);
        },
        () => {},
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  // The lists a destination chooses from, fetched when first needed.
  useEffect(() => {
    if (!shared) return;
    if (kind === "page" && !pages)
      client.listDocs().then(setPages, (e) => setError(errorText(e)));
    if (kind === "new_page" && !folders)
      client.listFolders().then(setFolders, (e) => setError(errorText(e)));
    if (kind === "project" && !projects)
      client.listProjects().then(setProjects, (e) => setError(errorText(e)));
  }, [kind, shared, pages, folders, projects]);

  const choose = (c: ShareChoice) => {
    setKind(c.kind);
    setPicked("id" in c ? { id: c.id, label: c.label } : null);
    setQuery("");
  };

  const task = shared
    ? captureTask({ url: shared.url, title, text: shared.text })
    : null;
  const writablePages = useMemo(
    () =>
      (pages ?? [])
        .filter((d) => d.kind !== "agenda" && canWriteIn(d.team_id))
        .filter((d) =>
          query.trim()
            ? (d.title || "Untitled")
                .toLowerCase()
                .includes(query.trim().toLowerCase())
            : true,
        )
        .slice(0, 6),
    [pages, query, canWriteIn],
  );

  const ready = kind === "inbox" || kind === "agenda" || !!picked;
  const destination = (): CaptureDestination | null => {
    if (kind === "inbox") return { kind: "inbox" };
    if (kind === "agenda") return { kind: "agenda" };
    if (!picked) return null;
    if (kind === "page") return { kind: "page", doc_id: picked.id! };
    if (kind === "project") return { kind: "project", project_id: picked.id! };
    return { kind: "new_page", folder_id: picked.id };
  };

  const save = async () => {
    const to = destination();
    if (!shared || !to) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.capture({
        url: shared.url,
        text: shared.text,
        title,
        to,
        timezone: deviceTimeZone(),
      });
      const choice: ShareChoice =
        kind === "inbox" || kind === "agenda"
          ? { kind }
          : kind === "new_page"
            ? { kind, id: picked!.id, label: picked!.label }
            : { kind, id: picked!.id!, label: picked!.label };
      const next = rememberChoice(kept, choice);
      setKept(next);
      saveLocal(CHOICES_KEY, JSON.stringify(next));
      onSaved(result);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const row = (k: Kind, icon: IconName, label: string, detail?: string) => (
    <Pressable
      key={k}
      accessibilityRole="radio"
      accessibilityState={{ checked: kind === k }}
      onPress={() => {
        if (kind !== k) choose({ kind: k } as ShareChoice);
      }}
      style={({ pressed }) => [
        s.row,
        kind === k && s.rowOn,
        pressed && kind !== k && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Icon
        name={icon}
        size={19}
        color={kind === k ? colors.accent : colors.textSoft}
      />
      <View style={s.rowWords}>
        <Text
          style={[s.rowLabel, kind === k && { color: colors.accent }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {!!detail && (
          <Text style={s.rowDetail} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      {kind === k && <Icon name="check" size={16} color={colors.accent} />}
    </Pressable>
  );

  const option = (
    key: string,
    label: string,
    id: string | null,
    icon: IconName,
  ) => {
    const on = picked?.id === id && picked?.label === label;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        onPress={() => setPicked({ id, label })}
        style={({ pressed }) => [
          s.option,
          on && s.optionOn,
          pressed && !on && { backgroundColor: colors.surfaceMuted },
        ]}
      >
        <Icon name={icon} size={16} color={on ? colors.accent : colors.muted} />
        <Text
          style={[s.optionText, on && { color: colors.accent }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <BottomSheet
      visible={!!shared}
      title="Save to Orbyn"
      onClose={onClose}
      footer={
        <Button
          title={busy ? "Saving…" : "Save"}
          disabled={busy || !ready}
          onPress={() => void save()}
        />
      }
    >
      {shared && (
        <View style={s.body}>
          <View style={s.card}>
            {shared.url ? (
              <>
                <Text style={s.cardTitle} numberOfLines={2}>
                  {title || site || shared.url}
                </Text>
                <Text style={s.cardSite} numberOfLines={1}>
                  {title ? site : shortAddress(shared.url)}
                </Text>
              </>
            ) : null}
            {!!shared.text && (
              <Text style={s.cardText} numberOfLines={shared.url ? 2 : 4}>
                {shared.text}
              </Text>
            )}
          </View>

          {kept.length > 0 && (
            <ChipRow label="Places used last">
              {kept.map((c) => (
                <Chip
                  key={choiceKey(c)}
                  compact
                  label={choiceLabel(c)}
                  selected={
                    kind === c.kind &&
                    ("id" in c
                      ? picked?.id === c.id && picked?.label === c.label
                      : true)
                  }
                  onPress={() => choose(c)}
                />
              ))}
            </ChipRow>
          )}

          <View style={s.rows} accessibilityRole="radiogroup">
            {row(
              "inbox",
              "inbox",
              shared.url ? `Inbox task “${task?.title}”` : "Inbox task",
              shared.url ? "With the link on it" : task?.title,
            )}
            {row("agenda", "sun", "Add to today’s agenda", "Under Notes")}
            {row(
              "page",
              "fileText",
              kind === "page" && picked
                ? `Add to “${picked.label}”`
                : "Add to a page…",
            )}
            {kind === "page" && (
              <View style={s.picker}>
                <TextInput
                  style={s.search}
                  value={query}
                  placeholder="Find a page"
                  placeholderTextColor={colors.faint}
                  autoCorrect={false}
                  onChangeText={setQuery}
                  accessibilityLabel="Find a page"
                />
                {pages === null ? (
                  <Text style={s.muted}>Loading…</Text>
                ) : writablePages.length === 0 ? (
                  <Text style={s.muted}>No page by that name.</Text>
                ) : (
                  writablePages.map((d) =>
                    option(d.id, d.title || "Untitled", d.id, "fileText"),
                  )
                )}
              </View>
            )}
            {row(
              "new_page",
              "filePlus",
              kind === "new_page" && picked
                ? `New page in ${picked.label}`
                : "New page in folder…",
            )}
            {kind === "new_page" && (
              <View style={s.picker}>
                {option("none", "Unfiled", null, "fileText")}
                {folders === null ? (
                  <Text style={s.muted}>Loading…</Text>
                ) : (
                  folders
                    .filter((f) => canWriteIn(f.team_id))
                    .map((f) => option(f.id, f.name, f.id, "folder"))
                )}
              </View>
            )}
            {row(
              "project",
              "boxes",
              kind === "project" && picked ? picked.label : "Project…",
              kind === "project" && picked ? "As a task" : undefined,
            )}
            {kind === "project" && (
              <View style={s.picker}>
                {projects === null ? (
                  <Text style={s.muted}>Loading…</Text>
                ) : projects.filter((p) => canWriteIn(p.team_id)).length ===
                  0 ? (
                  <Text style={s.muted}>No projects yet.</Text>
                ) : (
                  projects
                    .filter((p) => canWriteIn(p.team_id))
                    .map((p) => option(p.id, p.name, p.id, "boxes"))
                )}
              </View>
            )}
          </View>
          {!!error && (
            <Text style={s.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>
      )}
    </BottomSheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 14, paddingTop: 4 },
    card: {
      gap: 4,
      padding: 14,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    cardSite: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    cardText: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSoft,
    },
    rows: { gap: 2 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: controls.tap + 8,
      paddingHorizontal: 12,
      borderRadius: radii.input,
    },
    rowOn: { backgroundColor: colors.accentSoft },
    rowWords: { flex: 1, minWidth: 0 },
    rowLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    rowDetail: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
    picker: { gap: 2, paddingLeft: 42, paddingBottom: 6 },
    search: {
      minHeight: controls.tap - 6,
      paddingHorizontal: 12,
      marginBottom: 4,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: controls.tap - 6,
      paddingHorizontal: 10,
      borderRadius: radii.input,
    },
    optionOn: { backgroundColor: colors.accentSoft },
    optionText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 14,
      color: colors.text,
    },
    muted: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      paddingVertical: 6,
    },
    error: { color: colors.danger, fontSize: 13 },
  }),
);

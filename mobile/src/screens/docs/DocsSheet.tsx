import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  favouriteKey,
  favouriteSet,
  snippetRuns,
  type Doc,
  type DocKind,
  type DocSummary,
  type Favourite,
  type Folder,
  type SearchHit,
} from "@orbyn/core";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { colors, fonts, radii, themed } from "../../theme";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { DocComments } from "./DocComments";
import { DocHistory } from "./DocHistory";
import { DocEditor } from "./DocEditor";
import { useDocComments } from "./useDocComments";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * Documents on the phone: the list, then one document to read and write,
 * with its checklist live so a line ticked here ticks its task too. Formulas
 * read as symbols here and are typeset on the desktop; the source is the
 * same either way.
 */
export function DocsSheet({
  visible,
  agenda,
  initialDoc,
  userId,
  canWriteDoc,
  onClose,
  onDismiss,
  onItemsChanged,
}: {
  visible: boolean;
  /** Opens straight onto today's agenda instead of the list. */
  agenda?: boolean;
  /** Opens straight onto one page — a meeting note, say — not the list. */
  initialDoc?: Doc | null;
  /** Whether this reader may change a page, by the team it belongs to. */
  canWriteDoc?: (teamId: string | null) => boolean;
  /** Whose comments offer a remove button. */
  userId?: string;
  onClose: () => void;
  onDismiss?: () => void;
  /** Called when ticking a line changed a task in the planner. */
  onItemsChanged?: () => void;
}) {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  /** null = every kind; "note" = only notes; "doc" = only plain pages. */
  const [kindFilter, setKindFilter] = useState<DocKind | null>(null);
  /** What has been typed into the search box, and what came back for it. */
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  /** The folders a page can be filed in, and which one is being shown. */
  const [folders, setFolders] = useState<Folder[]>([]);
  /** null = everywhere; a folder id = that folder; "none" = unfiled. */
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  /** The pages this person has starred, which float to the top. */
  const [stars, setStars] = useState<Favourite[]>([]);
  /** A page whose folder is being chosen. */
  const [filing, setFiling] = useState<DocSummary | null>(null);
  /** Whether a new folder is being named, and what it will be called. */
  const [naming, setNaming] = useState(false);
  const [folderName, setFolderName] = useState("");
  /** True when the list could not be read, which is not the same as empty. */
  const [failed, setFailed] = useState(false);
  const { busy, error, setError, run } = useRun();

  useEffect(() => {
    if (!visible) return;
    if (initialDoc) return setOpen(initialDoc);
    if (agenda) {
      // Today's page is written on the server the first time it is asked for.
      client.agendaToday().then(setOpen, () => setOpen(null));
      return;
    }
    void loadList();
    // Folders and stars are small lists and only matter beside the pages,
    // so they are fetched with them rather than kept in the app's state.
    client.listFolders().then(setFolders, () => setFolders([]));
    client.listFavourites().then(setStars, () => setStars([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, agenda, initialDoc]);

  /**
   * Read the list of pages.
   *
   * A failure is not an empty workspace. Turning one into the other told
   * people their documents were gone whenever the network hiccuped, so a
   * failure says so and offers to try again.
   */
  const loadList = () =>
    client.listDocs().then(
      (list) => {
        setDocs(list);
        setFailed(false);
      },
      (e: Error) => {
        setDocs(null);
        setFailed(true);
        setError(e.message || "Could not reach your documents.");
      },
    );

  /** Star a page, or take the star off. Starred pages come first. */
  const toggleStar = (doc: DocSummary, starred: boolean) => {
    setStars((all) =>
      starred
        ? [...all, { kind: "doc", target_id: doc.id, created_at: "" }]
        : all.filter((f) => !(f.kind === "doc" && f.target_id === doc.id)),
    );
    client.setFavourite("doc", doc.id, starred).catch(report);
  };

  /** Put a page in a folder, or take it out of one. */
  const fileIn = (doc: DocSummary, folderId: string | null) =>
    void run(async () => {
      const full = await client.getDoc(doc.id);
      await client.updateDoc(doc.id, {
        version: full.version,
        folder_id: folderId,
      });
      setFiling(null);
      setDocs(
        (all) =>
          all?.map((d) =>
            d.id === doc.id ? { ...d, folder_id: folderId } : d,
          ) ?? all,
      );
    });

  /** Start a folder. Named here rather than in a settings screen. */
  const newFolder = () =>
    void run(async () => {
      const name = folderName.trim();
      if (!name) return;
      const made = await client.createFolder({ name });
      setFolders((all) => [...all, made]);
      setFolderName("");
      setNaming(false);
      setFolderFilter(made.id);
    });

  /** Start a page here rather than having to reach for a desktop. */
  const create = (kind: DocKind = "doc") =>
    void run(async () => {
      const made = await client.createDoc({
        title: "",
        kind,
        content: [{ type: "paragraph", text: "" }],
      });
      setDocs(null);
      setOpen(made);
    });

  // Coming back to the list should show what was just written.
  const backToList = () => {
    setOpen(null);
    void loadList();
  };

  // Leaving a sheet that opened on the agenda should close it, not show a list.
  // A page opened on its own has no list behind it to go back to.
  const back = agenda || initialDoc ? undefined : open ? backToList : undefined;

  // Searching is a round trip, so it waits for a pause in the typing.
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      client
        .search(query.trim(), {
          type: "doc",
          kind: kindFilter ?? undefined,
          limit: 20,
        })
        .then(setHits, () => setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, kindFilter]);

  /**
   * What the list shows: what was searched for, when something was, and
   * otherwise everything of the chosen kind.
   */
  const starred = favouriteSet(stars);

  type Row = {
    id: string;
    title: string;
    preview: string;
    kind: string;
    updated_at: string;
    folder_id?: string | null;
  };

  const narrowed: Row[] = hits
    ? hits.map((h) => ({
        id: h.id,
        title: h.title,
        updated_at: h.updated_at,
        preview: snippetRuns(h.snippet)
          .map((r) => r.text)
          .join("")
          .replace(/\s+/g, " ")
          .trim(),
        kind: h.kind,
      }))
    : (docs ?? [])
        .filter((d) => kindFilter === null || d.kind === kindFilter)
        // A search looks everywhere; a folder only narrows the plain list.
        .filter((d) =>
          folderFilter === null
            ? true
            : folderFilter === "none"
              ? !d.folder_id
              : d.folder_id === folderFilter,
        );

  /** Starred pages first, then the rest, each keeping its own order. */
  const shown: Row[] = [
    ...narrowed.filter((d) => starred.has(favouriteKey("doc", d.id))),
    ...narrowed.filter((d) => !starred.has(favouriteKey("doc", d.id))),
  ];

  /** How many pages sit in each folder, for the chips to say. */
  const countIn = (id: string | null) =>
    (docs ?? []).filter((d) =>
      id === null ? !d.folder_id : d.folder_id === id,
    ).length;

  /** Open a page from the list, which for a search hit means fetching it. */
  const openHit = (id: string) =>
    void run(async () => setOpen(await client.getDoc(id)));

  /** The editor hands back whatever went wrong; show it where they are. */
  const report = (e: unknown) => setError((e as Error).message || "Not saved");

  return (
    <Sheet
      visible={visible}
      title={open ? open.title || "Untitled" : agenda ? "Agenda" : "Documents"}
      onClose={onClose}
      onBack={back}
      onDismiss={onDismiss}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {open ? (
            <OpenDoc
              doc={open}
              userId={userId}
              canWriteDoc={canWriteDoc}
              onChanged={setOpen}
              onItemsChanged={onItemsChanged}
              onDeleted={backToList}
              report={report}
            />
          ) : failed ? (
            <View style={styles.list}>
              <Text style={styles.empty}>
                Your documents could not be reached. They are still there.
              </Text>
              <Button
                title="Try again"
                secondary
                disabled={busy}
                onPress={() => void loadList()}
              />
            </View>
          ) : docs === null ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : docs.length === 0 ? (
            <View style={styles.list}>
              <Text style={styles.empty}>
                No documents yet. Start one and it is on every device.
              </Text>
              <Button
                title="New document"
                secondary
                disabled={busy}
                onPress={() => create("doc")}
              />
            </View>
          ) : (
            <View style={styles.list}>
              <TextInput
                style={styles.search}
                value={query}
                placeholder="Search pages and notes…"
                placeholderTextColor={colors.faint}
                autoCorrect={false}
                returnKeyType="search"
                onChangeText={setQuery}
                accessibilityLabel="Search pages and notes"
              />
              {hits !== null && (
                <Text style={styles.found}>
                  {hits.length === 0
                    ? "Nothing found."
                    : `${hits.length} found`}
                </Text>
              )}
              {/* Notes and pages live together; this says which you want. */}
              <ChipRow label="Show">
                {(["all", "doc", "note"] as const).map((k) => (
                  <Chip
                    key={k}
                    label={
                      k === "all"
                        ? "Everything"
                        : k === "doc"
                          ? "Pages"
                          : "Notes"
                    }
                    selected={kindFilter === (k === "all" ? null : k)}
                    onPress={() => setKindFilter(k === "all" ? null : k)}
                  />
                ))}
              </ChipRow>
              {/* Where a page is filed. A search looks past this. */}
              <ChipRow label="Folder">
                <Chip
                  label="All"
                  selected={folderFilter === null}
                  onPress={() => setFolderFilter(null)}
                />
                {folders.map((f) => (
                  <Chip
                    key={f.id}
                    label={`${f.name} ${countIn(f.id)}`}
                    selected={folderFilter === f.id}
                    onPress={() => setFolderFilter(f.id)}
                  />
                ))}
                <Chip
                  label={`Unfiled ${countIn(null)}`}
                  selected={folderFilter === "none"}
                  onPress={() => setFolderFilter("none")}
                />
                <Chip
                  label="+ Folder"
                  selected={naming}
                  onPress={() => setNaming((v) => !v)}
                />
              </ChipRow>
              {naming && (
                <View style={styles.newFolder}>
                  <TextInput
                    style={styles.search}
                    value={folderName}
                    placeholder="Name the folder"
                    placeholderTextColor={colors.faint}
                    autoFocus
                    maxLength={60}
                    onChangeText={setFolderName}
                    onSubmitEditing={newFolder}
                    accessibilityLabel="New folder name"
                  />
                  <Button
                    title="Add"
                    disabled={busy || !folderName.trim()}
                    onPress={newFolder}
                  />
                </View>
              )}
              <View style={styles.newRow}>
                <Button
                  title="New document"
                  secondary
                  disabled={busy}
                  onPress={() => create("doc")}
                />
                <Button
                  title="New note"
                  secondary
                  disabled={busy}
                  onPress={() => create("note")}
                />
              </View>
              {!!filing && (
                <View style={styles.filing}>
                  <Text style={styles.filingTitle}>
                    File “{filing.title || "Untitled"}”
                  </Text>
                  <ChipRow label="Folder">
                    <Chip
                      label="Unfiled"
                      selected={!filing.folder_id}
                      onPress={() => fileIn(filing, null)}
                    />
                    {folders.map((f) => (
                      <Chip
                        key={f.id}
                        label={f.name}
                        selected={filing.folder_id === f.id}
                        onPress={() => fileIn(filing, f.id)}
                      />
                    ))}
                  </ChipRow>
                  <SmallAction
                    label="Cancel"
                    disabled={false}
                    onPress={() => setFiling(null)}
                  />
                </View>
              )}
              {shown.map((doc) => (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => openHit(doc.id)}
                >
                  <Icon name="fileText" size={16} color={colors.muted} />
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {doc.title || "Untitled"}
                    </Text>
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {doc.preview || "Empty document"}
                    </Text>
                  </View>
                  <Text style={styles.rowWhen}>{when(doc.updated_at)}</Text>
                  {/* The star and the folder sit outside the row's own press,
                      or tapping either would open the page instead. */}
                  <Pressable
                    onPress={() =>
                      toggleStar(
                        doc as DocSummary,
                        !starred.has(favouriteKey("doc", doc.id)),
                      )
                    }
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={
                      starred.has(favouriteKey("doc", doc.id))
                        ? `Unstar ${doc.title || "Untitled"}`
                        : `Star ${doc.title || "Untitled"}`
                    }
                    style={styles.rowIcon}
                  >
                    <Icon
                      name={
                        starred.has(favouriteKey("doc", doc.id))
                          ? "starFilled"
                          : "star"
                      }
                      size={16}
                      color={
                        starred.has(favouriteKey("doc", doc.id))
                          ? colors.accent
                          : colors.faint
                      }
                    />
                  </Pressable>
                  {!hits && (
                    <Pressable
                      onPress={() => setFiling(doc as DocSummary)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`File ${doc.title || "Untitled"}`}
                      style={styles.rowIcon}
                    >
                      <Icon name="folder" size={16} color={colors.faint} />
                    </Pressable>
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

/**
 * One open document. The comments are fetched here rather than inside the
 * editor, because a line's remarks are shown under that line and the page's
 * own remarks below the page — two places, one set of comments.
 */
function OpenDoc({
  doc,
  userId,
  canWriteDoc,
  onChanged,
  onItemsChanged,
  onDeleted,
  report,
}: {
  doc: Doc;
  userId?: string;
  canWriteDoc?: (teamId: string | null) => boolean;
  onChanged: (doc: Doc) => void;
  onItemsChanged?: () => void;
  onDeleted: () => void;
  report: (e: unknown) => void;
}) {
  // The lines as the editor has them, which runs ahead of the saved copy.
  const [blocks, setBlocks] = useState(doc.content);
  const comments = useDocComments(doc.id, blocks, report);
  return (
    <>
      <DocEditor
        doc={doc}
        comments={comments}
        userId={userId}
        canWrite={canWriteDoc ? canWriteDoc(doc.team_id) : true}
        onBlocksChange={setBlocks}
        onChanged={onChanged}
        onItemsChanged={onItemsChanged}
        onDeleted={onDeleted}
        report={report}
      />
      <DocComments state={comments} userId={userId} />
      <DocHistory doc={doc} onRestored={onChanged} report={report} />
    </>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    newRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    search: {
      color: colors.text,
      fontSize: 15,
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      fontFamily: fonts.regular,
    },
    found: { color: colors.muted, fontSize: 12 },
    newFolder: { flexDirection: "row", gap: 8, alignItems: "center" },
    rowIcon: { padding: 4 },
    filing: {
      gap: 8,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
    },
    filingTitle: {
      color: colors.text,
      fontSize: 14,
      fontFamily: fonts.semibold,
    },
    list: { gap: 8 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    rowMain: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    rowPreview: { color: colors.muted, fontSize: 13 },
    rowWhen: { color: colors.muted, fontSize: 12 },
    page: { gap: 12 },
    title: { color: colors.text, fontSize: 22, fontFamily: fonts.display },
    meta: { color: colors.muted, fontSize: 12, marginTop: -6 },
    hint: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
    },
    empty: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  }),
);

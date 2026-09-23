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
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<"recent" | "title">("recent");
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
    client.setFavourite("doc", doc.id, starred).catch((e) => {
      report(e);
      void client.listFavourites().then(setStars, report);
    });
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
      selectCollection(made.id);
    });

  /** Start a page here rather than having to reach for a desktop. */
  const create = (kind: DocKind = "doc") =>
    void run(async () => {
      const made = await client.createDoc({
        title: "",
        kind,
        content: [{ type: "paragraph", text: "" }],
        folder_id: folderFilter === "none" ? null : folderFilter,
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
  const back = navigationOpen
    ? () => setNavigationOpen(false)
    : agenda || initialDoc
      ? undefined
      : open
        ? backToList
        : undefined;

  // Searching is a round trip, so it waits for a pause in the typing.
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      client
        .search(query.trim(), {
          type: "doc",
          limit: 20,
        })
        .then(
          (rows) => {
            if (active) setHits(rows);
          },
          (e) => {
            if (active) {
              setHits([]);
              setError((e as Error).message);
            }
          },
        );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

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
        .filter((d) => !favoritesOnly || starred.has(favouriteKey("doc", d.id)))
        .filter((d) => kindFilter === null || d.kind === kindFilter)
        // A search looks everywhere; a folder only narrows the plain list.
        .filter((d) =>
          folderFilter === null
            ? true
            : folderFilter === "none"
              ? !d.folder_id
              : d.folder_id === folderFilter,
        );

  const shown: Row[] = [...narrowed].sort((a, b) =>
    sort === "title"
      ? (a.title || "Untitled").localeCompare(b.title || "Untitled") ||
        a.id.localeCompare(b.id)
      : b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  );
  const location = favoritesOnly
    ? "Favorites"
    : folderFilter === "none"
      ? "Unfiled"
      : folderFilter
        ? folders.find((f) => f.id === folderFilter)?.name || "Folder"
        : kindFilter === "doc"
          ? "Pages"
          : kindFilter === "note"
            ? "Notes"
            : "All documents";
  const selectCollection = (
    folder: string | null,
    kind: DocKind | null = null,
    favorites = false,
  ) => {
    setFolderFilter(folder);
    setKindFilter(kind);
    setFavoritesOnly(favorites);
    setQuery("");
    setHits(null);
    setNavigationOpen(false);
    setFiling(null);
  };
  const navRow = (
    label: string,
    action: () => void,
    selected = false,
    icon: "fileText" | "folder" | "star" = "fileText",
    count?: number,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: busy }}
      disabled={busy}
      onPress={action}
      style={[styles.navRow, selected && styles.rowPressed]}
    >
      <Icon
        name={icon}
        size={18}
        color={selected ? colors.accent : colors.muted}
      />
      <Text style={styles.navTitle} numberOfLines={2}>
        {label}
      </Text>
      {count !== undefined && <Text style={styles.found}>{count}</Text>}
    </Pressable>
  );

  /** How many pages sit in each folder, for the library to show. */
  const countIn = (id: string | null) =>
    (docs ?? []).filter((d) =>
      id === null ? !d.folder_id : d.folder_id === id,
    ).length;

  /** Open a page from the list, which for a search hit means fetching it. */
  const openHit = (id: string) =>
    void run(async () => {
      setOpen(await client.getDoc(id));
      setNavigationOpen(false);
    });

  /** The editor hands back whatever went wrong; show it where they are. */
  const report = (e: unknown) => setError((e as Error).message || "Not saved");

  return (
    <Sheet
      visible={visible}
      title={
        navigationOpen
          ? "Library"
          : open
            ? open.title || "Untitled"
            : agenda
              ? "Agenda"
              : "Documents"
      }
      onClose={onClose}
      onBack={back}
      onDismiss={onDismiss}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {navigationOpen ? (
            <View style={styles.list}>
              <Text style={styles.navHeading}>WORKSPACE</Text>
              {navRow(
                "All documents",
                () => selectCollection(null),
                !favoritesOnly && !folderFilter && !kindFilter,
                "fileText",
                docs?.length,
              )}
              {navRow(
                "Pages",
                () => selectCollection(null, "doc"),
                !favoritesOnly && !folderFilter && kindFilter === "doc",
              )}
              {navRow(
                "Notes",
                () => selectCollection(null, "note"),
                !favoritesOnly && !folderFilter && kindFilter === "note",
              )}
              {navRow(
                "Favorites",
                () => selectCollection(null, null, true),
                favoritesOnly,
                "star",
              )}
              <View style={styles.navChildren}>
                {(docs ?? [])
                  .filter((d) => starred.has(favouriteKey("doc", d.id)))
                  .map((d) => (
                    <View key={d.id}>
                      {navRow(d.title || "Untitled", () => openHit(d.id))}
                    </View>
                  ))}
              </View>
              <Text style={styles.navHeading}>FOLDERS</Text>
              {[
                ...folders
                  .map((f) => ({ id: f.id, name: f.name }))
                  .sort((a, b) => a.name.localeCompare(b.name)),
                { id: "none", name: "Unfiled" },
              ].map((f) => (
                <View key={f.id}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandedFolder === f.id }}
                    style={styles.navRow}
                    onPress={() =>
                      setExpandedFolder(expandedFolder === f.id ? null : f.id)
                    }
                  >
                    <Icon name="folder" size={18} color={colors.muted} />
                    <Text style={styles.navTitle} numberOfLines={2}>
                      {f.name}
                    </Text>
                    <Text style={styles.found}>
                      {countIn(f.id === "none" ? null : f.id)}{" "}
                      {expandedFolder === f.id ? "−" : "+"}
                    </Text>
                  </Pressable>
                  {expandedFolder === f.id && (
                    <View style={styles.navChildren}>
                      {navRow(
                        "View folder",
                        () => selectCollection(f.id),
                        folderFilter === f.id,
                      )}
                      {(docs ?? [])
                        .filter((d) =>
                          f.id === "none" ? !d.folder_id : d.folder_id === f.id,
                        )
                        .sort((a, b) => a.title.localeCompare(b.title))
                        .map((d) => (
                          <View key={d.id}>
                            {navRow(d.title || "Untitled", () => openHit(d.id))}
                          </View>
                        ))}
                    </View>
                  )}
                </View>
              ))}
              <Button
                title="New folder"
                secondary
                onPress={() => setNaming(!naming)}
              />
              {naming && (
                <View style={styles.newFolder}>
                  <TextInput
                    style={[styles.search, { flex: 1, minWidth: 0 }]}
                    value={folderName}
                    placeholder="Folder name"
                    placeholderTextColor={colors.faint}
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
            </View>
          ) : open ? (
            <OpenDoc
              key={open.id}
              doc={open}
              userId={userId}
              canWriteDoc={canWriteDoc}
              onChanged={(saved) => {
                setOpen((current) =>
                  current?.id === saved.id ? saved : current,
                );
                setDocs(
                  (current) =>
                    current?.map((d) =>
                      d.id === saved.id
                        ? {
                            ...d,
                            title: saved.title,
                            updated_at: saved.updated_at,
                          }
                        : d,
                    ) ?? current,
                );
              }}
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
          ) : (
            <View style={styles.list}>
              <View style={styles.libraryToolbar}>
                <Button
                  title="All folders"
                  secondary
                  onPress={() => setNavigationOpen(true)}
                />
                <SmallAction
                  label={
                    sort === "recent" ? "Sort: last edited" : "Sort: title A–Z"
                  }
                  disabled={false}
                  onPress={() =>
                    setSort(sort === "recent" ? "title" : "recent")
                  }
                />
              </View>
              <Text style={styles.collectionTitle}>{location}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.collections}
                accessibilityLabel="Document collections"
              >
                {(
                  [
                    ["All", null, null, false],
                    ["Pages", null, "doc", false],
                    ["Notes", null, "note", false],
                    ["Favorites", null, null, true],
                    ...folders.map((folder) => [
                      folder.name,
                      folder.id,
                      null,
                      false,
                    ]),
                    ["Unfiled", "none", null, false],
                  ] as [string, string | null, DocKind | null, boolean][]
                ).map(([label, folder, kind, favorites]) => {
                  const selected =
                    favoritesOnly === favorites &&
                    folderFilter === folder &&
                    kindFilter === kind;
                  return (
                    <Pressable
                      key={`${folder ?? "all"}-${kind ?? "all"}-${favorites}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => selectCollection(folder, kind, favorites)}
                      style={[
                        styles.collectionChip,
                        selected && styles.collectionChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.collectionChipText,
                          selected && styles.collectionChipTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <TextInput
                style={styles.search}
                value={query}
                placeholder="Search all pages and notes…"
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
              {shown.length === 0 &&
                (docs.length === 0 && !query ? (
                  <View style={styles.emptyLibrary}>
                    <View style={styles.emptyLibraryIcon}>
                      <Icon name="fileText" size={22} color={colors.accent} />
                    </View>
                    <Text style={styles.emptyLibraryTitle}>
                      A home for every idea.
                    </Text>
                    <Text style={styles.emptyLibraryBody}>
                      Create a page or a quick note. Folders will keep them easy
                      to find as your library grows.
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.empty}>
                    Nothing here yet. Try another collection or search.
                  </Text>
                ))}
              {shown.map((doc) => (
                <View key={doc.id} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${doc.title || "Untitled"}`}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.rowOpen,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => openHit(doc.id)}
                  >
                    <View style={styles.rowTop}>
                      <Icon name="fileText" size={16} color={colors.muted} />
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {doc.title || "Untitled"}
                      </Text>
                    </View>
                    {/* The time leads the preview rather than sitting up on
                      the title's line, where it cost the title the 20pt that
                      turned "Monday 21 September" into "Monday 21 Septe…". */}
                    <Text style={styles.rowPreview} numberOfLines={2}>
                      <Text style={styles.rowWhen}>{when(doc.updated_at)}</Text>
                      {"  ·  " + (doc.preview || "Empty document")}
                    </Text>
                  </Pressable>
                  <View style={styles.rowActions}>
                    <Text style={styles.rowKind}>
                      {doc.kind === "note"
                        ? "Note"
                        : doc.kind === "agenda"
                          ? "Agenda"
                          : "Document"}
                    </Text>
                    {/* The star and the folder sit outside the row's own press,
                        or tapping either would open the page instead. */}
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        toggleStar(
                          doc as DocSummary,
                          !starred.has(favouriteKey("doc", doc.id)),
                        );
                      }}
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
                        onPress={(event) => {
                          event.stopPropagation();
                          setFiling(doc as DocSummary);
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`File ${doc.title || "Untitled"}`}
                        style={styles.rowIcon}
                      >
                        <Icon name="folder" size={16} color={colors.faint} />
                      </Pressable>
                    )}
                  </View>
                </View>
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
      <DocHistory
        doc={doc}
        canWrite={canWriteDoc ? canWriteDoc(doc.team_id) : true}
        onRestored={onChanged}
        report={report}
      />
    </>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    libraryToolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
      justifyContent: "space-between",
    },
    collectionTitle: {
      fontSize: 24,
      fontFamily: fonts.display,
      color: colors.text,
    },
    collections: { gap: 8, paddingVertical: 2 },
    collectionChip: {
      minHeight: 40,
      maxWidth: 160,
      paddingHorizontal: 14,
      justifyContent: "center",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    collectionChipActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    collectionChipText: {
      color: colors.textSoft,
      fontSize: 13,
      fontFamily: fonts.medium,
    },
    collectionChipTextActive: {
      color: colors.accent,
      fontFamily: fonts.semibold,
    },
    navHeading: {
      color: colors.muted,
      fontSize: 12,
      fontFamily: fonts.semibold,
      marginTop: 16,
      letterSpacing: 1,
    },
    navRow: {
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      padding: 10,
      minHeight: 48,
      borderRadius: 8,
    },
    navTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      fontFamily: fonts.medium,
    },
    navChildren: {
      marginLeft: 18,
      paddingLeft: 10,
      borderLeftWidth: 1,
      borderLeftColor: colors.border,
    },
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
    rowIcon: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
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
    list: { gap: 12 },
    // Title, time and the two controls share the first line; the preview gets
    // the whole width underneath. Laid out side by side on a 375pt phone the
    // preview was down to 125pt — "We ship the conne…" — which told nobody
    // anything.
    row: {
      gap: 4,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    rowOpen: { gap: 10, minHeight: 64, borderRadius: 8 },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    rowActions: { flexDirection: "row", alignItems: "center", gap: 4 },
    rowKind: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.accent,
    },
    rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    rowTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 17,
      lineHeight: 24,
      fontFamily: fonts.semibold,
    },
    rowPreview: { color: colors.muted, fontSize: 13, lineHeight: 18 },
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
    emptyLibrary: {
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 22,
      paddingVertical: 30,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    emptyLibraryIcon: {
      width: 52,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 16,
      backgroundColor: colors.accentSoft,
    },
    emptyLibraryTitle: {
      color: colors.text,
      fontFamily: fonts.display,
      fontSize: 19,
      textAlign: "center",
    },
    emptyLibraryBody: {
      color: colors.muted,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 20,
      textAlign: "center",
    },
  }),
);

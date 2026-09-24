import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  addDays,
  agendaDay,
  agendaGroups,
  agendaMonthKey,
  agendaTitleOn,
  agendaWeekOf,
  localDateKey,
  favouriteKey,
  favouriteSet,
  savedAgo,
  snippetRuns,
  trashLeft,
  TRASH_DAYS,
  type TrashedDoc,
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
import { confirmAction } from "../../lib/confirm";
import { deviceTimeZone } from "../../lib/planning";
import { shared } from "../../styles";
import { useRun } from "../../hooks/useRun";
import { colors, fonts, radii, themed } from "../../theme";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { UploadsList, useImports } from "./Uploads";
import { SmallAction } from "../../components/SmallAction";
import { MoreMenu } from "../../components/MoreMenu";
import { DocComments } from "./DocComments";
import { DocHistory } from "./DocHistory";
import { DocEditor } from "./DocEditor";
import { useDocComments } from "./useDocComments";
import { PressableScale } from "../../motion";
import { errorText } from "../../lib/errors";
import { showToast } from "../../components/Toast";
import { PageTemplatesPanel } from "./PageTemplates";
import { SlotHost, useSlot, type SlotHandle } from "../../components/Slot";
import { isReducedMotion } from "../../motion";

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
  onMakeCards,
  startInUploads,
  startInTemplates,
  startNew,
  onStarted,
}: {
  /** Open on Uploads (after files were shared to Orbyn). */
  startInUploads?: boolean;
  /** Open on "New page from a template" (the + sheet's From template). */
  startInTemplates?: boolean;
  /** Start a new page of this kind straight away (the + sheet's New page). */
  startNew?: DocKind | null;
  onStarted?: () => void;
  /** Suggest study cards from a page (opens Study). */
  onMakeCards?: (docId: string, title: string) => void;
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
  /** Pages nobody has changed or confirmed in months. */
  const [fading, setFading] = useState<Set<string>>(new Set());
  const [fadingOnly, setFadingOnly] = useState(false);
  useEffect(() => {
    if (!visible) return;
    client.fadingDocs().then(
      (list) => setFading(new Set(list.map((d) => d.id))),
      () => {},
    );
  }, [visible]);
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  /**
   * null = every kind but agendas; "note" = only notes; "doc" = only plain
   * pages; "agenda" = the daily agendas, which have their own section.
   */
  const [kindFilter, setKindFilter] = useState<DocKind | null>(null);
  /** Within agendas: one month ("2026-09"), or null for all of them. */
  const [agendaMonth, setAgendaMonth] = useState<string | null>(null);
  /** Uploads: files being imported, and imported pages not filed yet. */
  const [uploadsOnly, setUploadsOnly] = useState(false);
  /** Trash: deleted pages, kept for `TRASH_DAYS` days. */
  const [trashOnly, setTrashOnly] = useState(false);
  const [trash, setTrash] = useState<TrashedDoc[] | null>(null);
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
  /** Only pages with this tag, by id; "" for every page. */
  const [tagFilter, setTagFilter] = useState("");
  /** Whether "New page from a template" is showing in place of the list. */
  const [templating, setTemplating] = useState(false);
  /**
   * Stepping through agendas: today's date in your own zone, and a day with
   * no page written yet (shown as a gap with a way to write it).
   */
  const [agendaToday, setAgendaToday] = useState(() =>
    localDateKey(new Date(), deviceTimeZone()),
  );
  const [agendaGap, setAgendaGap] = useState<string | null>(null);
  const { busy, error, setError, run } = useRun();
  /** The page's header buttons and the keyboard toolbar, filled by the page. */
  const headerSlot = useSlot();
  const toolbarSlot = useSlot();
  /** Scrolled past the page's own title: the header shows it instead. */
  const [scrolledPast, setScrolledPast] = useState(false);
  /** Bumped to open the page's history from its ⋯ or Info. */
  const [historyKey, setHistoryKey] = useState(0);
  const scroller = useRef<ScrollView>(null);

  // Left open past midnight, today's page becomes yesterday's: the labels
  // and Rewrite follow the clock whenever the app comes back to the front.
  useEffect(() => {
    if (!agenda) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const now = localDateKey(new Date(), deviceTimeZone());
      setAgendaToday((was) => (now > was ? now : was));
    });
    return () => sub.remove();
  }, [agenda]);

  useEffect(() => {
    if (!visible) return;
    if (initialDoc) return setOpen(initialDoc);
    if (agenda) {
      // Today's page is written on the server the first time it is asked for.
      setAgendaGap(null);
      client.agendaToday(deviceTimeZone()).then(
        (doc) => {
          setOpen(doc);
          if (doc.agenda_date) setAgendaToday(doc.agenda_date);
        },
        () => setOpen(null),
      );
      return;
    }
    void loadList();
    if (startInUploads) {
      selectCollection(null, null, false, null, true);
      onStarted?.();
    }
    if (startInTemplates) {
      setTemplating(true);
      onStarted?.();
    }
    if (startNew) {
      create(startNew);
      onStarted?.();
    }
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
  const loadTrash = () =>
    client.listTrash().then(setTrash, (e: Error) => {
      setTrash([]);
      setError(errorText(e));
    });

  const loadList = () =>
    client.listDocs().then(
      (list) => {
        setDocs(list);
        setFailed(false);
      },
      (e: Error) => {
        setDocs(null);
        setFailed(true);
        setError(errorText(e));
      },
    );

  const imports = useImports(
    (m) => setError(m),
    () => void loadList(),
  );
  const importFile = () => {
    selectCollection(null, null, false, null, true);
    void imports.pickAndImport().catch((e: Error) => setError(errorText(e)));
  };

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
            d.id === doc.id
              ? { ...d, folder_id: folderId, in_uploads: false }
              : d,
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

  useEffect(() => {
    setScrolledPast(false);
    setHistoryKey(0);
  }, [open?.id]);

  /** Open the page's history and bring it into view. */
  const showHistory = () => {
    setHistoryKey((k) => k + 1);
    setTimeout(
      () => scroller.current?.scrollToEnd({ animated: !isReducedMotion() }),
      120,
    );
  };

  // Coming back to the list should show what was just written.
  const backToList = () => {
    setOpen(null);
    setAgendaGap(null);
    void loadList();
    if (trashOnly) void loadTrash();
  };

  /** Step to another day's agenda, or to the gap where it would be. */
  const goAgenda = (date: string) =>
    void run(async () => {
      const day = await client.agendaOn(date, deviceTimeZone());
      setAgendaToday(day.today);
      if (day.doc) {
        setAgendaGap(null);
        setOpen(day.doc);
      } else {
        setOpen(null);
        setAgendaGap(date);
      }
    });

  /** Write the missing day's agenda from the calendar. */
  const writeAgenda = (date: string) =>
    void run(async () => {
      const doc = await client.writeAgenda(date);
      setAgendaGap(null);
      setOpen(doc);
    });

  /** Bring a page back from Trash; the toast offers to open it. */
  const restoreFromTrash = (page: TrashedDoc) =>
    void run(async () => {
      const back = await client.restoreDoc(page.id);
      setTrash((all) => all?.filter((d) => d.id !== page.id) ?? all);
      void loadList();
      showToast({
        text: `Restored “${back.title || "Untitled"}”`,
        action: { label: "Open", run: () => setOpen(back) },
      });
    });

  /** Delete a page in Trash for good, after asking: this can't be undone. */
  const destroy = (page: TrashedDoc) =>
    confirmAction(
      `Delete “${page.title || "Untitled"}” for good?`,
      "Its history and comments go with it. This can't be undone.",
      "Delete for good",
      () =>
        void run(async () => {
          await client.deleteDocForever(page.id);
          setTrash((all) => all?.filter((d) => d.id !== page.id) ?? all);
        }),
    );

  // Leaving a sheet that opened on the agenda should close it, not show a list.
  // A page opened on its own has no list behind it to go back to.
  const back = navigationOpen
    ? () => setNavigationOpen(false)
    : agenda || initialDoc
      ? undefined
      : open || agendaGap
        ? backToList
        : templating
          ? () => setTemplating(false)
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
              setError(errorText(e));
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
  const uploadCount =
    (docs ?? []).filter((d) => d.in_uploads).length +
    imports.jobs.filter((j) =>
      ["waiting", "queued", "reading", "ocr", "failed"].includes(j.status),
    ).length;

  type Row = {
    id: string;
    title: string;
    preview: string;
    kind: string;
    updated_at: string;
    created_at?: string;
    folder_id?: string | null;
    agenda_date?: string | null;
    tags?: DocSummary["tags"];
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
        .filter((d) => !fadingOnly || fading.has(d.id))
        // A page a day would flood everything else, so agendas live in
        // their own section (a starred one still shows under Favorites).
        .filter((d) =>
          kindFilter === null
            ? d.kind !== "agenda" || favoritesOnly
            : d.kind === kindFilter,
        )
        .filter(
          (d) =>
            kindFilter !== "agenda" ||
            !agendaMonth ||
            agendaMonthKey(agendaDay(d)) === agendaMonth,
        )
        // A search looks everywhere; a folder only narrows the plain list.
        .filter((d) =>
          folderFilter === null
            ? true
            : folderFilter === "none"
              ? !d.folder_id
              : d.folder_id === folderFilter,
        );
  const agendas = agendaGroups(docs ?? []);
  // The tags on the pages in view, for the tag filter; then the filter.
  const tagsHere = [
    ...new Map(
      narrowed.flatMap((d) => d.tags ?? []).map((t) => [t.id, t] as const),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const tagged = tagFilter
    ? narrowed.filter((d) => d.tags?.some((t) => t.id === tagFilter))
    : narrowed;

  /** When an agenda row is filed: the day it's for. */
  const dayOf = (row: Row) =>
    agendaDay({
      created_at: row.created_at ?? "",
      agenda_date: row.agenda_date,
    });
  const shown: Row[] = [...tagged].sort((a, b) =>
    kindFilter === "agenda" && a.created_at && b.created_at
      ? dayOf(b).localeCompare(dayOf(a))
      : sort === "title"
        ? (a.title || "Untitled").localeCompare(b.title || "Untitled") ||
          a.id.localeCompare(b.id)
        : b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  );
  const location = trashOnly
    ? "Trash"
    : uploadsOnly
      ? "Uploads"
      : favoritesOnly
        ? "Favorites"
        : folderFilter === "none"
          ? "Unfiled"
          : folderFilter
            ? folders.find((f) => f.id === folderFilter)?.name || "Folder"
            : kindFilter === "agenda"
              ? "Agendas"
              : kindFilter === "doc"
                ? "Pages"
                : kindFilter === "note"
                  ? "Notes"
                  : "All documents";
  const selectCollection = (
    folder: string | null,
    kind: DocKind | null = null,
    favorites = false,
    month: string | null = null,
    uploads = false,
    trashed = false,
  ) => {
    setTrashOnly(trashed);
    if (trashed) void loadTrash();
    setUploadsOnly(uploads);
    setFolderFilter(folder);
    setKindFilter(kind);
    setAgendaMonth(month);
    setFavoritesOnly(favorites);
    setQuery("");
    setHits(null);
    setNavigationOpen(false);
    setFiling(null);
    setTagFilter("");
    setTemplating(false);
  };
  const navRow = (
    label: string,
    action: () => void,
    selected = false,
    icon: "fileText" | "folder" | "star" | "trash" = "fileText",
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
      id === null ? !d.folder_id && d.kind !== "agenda" : d.folder_id === id,
    ).length;

  /** Open a page from the list, which for a search hit means fetching it. */
  const openHit = (id: string) =>
    void run(async () => {
      setOpen(await client.getDoc(id));
      setNavigationOpen(false);
    });

  /** The editor hands back whatever went wrong; show it where they are. */
  const report = (e: unknown) => setError(errorText(e));

  return (
    <Sheet
      visible={visible}
      title={
        navigationOpen
          ? "Library"
          : open
            ? // A page's own title leads the page; the header takes it up
              // once it has scrolled away.
              scrolledPast
              ? open.title || "Untitled"
              : ""
            : agenda || agendaGap
              ? "Agenda"
              : templating
                ? "New page"
                : "Documents"
      }
      onClose={onClose}
      // A page's header is Back, its title, Info and ⋯: with no list
      // behind it, Back closes.
      onBack={back ?? (open && !navigationOpen ? onClose : undefined)}
      centerTitle={!!open && !navigationOpen}
      hideClose={!!open && !navigationOpen}
      actions={
        open && !navigationOpen ? <SlotHost slot={headerSlot} /> : undefined
      }
      onDismiss={onDismiss}
    >
      <ScrollView
        ref={scroller}
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        scrollEventThrottle={32}
        onScroll={(e) => {
          const past = e.nativeEvent.contentOffset.y > 56;
          if (past !== scrolledPast) setScrolledPast(past);
        }}
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {navigationOpen ? (
            <View style={styles.list}>
              <Text style={styles.navHeading}>WORKSPACE</Text>
              {navRow(
                "All documents",
                () => selectCollection(null),
                !favoritesOnly && !uploadsOnly && !folderFilter && !kindFilter,
                "fileText",
                docs?.filter((d) => d.kind !== "agenda").length,
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
              {navRow(
                "Uploads",
                () => selectCollection(null, null, false, null, true),
                uploadsOnly,
                "fileText",
                uploadCount || undefined,
              )}
              {navRow(
                "Trash",
                () => selectCollection(null, null, false, null, false, true),
                trashOnly,
                "trash",
              )}
              {agendas.length > 0 && (
                <>
                  {navRow(
                    "Agendas",
                    () => selectCollection(null, "agenda"),
                    !favoritesOnly && kindFilter === "agenda" && !agendaMonth,
                  )}
                  <View style={styles.navChildren}>
                    {agendas.flatMap((y) =>
                      y.months.map((m) => (
                        <View key={m.key}>
                          {navRow(
                            `${m.label} ${y.year}`,
                            () =>
                              selectCollection(null, "agenda", false, m.key),
                            kindFilter === "agenda" && agendaMonth === m.key,
                          )}
                        </View>
                      )),
                    )}
                  </View>
                </>
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
                          f.id === "none"
                            ? !d.folder_id && d.kind !== "agenda"
                            : d.folder_id === f.id,
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
          ) : open || agendaGap ? (
            <>
              {(agendaGap || open?.kind === "agenda") && (
                <AgendaNav
                  date={agendaGap ?? open?.agenda_date ?? agendaToday}
                  today={agendaToday}
                  busy={busy}
                  onGo={goAgenda}
                />
              )}
              {agendaGap ? (
                <View style={styles.agendaGap}>
                  <Icon name="calendar" size={22} color={colors.muted} />
                  <Text style={styles.empty}>
                    {agendaGap < agendaToday
                      ? `Nothing was written for ${agendaTitleOn(agendaGap)}.`
                      : `${agendaTitleOn(agendaGap)} isn’t written yet.`}
                  </Text>
                  <Button
                    title={busy ? "Writing…" : "Write it from my calendar"}
                    disabled={busy}
                    onPress={() => writeAgenda(agendaGap)}
                  />
                </View>
              ) : (
                <OpenDoc
                  key={open!.id}
                  doc={open!}
                  isToday={
                    !open!.agenda_date || open!.agenda_date === agendaToday
                  }
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
                  onUndoDelete={(back) => {
                    // Undo from the toast: the page comes back open.
                    setOpen(back);
                    void loadList();
                  }}
                  headerSlot={headerSlot}
                  toolbarSlot={toolbarSlot}
                  historyKey={historyKey}
                  onShowHistory={showHistory}
                  report={report}
                />
              )}
            </>
          ) : templating ? (
            <PageTemplatesPanel
              folders={folders}
              folderId={
                folderFilter && folderFilter !== "none" ? folderFilter : null
              }
              onCancel={() => setTemplating(false)}
              onCreated={(doc, note, tasks) => {
                setTemplating(false);
                setOpen(doc);
                showToast({ text: note });
                if (tasks) onItemsChanged?.();
                void loadList();
              }}
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
                <SmallAction
                  label="All folders"
                  disabled={false}
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
                    ...(agendas.length
                      ? [["Agendas", null, "agenda", false]]
                      : []),
                    ["Favorites", null, null, true],
                    ["Uploads", null, null, false, true],
                    ...folders.map((folder) => [
                      folder.name,
                      folder.id,
                      null,
                      false,
                    ]),
                    ["Unfiled", "none", null, false],
                    ["Trash", null, null, false, false, true],
                  ] as [
                    string,
                    string | null,
                    DocKind | null,
                    boolean,
                    boolean?,
                    boolean?,
                  ][]
                ).map(
                  ([
                    label,
                    folder,
                    kind,
                    favorites,
                    uploads = false,
                    trashed = false,
                  ]) => {
                    const selected =
                      trashOnly === trashed &&
                      uploadsOnly === uploads &&
                      favoritesOnly === favorites &&
                      folderFilter === folder &&
                      kindFilter === kind;
                    return (
                      <Pressable
                        key={`${folder ?? "all"}-${kind ?? "all"}-${favorites}-${uploads}-${trashed}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() =>
                          selectCollection(
                            folder,
                            kind,
                            favorites,
                            null,
                            uploads,
                            trashed,
                          )
                        }
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
                  },
                )}
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
              {!hits &&
                !trashOnly &&
                !uploadsOnly &&
                (tagsHere.length > 0 || !!tagFilter) && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.collections}
                    accessibilityLabel="Show pages with a tag"
                  >
                    <Chip
                      compact
                      label="All tags"
                      selected={!tagFilter}
                      onPress={() => setTagFilter("")}
                    />
                    {tagsHere.map((t) => (
                      <Chip
                        key={t.id}
                        compact
                        label={`#${t.name}`}
                        selected={tagFilter === t.id}
                        onPress={() =>
                          setTagFilter(tagFilter === t.id ? "" : t.id)
                        }
                      />
                    ))}
                  </ScrollView>
                )}
              {/* The main way in full width, the other two side by side, as
              on Projects. */}
              <View style={styles.newActions}>
                <View style={styles.newRow}>
                  <Button
                    title="New document"
                    icon="plus"
                    disabled={busy}
                    style={styles.newHalf}
                    onPress={() => create("doc")}
                  />
                  <Button
                    title="From template"
                    secondary
                    disabled={busy}
                    style={styles.newHalf}
                    onPress={() => setTemplating(true)}
                  />
                </View>
                <View style={styles.newRow}>
                  <Button
                    title="New note"
                    secondary
                    disabled={busy}
                    style={styles.newHalf}
                    onPress={() => create("note")}
                  />
                  <Button
                    title={imports.busy ? "Uploading…" : "Import file"}
                    secondary
                    disabled={imports.busy}
                    style={styles.newHalf}
                    onPress={importFile}
                  />
                </View>
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
              {fading.size > 0 && !hits && !trashOnly && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: fadingOnly }}
                  onPress={() => setFadingOnly(!fadingOnly)}
                  style={[styles.fadingBar, fadingOnly && styles.fadingBarOn]}
                >
                  <Icon name="clock" size={15} color={colors.textSoft} />
                  <Text style={styles.fadingText}>
                    {fadingOnly
                      ? "Showing pages that might be out of date · Show all"
                      : `${fading.size} ${fading.size === 1 ? "page" : "pages"} might be out of date`}
                  </Text>
                </Pressable>
              )}
              {trashOnly && !hits && (
                <View style={styles.list}>
                  <Text style={styles.trashNote}>
                    Pages you delete wait here for {TRASH_DAYS} days, then
                    they’re deleted for good.
                  </Text>
                  {trash === null ? (
                    <Text style={styles.empty}>Loading…</Text>
                  ) : trash.length === 0 ? (
                    <View style={styles.emptyLibrary}>
                      <Icon name="trash" size={22} color={colors.muted} />
                      <Text style={styles.empty}>Trash is empty.</Text>
                    </View>
                  ) : (
                    trash.map((page) => (
                      <View key={page.id} style={styles.row}>
                        <View style={styles.rowTop}>
                          <Icon
                            name="fileText"
                            size={16}
                            color={colors.muted}
                          />
                          <Text style={styles.rowTitle} numberOfLines={2}>
                            {page.title || "Untitled"}
                          </Text>
                          {page.can_restore && (
                            // Deleting for good is rare and can't be undone,
                            // so it waits behind ⋯ rather than on the row.
                            <MoreMenu
                              label={`Options for ${page.title || "Untitled"}`}
                              disabled={busy}
                              actions={[
                                {
                                  label: "Delete for good",
                                  destructive: true,
                                  onPress: () => destroy(page),
                                },
                              ]}
                            />
                          )}
                        </View>
                        <Text style={styles.rowPreview} numberOfLines={2}>
                          Deleted {savedAgo(page.deleted_at)}
                          {page.deleted_by ? ` by ${page.deleted_by}` : ""}
                          {page.team_name ? ` · ${page.team_name}` : ""} ·{" "}
                          {trashLeft(page.purge_at)}
                        </Text>
                        {page.can_restore && (
                          <View style={styles.trashActions}>
                            <SmallAction
                              label="Restore"
                              disabled={busy}
                              onPress={() => restoreFromTrash(page)}
                            />
                          </View>
                        )}
                      </View>
                    ))
                  )}
                </View>
              )}
              {uploadsOnly && !hits && (
                <UploadsList
                  jobs={imports.jobs}
                  docs={docs}
                  busy={imports.busy}
                  onOpen={openHit}
                  onFile={setFiling}
                  onRemove={(job) => void imports.remove(job)}
                  onImport={importFile}
                  onScan={() =>
                    void imports
                      .scanNotes()
                      .catch((e: Error) => setError(errorText(e)))
                  }
                  onMakeCards={onMakeCards}
                  caps={imports.caps}
                />
              )}
              {!((uploadsOnly || trashOnly) && !hits) &&
                shown.length === 0 &&
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
              {!((uploadsOnly || trashOnly) && !hits) &&
                shown.map((doc, n) => (
                  <View key={doc.id}>
                    {kindFilter === "agenda" && !hits && doc.created_at && (
                      <>
                        {(n === 0 ||
                          agendaMonthKey(dayOf(doc)) !==
                            agendaMonthKey(dayOf(shown[n - 1]))) && (
                          <Text style={styles.monthHeading}>
                            {new Date(dayOf(doc)).toLocaleDateString("en-GB", {
                              month: "long",
                              year: "numeric",
                            })}
                          </Text>
                        )}
                        {(n === 0 ||
                          agendaWeekOf(dayOf(doc)).key !==
                            agendaWeekOf(dayOf(shown[n - 1])).key) && (
                          <Text style={styles.weekHeading}>
                            {agendaWeekOf(dayOf(doc)).label}
                          </Text>
                        )}
                      </>
                    )}
                    {/* The whole card opens the page, as project cards do; the
                    star and the folder are buttons of their own inside it. A
                    short delay keeps a scroll from flashing the card. */}
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${doc.title || "Untitled"}`}
                      disabled={busy}
                      unstable_pressDelay={90}
                      scaleTo={0.985}
                      style={({ pressed }) => [
                        styles.row,
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
                        <Text style={styles.rowWhen}>
                          {when(doc.updated_at)}
                        </Text>
                        {"  ·  " + (doc.preview || "Empty document")}
                      </Text>
                      <View style={styles.rowActions}>
                        <Text style={styles.rowKind} numberOfLines={1}>
                          {doc.kind === "note"
                            ? "Note"
                            : doc.kind === "agenda"
                              ? "Agenda"
                              : "Document"}
                          {doc.tags?.length ? (
                            <Text style={styles.rowTags}>
                              {"  " +
                                doc.tags.map((t) => `#${t.name}`).join(" ")}
                            </Text>
                          ) : null}
                        </Text>
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
                            <Icon
                              name="folder"
                              size={16}
                              color={colors.faint}
                            />
                          </Pressable>
                        )}
                      </View>
                    </PressableScale>
                  </View>
                ))}
            </View>
          )}
        </View>
      </ScrollView>
      {/* The line being typed gets its toolbar here, on the keyboard. */}
      {open && !navigationOpen && <SlotHost slot={toolbarSlot} />}
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
  isToday = true,
  userId,
  canWriteDoc,
  onChanged,
  onItemsChanged,
  onDeleted,
  onUndoDelete,
  headerSlot,
  toolbarSlot,
  historyKey,
  onShowHistory,
  report,
}: {
  doc: Doc;
  headerSlot?: SlotHandle;
  toolbarSlot?: SlotHandle;
  /** Bumped to open the history below the page. */
  historyKey?: number;
  onShowHistory?: () => void;
  /** For an agenda: whether it is today's, the only one Rewrite writes. */
  isToday?: boolean;
  userId?: string;
  canWriteDoc?: (teamId: string | null) => boolean;
  onChanged: (doc: Doc) => void;
  onItemsChanged?: () => void;
  onDeleted: () => void;
  onUndoDelete?: (doc: Doc) => void;
  report: (e: unknown) => void;
}) {
  // The lines as the editor has them, which runs ahead of the saved copy.
  const [blocks, setBlocks] = useState(doc.content);
  const comments = useDocComments(doc.id, blocks, report);
  const [rewriting, setRewriting] = useState(false);
  const [rewritten, setRewritten] = useState("");
  const rewrite = () =>
    confirmAction(
      "Rewrite today's agenda?",
      "Everything above Notes is written again from your calendar as it is now. Your notes and end-of-day answers stay as they are.",
      "Rewrite",
      () => {
        setRewriting(true);
        setRewritten("");
        client.rewriteAgenda(deviceTimeZone()).then(
          (next) => {
            setRewriting(false);
            setRewritten(
              next.brief
                ? "Rewritten from your calendar, with the assistant's summary."
                : "Rewritten from your calendar.",
            );
            onChanged(next);
          },
          (e) => {
            setRewriting(false);
            report(e);
          },
        );
      },
    );
  return (
    <>
      {doc.kind === "agenda" && (
        <View style={styles.agendaBar}>
          <Text style={[shared.small, { flex: 1 }]}>
            {rewritten ||
              "Written from your calendar. Notes are yours: a rewrite leaves them alone."}
          </Text>
          {isToday && (
            <SmallAction
              label={rewriting ? "Rewriting…" : "Rewrite"}
              disabled={rewriting}
              onPress={rewrite}
            />
          )}
        </View>
      )}
      <DocEditor
        doc={doc}
        comments={comments}
        userId={userId}
        canWrite={canWriteDoc ? canWriteDoc(doc.team_id) : true}
        onBlocksChange={setBlocks}
        onChanged={onChanged}
        onItemsChanged={onItemsChanged}
        onDeleted={onDeleted}
        onUndoDelete={onUndoDelete}
        headerSlot={headerSlot}
        toolbarSlot={toolbarSlot}
        onShowHistory={onShowHistory}
        report={report}
      />
      <DocComments state={comments} userId={userId} />
      <DocHistory
        doc={doc}
        canWrite={canWriteDoc ? canWriteDoc(doc.team_id) : true}
        onRestored={onChanged}
        openKey={historyKey}
        report={report}
      />
    </>
  );
}

/** "Today", "Yesterday", "Tomorrow", or the day's own name. */
function dayName(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return agendaTitleOn(date);
}

/**
 * ‹ and › to the day before and after, and a way back to today: the agenda
 * read as a diary. A year back and two months ahead, as far as it goes.
 */
function AgendaNav({
  date,
  today,
  busy,
  onGo,
}: {
  date: string;
  today: string;
  busy: boolean;
  onGo: (date: string) => void;
}) {
  const arrow = (by: -1 | 1) => {
    const off =
      busy ||
      (by < 0 ? date <= addDays(today, -366) : date >= addDays(today, 62));
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={by < 0 ? "The day before" : "The day after"}
        accessibilityState={{ disabled: off }}
        disabled={off}
        hitSlop={6}
        onPress={() => onGo(addDays(date, by))}
        style={({ pressed }) => [
          styles.dayArrow,
          pressed && styles.rowPressed,
          off && { opacity: 0.4 },
        ]}
      >
        <Icon
          name={by < 0 ? "chevronLeft" : "chevronRight"}
          size={18}
          color={colors.textSoft}
        />
      </Pressable>
    );
  };
  return (
    <View style={styles.agendaNav}>
      {arrow(-1)}
      <Text style={styles.agendaDay} accessibilityLiveRegion="polite">
        {dayName(date, today)}
      </Text>
      {arrow(1)}
      <View style={{ flex: 1 }} />
      {date !== today && (
        <SmallAction
          label="Today"
          disabled={busy}
          onPress={() => onGo(today)}
        />
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    agendaNav: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginBottom: 8,
    },
    dayArrow: {
      width: 34,
      height: 34,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    agendaDay: {
      minWidth: 120,
      textAlign: "center",
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    agendaGap: {
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 22,
      paddingVertical: 30,
    },
    rowTags: { color: colors.muted, fontFamily: fonts.regular },
    monthHeading: {
      fontFamily: fonts.display,
      fontSize: 16,
      color: colors.text,
      marginTop: 18,
      marginBottom: 4,
    },
    weekHeading: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: colors.muted,
      marginTop: 10,
      marginBottom: 6,
    },
    agendaBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 12,
    },
    fadingBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 40,
      paddingHorizontal: 12,
      marginBottom: 8,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    fadingBarOn: { backgroundColor: colors.soft },
    fadingText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
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
    newActions: { gap: 8 },
    newRow: { flexDirection: "row", gap: 8 },
    // The containers' gaps space these; the button's own margin would double it.
    newFull: { marginBottom: 0 },
    newHalf: { flex: 1, minWidth: 0, marginBottom: 0 },
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
      gap: 8,
      paddingTop: 16,
      paddingHorizontal: 16,
      paddingBottom: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    // The icons keep 44pt targets; the negative margin stops those targets
    // from padding the card's edge.
    rowActions: {
      flexDirection: "row",
      alignItems: "center",
      marginRight: -12,
    },
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
    trashNote: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    trashActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingBottom: 10,
    },
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

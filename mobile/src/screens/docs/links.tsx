import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  dateOptions,
  dateTitle,
  docObjectLinks,
  parseObjectHref,
  type DocBlock,
  type LinkedHere as LinkedHereEntry,
  type LinkedHereList,
  type LinkKind,
  type LinkOption,
  type LinkPill,
  type ObjectRef,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { openAppUrl } from "../../hooks/useAppLinks";
import { Icon, type IconName } from "../../components/Icon";
import { colors, fonts, radii, themed } from "../../theme";

/**
 * Links between things (LNK-01, LNK-02, LNK-05) on the phone: the pill a
 * picker link reads as, the picker (the toolbar's Link button, or [[ typed
 * in a line), and "Linked here". The same as the web, drawn for a thumb.
 */

/** Open a page, task, event or project in the app. */
export function openObject(ref: ObjectRef) {
  if (ref.kind === "person" || ref.kind === "date") return;
  const kind = ref.kind === "event" ? "task" : ref.kind;
  openAppUrl(`orbyn://${kind}/${ref.id}`);
}

const ICONS: Record<LinkKind, IconName> = {
  doc: "fileText",
  task: "squareCheck",
  event: "calendar",
  project: "folder",
  person: "users",
  date: "calendar",
};

const NOUNS: Record<LinkKind, string> = {
  doc: "page",
  task: "task",
  event: "event",
  project: "project",
  person: "person",
  date: "date",
};

/** One key for a thing, whether it was linked as a task or an event. */
export const pillKey = (r: ObjectRef) =>
  `${r.kind === "event" ? "task" : r.kind}:${r.id.toLowerCase()}`;

/** A deadline as a pill says it: "Fri" this week, "2 Oct" after. */
export function shortDue(iso: string, now = new Date()): string {
  const due = new Date(iso);
  const days = Math.round(
    (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7)
    return due.toLocaleDateString("en-GB", { weekday: "short" });
  return due.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ------------------------------------------------------------------ pills ---

type Pills = {
  pills: Map<string, LinkPill>;
  onToggle?: (id: string, done: boolean) => void;
  onRestore?: (id: string) => void;
};

const PillContext = createContext<Pills>({ pills: new Map() });

/** Gives the pills inside it their live titles and actions. */
export const LinkPillProvider = PillContext.Provider;

/** The pills for a page's links, as they stand now. */
export function useLinkPills(blocks: DocBlock[], report: (e: unknown) => void) {
  const refs = useMemo(() => {
    const seen = new Map<string, ObjectRef>();
    for (const l of docObjectLinks(blocks))
      if (l.ref.kind !== "date") seen.set(pillKey(l.ref), l.ref);
    return [...seen.values()];
  }, [blocks]);
  const key = refs.map(pillKey).sort().join(",");
  const [pills, setPills] = useState(() => new Map<string, LinkPill>());
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!refs.length) return;
    let live = true;
    const chunks: ObjectRef[][] = [];
    for (let i = 0; i < refs.length; i += 60)
      chunks.push(refs.slice(i, i + 60));
    Promise.all(chunks.map((c) => client.resolveLinks(c))).then((all) => {
      if (!live) return;
      setPills((was) => {
        const next = new Map(was);
        for (const p of all.flat()) next.set(pillKey(p), p);
        return next;
      });
    }, report);
    return () => {
      live = false;
    };
    // The set of links, not the array's identity, decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { pills, reload };
}

/**
 * A picker link in a line: its live title on a quiet ground; a task with
 * its tick (tap it) and deadline; "Deleted page" muted, with Restore.
 * Drawn as text inside the line's text, so it wraps with the words.
 */
export function LinkPillText({
  href,
  label,
  style,
}: {
  href: string;
  label: string;
  style?: object;
}) {
  const ref = parseObjectHref(href);
  const { pills, onToggle, onRestore } = useContext(PillContext);
  if (!ref) return null;
  const pill = pills.get(pillKey(ref));
  const noun = NOUNS[ref.kind];
  if (pill && pill.state !== "ok") {
    const deleted = pill.state === "deleted";
    return (
      <Text style={[style, s.pill, s.gone]}>
        {" "}
        {deleted
          ? `Deleted ${noun}`
          : `${noun[0].toUpperCase()}${noun.slice(1)} not found`}
        {deleted && pill.can_restore && onRestore ? (
          <Text
            style={s.restore}
            accessibilityRole="button"
            onPress={() => onRestore(ref.id)}
          >
            {"  Restore"}
          </Text>
        ) : null}{" "}
      </Text>
    );
  }
  const title =
    ref.kind === "date" ? dateTitle(ref.id) : (pill?.title ?? label);
  const isTask = ref.kind === "task" || ref.kind === "event";
  const done = !!pill?.done;
  const openable = ref.kind !== "person" && ref.kind !== "date";
  return (
    <Text
      style={[style, s.pill]}
      accessibilityRole={openable ? "link" : undefined}
      accessibilityLabel={openable ? `Open ${noun} ${title}` : undefined}
      onPress={openable ? () => openObject(ref) : undefined}
    >
      {" "}
      {ref.kind === "task" && pill ? (
        <Text
          style={[s.tick, done && s.tickDone]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? "Mark not done" : "Mark done"}
          onPress={onToggle ? () => onToggle(ref.id, !done) : undefined}
        >
          {done ? "✓ " : "○ "}
        </Text>
      ) : null}
      <Text style={done ? s.doneText : undefined}>{title}</Text>
      {isTask && pill?.due_at && !done ? (
        <Text style={s.due}>{` · ${shortDue(pill.due_at)}`}</Text>
      ) : null}{" "}
    </Text>
  );
}

// ----------------------------------------------------------------- picker ---

type Row =
  | { type: "option"; option: LinkOption }
  | { type: "create"; kind: "doc" | "task"; title: string }
  | { type: "url"; url: string };

const GROUPS: { kind: LinkKind; label: string }[] = [
  { kind: "doc", label: "Pages" },
  { kind: "task", label: "Tasks" },
  { kind: "event", label: "Events" },
  { kind: "project", label: "Projects" },
  { kind: "person", label: "People" },
  { kind: "date", label: "Dates" },
];

const WEB = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

/**
 * The link picker, over the keyboard: pages, tasks, events, projects,
 * people and dates together, grouped, with "Create page" and "Create task"
 * when nothing is called that. Opened from the toolbar it has its own
 * search box (and still links a web address typed into it); opened by [[
 * in a line, the words after the brackets are the search.
 */
export function LinkPickerPanel({
  query,
  projectName,
  onPick,
  onCreate,
  onUrl,
  onClose,
  report,
}: {
  /** The words after [[; left out to show a search box. */
  query?: string;
  projectName?: string | null;
  onPick: (ref: ObjectRef, title: string) => void;
  onCreate: (kind: "doc" | "task", title: string) => void;
  /** Link the chosen words to a web address; false when that can't be. */
  onUrl?: (url: string) => boolean;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [typed, setTyped] = useState("");
  const q = (query ?? typed).trim();
  const [found, setFound] = useState<LinkOption[]>([]);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      client.pickLinks(q, 12).then((hits) => live && setFound(hits), report);
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (query === undefined && onUrl && WEB.test(q) && !/\s/.test(q))
      out.push({ type: "url", url: q });
    const dates: LinkOption[] = dateOptions(q).map((d) => ({
      kind: "date",
      id: d.id,
      title: d.title,
      hint: d.hint,
    }));
    const all = [...found, ...dates];
    for (const g of GROUPS)
      for (const option of all.filter((o) => o.kind === g.kind))
        out.push({ type: "option", option });
    const same = all.some(
      (o) => o.title.trim().toLowerCase() === q.toLowerCase(),
    );
    if (q && !same && !out.some((r) => r.type === "url")) {
      out.push({ type: "create", kind: "task", title: q });
      out.push({ type: "create", kind: "doc", title: q });
    }
    return out;
  }, [found, q, query, onUrl]);

  const take = (row: Row) => {
    if (row.type === "url") {
      if (onUrl && !onUrl(row.url)) setBad(true);
    } else if (row.type === "create") onCreate(row.kind, row.title);
    else onPick(row.option, row.option.title);
  };

  let lastKind: string | null = null;
  return (
    <View style={s.picker} accessibilityLabel="Link to">
      <View style={s.pickerHead}>
        <Icon name="link" size={16} color={colors.muted} />
        {query === undefined ? (
          <TextInput
            style={s.search}
            value={typed}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Find a page, task, person or date"
            placeholderTextColor={colors.faint}
            returnKeyType="done"
            onChangeText={(v) => {
              setTyped(v);
              setBad(false);
            }}
            onSubmitEditing={() => rows[0] && take(rows[0])}
            accessibilityLabel="Find something to link"
          />
        ) : (
          <Text style={s.searchText} numberOfLines={1}>
            {q ? `Link “${q}”` : "Type to find something to link"}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          onPress={onClose}
        >
          <Icon name="x" size={16} color={colors.muted} />
        </Pressable>
      </View>
      {bad && (
        <Text style={s.error}>
          These words already have a style, so they can’t be a link too.
        </Text>
      )}
      <ScrollView
        style={s.rows}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={s.rowsInner}
      >
        {rows.map((row, i) => {
          const kind = row.type === "option" ? row.option.kind : row.type;
          const heading =
            kind !== lastKind && row.type === "option"
              ? GROUPS.find((g) => g.kind === kind)?.label
              : null;
          lastKind = kind;
          return (
            <View key={i}>
              {heading ? <Text style={s.group}>{heading}</Text> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => take(row)}
                style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              >
                {row.type === "option" ? (
                  <>
                    <Icon
                      name={ICONS[row.option.kind]}
                      size={16}
                      color={colors.muted}
                    />
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {row.option.title}
                      </Text>
                      {row.option.hint ? (
                        <Text style={s.rowHint} numberOfLines={1}>
                          {row.option.hint}
                        </Text>
                      ) : null}
                    </View>
                    {row.option.due_at && !row.option.done ? (
                      <Text style={s.due}>{shortDue(row.option.due_at)}</Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Icon
                      name={row.type === "url" ? "link" : "plus"}
                      size={16}
                      color={colors.accent}
                    />
                    <Text style={[s.rowTitle, s.create]} numberOfLines={1}>
                      {row.type === "url"
                        ? `Link to ${row.url}`
                        : row.kind === "doc"
                          ? `Create page “${row.title}”`
                          : projectName
                            ? `Create task “${row.title}” in ${projectName}`
                            : `Create task “${row.title}”`}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          );
        })}
        {!rows.length && (
          <Text style={s.empty}>
            {q
              ? "Nothing is called that."
              : "Type to find a page, task, project, person or date."}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------ linked here ---

const SOURCE_NOTES: Partial<Record<LinkedHereEntry["source"], string>> = {
  task_line: "This task came from here",
  meeting: "Meeting note",
  project: "In this project",
  dependency: "Waits for this",
  mention: "Mentioned in a comment",
};

/**
 * "Linked here": the pages and tasks that link to this page, task, event
 * or project, each with the line around the link. Places you can't open
 * are never listed or counted; hidden when nothing links here.
 */
export function LinkedHere({
  kind,
  id,
  onCount,
  report,
  onOpen,
}: {
  kind: "doc" | "task" | "event" | "project";
  id: string;
  onCount?: (n: number) => void;
  report: (e: unknown) => void;
  /** Before opening one (to put the current sheet away, say). */
  onOpen?: () => void;
}) {
  const [list, setList] = useState<LinkedHereList | null>(null);
  useEffect(() => {
    let live = true;
    client.linksHere(kind, id).then((l) => {
      if (!live) return;
      setList(l);
      onCount?.(l.count);
    }, report);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);
  if (!list || !list.count) return null;
  return (
    <View style={s.here} accessibilityLabel="Linked here">
      <Text style={s.hereTitle}>Linked here · {list.count}</Text>
      {list.items.map((e) => {
        const note = SOURCE_NOTES[e.source];
        const { before, linked, after } = e.context;
        return (
          <Pressable
            key={`${e.kind}:${e.id}`}
            accessibilityRole="button"
            onPress={() => {
              onOpen?.();
              openObject({ kind: e.kind, id: e.id });
            }}
            style={({ pressed }) => [s.hereRow, pressed && s.rowPressed]}
          >
            <Icon
              name={e.kind === "doc" ? "fileText" : "squareCheck"}
              size={16}
              color={colors.muted}
            />
            <View style={s.rowText}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {e.title}
              </Text>
              <Text style={s.rowHint} numberOfLines={1}>
                {[e.hint, note].filter(Boolean).join(" · ")}
              </Text>
              {before || linked || after ? (
                <Text style={s.context} numberOfLines={2}>
                  {before}
                  {linked ? (
                    <Text style={s.contextLinked}>{linked}</Text>
                  ) : null}
                  {after}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    pill: {
      backgroundColor: colors.surfaceMuted,
      color: colors.text,
      borderRadius: radii.pill,
    },
    gone: { color: colors.faint, fontStyle: "italic" },
    restore: { color: colors.accent, fontStyle: "normal" },
    tick: { color: colors.muted },
    tickDone: { color: colors.accent },
    doneText: { color: colors.muted, textDecorationLine: "line-through" },
    due: { color: colors.muted, fontSize: 13 },
    picker: {
      marginHorizontal: 8,
      marginBottom: 6,
      padding: 8,
      gap: 4,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    pickerHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 4,
      minHeight: 34,
    },
    search: {
      flex: 1,
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
    },
    searchText: {
      flex: 1,
      color: colors.muted,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
    error: {
      color: colors.danger,
      fontSize: 13,
      paddingHorizontal: 4,
    },
    rows: { maxHeight: 230 },
    rowsInner: { gap: 1 },
    group: {
      color: colors.muted,
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 2,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
      paddingHorizontal: 8,
      borderRadius: radii.input,
    },
    rowPressed: { backgroundColor: colors.accentSoft },
    rowText: { flex: 1, minWidth: 0, gap: 1 },
    rowTitle: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
    },
    rowHint: {
      color: colors.muted,
      fontFamily: fonts.regular,
      fontSize: 11,
    },
    create: { flex: 1, color: colors.accent },
    empty: {
      color: colors.muted,
      fontSize: 13,
      padding: 8,
    },
    here: { marginTop: 16, gap: 2 },
    hereTitle: {
      color: colors.muted,
      fontFamily: fonts.semibold,
      fontSize: 13,
      marginBottom: 4,
    },
    hereRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: radii.input,
    },
    context: {
      color: colors.textSoft,
      fontFamily: fonts.regular,
      fontSize: 13,
      marginTop: 2,
    },
    contextLinked: { color: colors.text, fontFamily: fonts.semibold },
  }),
);

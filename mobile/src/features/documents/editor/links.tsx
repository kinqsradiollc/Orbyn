import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../../motion";
import {
  dateOptions,
  dateTitle,
  docObjectLinks,
  parseObjectHref,
  refKey,
  splitHeadingQuery,
  type HeadingOption,
  type RelatedPage,
  type UnlinkedMention,
  type DocBlock,
  type LinkedHere as LinkedHereEntry,
  type LinkedHereList,
  type LinkKind,
  type LinkOption,
  type LinkPill,
  type ObjectRef,
} from "@orbyn/core";
import { client } from "../../../lib/api";
import { session } from "../../../lib/session";
import { tap } from "../../../lib/haptics";
import { openAppUrl } from "../../../hooks/useAppLinks";
import { DocNavigationContext } from "../library/doc-navigation";
import { CONCEPT_ICON, Icon, type IconName } from "../../../components/Icon";
import { inputFontSize, colors, fonts, radii, themed } from "../../../theme";

/**
 * Links between things (LNK-01, LNK-02, LNK-05) on the phone: the pill a
 * picker link reads as, the picker (the toolbar's Link button, or [[ typed
 * in a line), and "Linked here". The same as the web, drawn for a thumb.
 */

/** Open a page (at a line), task, event or project in the app. */
export function openObject(
  ref: ObjectRef,
  block?: string | null,
  onAppLink: (url: string) => void = openAppUrl,
) {
  if (ref.kind === "person" || ref.kind === "date") return;
  const kind = ref.kind === "event" ? "task" : ref.kind;
  const line = block ?? ref.block;
  onAppLink(
    `orbyn://${kind}/${ref.id}${kind === "doc" && line ? `#${line}` : ""}`,
  );
}

const ICONS: Record<LinkKind, IconName> = {
  doc: CONCEPT_ICON.page,
  task: CONCEPT_ICON.task,
  event: CONCEPT_ICON.event,
  project: CONCEPT_ICON.project,
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

/**
 * One key for a thing, whether it was linked as a task or an event; a link
 * to one line of a page has its own (it shows that line's words).
 */
export const pillKey = refKey;

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
  /** A long press on a pill: its card, as a half sheet (LNK-07). */
  onCard?: (ref: ObjectRef) => void;
};

const PillContext = createContext<Pills>({ pills: new Map() });

/** Gives the pills inside it their live titles and actions. */
export const LinkPillProvider = PillContext.Provider;

/** The page's pills and actions, for blocks inside it that tick tasks. */
export const usePagePills = () => useContext(PillContext);

/** The pills for a page's links, as they stand now. */
export function useLinkPills(blocks: DocBlock[], report: (e: unknown) => void) {
  const refs = useMemo(() => {
    const seen = new Map<string, ObjectRef>();
    for (const l of docObjectLinks(blocks))
      if (l.ref.kind !== "date") seen.set(pillKey(l.ref), l.ref);
    return [...seen.values()];
  }, [blocks]);
  const key = refs.map(pillKey).sort().join(",");
  const owner = session.token;
  const [resolved, setResolved] = useState<{
    owner: string;
    key: string;
    pills: Map<string, LinkPill>;
  } | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!refs.length) return;
    let live = true;
    const current = () => live && session.token === owner;
    const chunks: ObjectRef[][] = [];
    for (let i = 0; i < refs.length; i += 60)
      chunks.push(refs.slice(i, i + 60));
    Promise.all(chunks.map((c) => client.resolveLinks(c))).then(
      (all) => {
        if (!current()) return;
        setResolved({
          owner,
          key,
          pills: new Map(all.flat().map((pill) => [pillKey(pill), pill])),
        });
      },
      (error) => {
        if (current()) report(error);
      },
    );
    return () => {
      live = false;
    };
    // The set of links, not the array's identity, decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, owner, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  const pills =
    resolved?.owner === owner && resolved.key === key
      ? resolved.pills
      : new Map<string, LinkPill>();
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
  hint,
}: {
  href: string;
  label: string;
  style?: object;
  hint?: string;
}) {
  const ref = parseObjectHref(href);
  const { pills, onToggle, onRestore, onCard } = useContext(PillContext);
  const navigation = useContext(DocNavigationContext);
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
  // A page merged into another opens the page it went into.
  const target: ObjectRef = pill?.moved_to
    ? {
        kind: "doc",
        id: pill.moved_to,
        ...(ref.block ? { block: ref.block } : {}),
      }
    : ref;
  return (
    <Text
      style={[style, s.pill]}
      accessibilityRole={openable ? "link" : undefined}
      accessibilityLabel={openable ? `Open ${noun} ${title}` : undefined}
      accessibilityHint={
        hint !== undefined && pill?.state === "ok"
          ? hint
          : openable && onCard
            ? "Touch and hold for more"
            : undefined
      }
      onPress={
        openable
          ? () => openObject(target, undefined, navigation?.onAppLink)
          : undefined
      }
      onLongPress={
        openable && onCard
          ? () => {
              tap();
              onCard(target);
            }
          : undefined
      }
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
      {ref.block && pill ? (
        <Text style={s.line}>{` › ${pill.block_title ?? "line gone"}`}</Text>
      ) : null}
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
  | { type: "url"; url: string }
  /** `[[Page#`: one of the page's headings or lines (LNK-04). */
  | { type: "heading"; doc: LinkOption; heading: HeadingOption };

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
  const owner = session.token;
  const requestKey = `${owner}:${q}`;
  const latestKey = useRef(requestKey);
  latestKey.current = requestKey;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [result, setResult] = useState<{
    key: string;
    found: LinkOption[];
    lines: { doc: LinkOption; headings: HeadingOption[] } | null;
  } | null>(null);
  const [bad, setBad] = useState(false);
  const [searchFailure, setSearchFailure] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [retry, setRetry] = useState(0);
  const [anchoring, setAnchoring] = useState(false);
  const pending = useRef(false);
  const wantsLine = splitHeadingQuery(query ?? typed);
  const ready = result?.key === requestKey;
  const found = ready ? result.found : [];
  const lines = ready ? result.lines : null;
  const failed = searchFailure === requestKey;
  useEffect(() => {
    let live = true;
    const current = () =>
      live && session.token === owner && latestKey.current === requestKey;
    setSearchFailure(null);
    setSelectionError("");
    const t = setTimeout(() => {
      void (async () => {
        try {
          if (wantsLine) {
            const hits = await client.pickLinks(wantsLine.page, 5);
            if (!current()) return;
            const doc = hits.find((h) => h.kind === "doc");
            const headings = doc
              ? await client.pageHeadings(doc.id, wantsLine.heading.trim())
              : [];
            if (current())
              setResult({
                key: requestKey,
                found: [],
                lines: doc ? { doc, headings } : null,
              });
          } else {
            const hits = await client.pickLinks(q, 12);
            if (current())
              setResult({ key: requestKey, found: hits, lines: null });
          }
        } catch (error) {
          if (current()) {
            setSearchFailure(requestKey);
            report(error);
          }
        }
      })();
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, retry]);
  const rows = useMemo<Row[]>(() => {
    if (!ready || failed) return [];
    if (wantsLine)
      return lines
        ? [
            { type: "option", option: lines.doc },
            ...lines.headings.map((heading): Row => ({
              type: "heading",
              doc: lines.doc,
              heading,
            })),
          ]
        : [];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, q, query, onUrl, lines, ready, failed]);

  const take = (row: Row) => {
    if (pending.current || !ready || failed) return;
    setSelectionError("");
    if (row.type === "url") {
      if (onUrl && !onUrl(row.url)) setBad(true);
    } else if (row.type === "create") onCreate(row.kind, row.title);
    else if (row.type === "heading") {
      const { doc, heading } = row;
      pending.current = true;
      setAnchoring(true);
      const current = () =>
        alive.current &&
        session.token === owner &&
        latestKey.current === requestKey;
      void (async () => {
        try {
          const block =
            heading.block_id ??
            (await client.anchorLine(doc.id, heading.index, heading.text))
              .block_id;
          if (current()) onPick({ kind: "doc", id: doc.id, block }, doc.title);
        } catch (error) {
          if (current()) {
            setSelectionError("Couldn't link this line. Try again.");
            report(error);
          }
        } finally {
          pending.current = false;
          if (alive.current) setAnchoring(false);
        }
      })();
    } else onPick(row.option, row.option.title);
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
            editable={!anchoring}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Search links"
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
          <Text style={s.searchText}>
            {q ? `Link “${q}”` : "Type to find something to link"}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={s.close}
          onPress={onClose}
        >
          <Icon name="x" size={16} color={colors.muted} />
        </Pressable>
      </View>
      {bad && (
        <Text style={s.error}>Remove the text style before adding a link.</Text>
      )}
      {selectionError ? <Text style={s.error}>{selectionError}</Text> : null}
      {failed ? (
        <View style={s.feedback}>
          <Text style={s.error}>Couldn’t load links.</Text>
          <Pressable
            accessibilityRole="button"
            style={s.linkButton}
            onPress={() => setRetry((n) => n + 1)}
          >
            <Text style={s.linkButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
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
              : kind !== lastKind && row.type === "heading"
                ? "Headings and lines"
                : null;
          lastKind = kind;
          return (
            <View key={i}>
              {heading ? <Text style={s.group}>{heading}</Text> : null}
              <Pressable
                accessibilityRole="button"
                disabled={anchoring}
                onPress={() => take(row)}
                style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              >
                {row.type === "heading" ? (
                  <>
                    <Icon name="hash" size={16} color={colors.muted} />
                    <View
                      style={[
                        s.rowText,
                        {
                          paddingLeft: row.heading.level
                            ? (row.heading.level - 1) * 12
                            : 0,
                        },
                      ]}
                    >
                      <Text style={s.rowTitle}>{row.heading.text}</Text>
                      {!row.heading.level && (
                        <Text style={s.rowHint}>A line</Text>
                      )}
                    </View>
                  </>
                ) : row.type === "option" ? (
                  <>
                    <Icon
                      name={ICONS[row.option.kind]}
                      size={16}
                      color={colors.muted}
                    />
                    <View style={s.rowText}>
                      <Text style={s.rowTitle}>{row.option.title}</Text>
                      {row.option.hint ? (
                        <Text style={s.rowHint}>{row.option.hint}</Text>
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
                    <Text style={[s.rowTitle, s.create]}>
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
        {!rows.length && !failed && (
          <Text style={s.empty}>
            {!ready
              ? "Loading links…"
              : q
                ? "No matches"
                : "Search pages, tasks and people."}
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
 * are never listed or counted. Under it, for a page or a project, the
 * pages that say its name without linking to it, each with Link, and for a
 * page, the pages that read like it (LNK-06). Hidden when there's none.
 */
function LinkedHereBody({
  kind,
  id,
  onCount,
  report,
  onOpen,
  onLinkRelated,
}: {
  kind: "doc" | "task" | "event" | "project";
  id: string;
  onCount?: (n: number) => void;
  report: (e: unknown) => void;
  /** Before opening one (to put the current sheet away, say). */
  onOpen?: () => void;
  /** Link a related page from this one; left out where that can't be. */
  onLinkRelated?: (page: RelatedPage) => void;
}) {
  const owner = session.token;
  const alive = useRef(true);
  const pending = useRef(false);
  const [linking, setLinking] = useState(false);
  const [failure, setFailure] = useState("");
  const [list, setList] = useState<LinkedHereList | null>(null);
  const [mentions, setMentions] = useState<UnlinkedMention[]>([]);
  const [related, setRelated] = useState<RelatedPage[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    const current = () => live && session.token === owner;
    const fail = (error: unknown) => {
      if (!current()) return;
      setFailure("Couldn't load references. Try again.");
      report(error);
    };
    setFailure("");
    client.linksHere(kind, id).then((l) => {
      if (!current()) return;
      setList(l);
      onCount?.(l.count);
    }, fail);
    if (kind === "doc" || kind === "project")
      client.unlinkedMentions(kind, id).then((m) => {
        if (current()) setMentions(m);
      }, fail);
    if (kind === "doc")
      client.relatedPages(id).then((r) => {
        if (current()) setRelated(r);
      }, fail);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, owner, round]);
  const link = (m: UnlinkedMention) => {
    if (
      !m.block_id ||
      (kind !== "doc" && kind !== "project") ||
      pending.current
    )
      return;
    pending.current = true;
    setLinking(true);
    setFailure("");
    const current = () => alive.current && session.token === owner;
    void client
      .linkMention({
        doc_id: m.doc_id,
        block_id: m.block_id,
        matched: m.matched,
        target: { kind, id },
      })
      .then(
        () => {
          if (current()) setRound((n) => n + 1);
        },
        (error) => {
          if (current()) {
            setFailure("Couldn't link this mention. Try again.");
            report(error);
          }
        },
      )
      .finally(() => {
        pending.current = false;
        if (current()) setLinking(false);
      });
  };
  if (!list && !failure) return null;
  if (list && !list.count && !mentions.length && !related.length && !failure)
    return null;
  return (
    <View style={s.here} accessibilityLabel="Linked here">
      {failure ? (
        <View style={s.feedback}>
          <Text style={s.error}>{failure}</Text>
          <Pressable
            accessibilityRole="button"
            style={s.linkButton}
            disabled={linking}
            onPress={() => setRound((n) => n + 1)}
          >
            <Text style={s.linkButtonText}>Refresh</Text>
          </Pressable>
        </View>
      ) : null}
      {list && list.count > 0 && (
        <>
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
                  openObject({ kind: e.kind, id: e.id }, e.block_id);
                }}
                style={({ pressed }) => [s.hereRow, pressed && s.rowPressed]}
              >
                <Icon
                  name={e.kind === "doc" ? "fileText" : "squareCheck"}
                  size={16}
                  color={colors.muted}
                />
                <View style={s.rowText}>
                  <Text style={s.rowTitle}>{e.title}</Text>
                  <Text style={s.rowHint}>
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
        </>
      )}
      {mentions.length > 0 && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showMentions }}
            onPress={() => setShowMentions((v) => !v)}
            style={s.moreToggle}
          >
            <Icon
              name={showMentions ? "chevronDown" : "chevronRight"}
              size={14}
              color={colors.muted}
            />
            <Text style={s.hereTitle}>
              Mentioned without a link ({mentions.length})
            </Text>
          </Pressable>
          {showMentions &&
            mentions.map((m) => (
              <View key={m.doc_id} style={s.mentionRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onOpen?.();
                    openObject({ kind: "doc", id: m.doc_id }, m.block_id);
                  }}
                  style={({ pressed }) => [
                    s.hereRow,
                    s.mentionMain,
                    pressed && s.rowPressed,
                  ]}
                >
                  <Icon name="fileText" size={16} color={colors.muted} />
                  <View style={s.rowText}>
                    <Text style={s.rowTitle}>{m.title}</Text>
                    <Text style={s.context} numberOfLines={2}>
                      {m.context.before}
                      <Text style={s.contextLinked}>{m.context.linked}</Text>
                      {m.context.after}
                    </Text>
                  </View>
                </Pressable>
                {m.can_link && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Link “${m.matched}” in ${m.title}`}
                    disabled={linking}
                    onPress={() => link(m)}
                    style={({ pressed }) => [
                      s.linkButton,
                      pressed && s.rowPressed,
                    ]}
                  >
                    <Icon name="link" size={14} color={colors.accent} />
                    <Text style={s.linkButtonText}>Link</Text>
                  </Pressable>
                )}
              </View>
            ))}
        </>
      )}
      {related.length > 0 && (
        <>
          <Text style={[s.hereTitle, s.relatedTitle]}>Related</Text>
          {related.map((r) => (
            <View key={r.doc_id} style={s.mentionRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onOpen?.();
                  openObject({ kind: "doc", id: r.doc_id });
                }}
                style={({ pressed }) => [
                  s.hereRow,
                  s.mentionMain,
                  pressed && s.rowPressed,
                ]}
              >
                <Icon name="fileText" size={16} color={colors.muted} />
                <View style={s.rowText}>
                  <Text style={s.rowTitle}>{r.title}</Text>
                  <Text style={s.rowHint}>
                    {[r.hint, r.reason].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </Pressable>
              {onLinkRelated && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Link ${r.title} from this page`}
                  onPress={() => {
                    onLinkRelated(r);
                    setRelated((all) =>
                      all.filter((x) => x.doc_id !== r.doc_id),
                    );
                  }}
                  style={({ pressed }) => [
                    s.linkButton,
                    pressed && s.rowPressed,
                  ]}
                >
                  <Icon name="link" size={14} color={colors.accent} />
                  <Text style={s.linkButtonText}>Link</Text>
                </Pressable>
              )}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** Reset reference state when the page or signed-in account changes. */
export function LinkedHere(props: React.ComponentProps<typeof LinkedHereBody>) {
  return (
    <LinkedHereBody
      key={`${session.token}:${props.kind}:${props.id}`}
      {...props}
    />
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
    line: { color: colors.muted },
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
      minHeight: 44,
    },
    close: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    feedback: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    search: {
      flex: 1,
      minWidth: 0,
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
    },
    searchText: {
      flex: 1,
      minWidth: 0,
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
      fontSize: 13,
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 2,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
      minHeight: 44,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: radii.input,
    },
    rowPressed: { backgroundColor: colors.accentSoft },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
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
      minHeight: 44,
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
    moreToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 44,
      marginTop: 8,
    },
    relatedTitle: { marginTop: 12 },
    mentionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
    },
    mentionMain: { flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0 },
    linkButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 44,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    linkButtonText: {
      color: colors.accent,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
  }),
);

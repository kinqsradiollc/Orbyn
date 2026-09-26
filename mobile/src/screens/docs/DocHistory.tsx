import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  changeAuthors,
  diffBlocks,
  diffCounts,
  listLayout,
  mathToText,
  restoreLine,
  type Doc,
  type DocBlock,
  type DocDiffLine,
  type DocVersion,
  type Sitting,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { showToast } from "../../components/Toast";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { DocBody } from "./DocBody";
import { Inline } from "./Inline";

const when = (iso: string) => {
  const date = new Date(iso);
  const today = date.toDateString() === new Date().toDateString();
  return today
    ? `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

/** "Anna Lee" as "AL", for the badge beside a change. */
const initials = (name: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Unchanged lines kept around each change when the rest fold away. */
const CONTEXT = 1;

type Compare = "none" | "current" | "previous";

/**
 * The page as it was, on the phone. Folded away until asked for, since most
 * visits to a page are to read or write it, not to look back. Each entry is
 * a sitting. Choosing one shows what has changed since — or what that
 * sitting changed — with added lines tinted and removed ones struck
 * through; a removed line can be put back on its own, and Restore puts the
 * whole version back as a new version on top, so nothing is thrown away.
 */
export function DocHistory({
  doc,
  onRestored,
  canWrite = true,
  openKey = 0,
  report,
}: {
  doc: Doc;
  canWrite?: boolean;
  /** Changed to open the history from elsewhere (the page's ⋯ or Info). */
  openKey?: number;
  onRestored: (doc: Doc) => void;
  report: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openKey) setOpen(true);
  }, [openKey]);
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [chosen, setChosen] = useState<Required<DocVersion> | null>(null);
  const [older, setOlder] = useState<Required<DocVersion> | null>(null);
  /** The chosen version and every one kept since, oldest first. */
  const [sittings, setSittings] = useState<Sitting[] | null>(null);
  const [compare, setCompare] = useState<Compare>("current");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChosen(null);
    client.listDocVersions(doc.id).then(setVersions, (e) => {
      setVersions([]);
      report(e);
    });
    // doc.version moves with every save; the list is read again when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc.id, report]);

  const pick = (v: DocVersion) => {
    setBusy(true);
    // One read brings the version, the one before it and the ones since.
    client
      .getDocVersionChanges(doc.id, v.version)
      .then(({ version, older: prior, sittings: since }) => {
        setChosen(version);
        setOlder(prior);
        setSittings(since);
        if (compare === "previous" && !prior) setCompare("current");
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  const restore = () => {
    if (!chosen || !canWrite) return;
    const go = () => {
      setBusy(true);
      client
        .restoreDocVersion(doc.id, chosen.version)
        .then((restored) => {
          onRestored(restored);
          setChosen(null);
        })
        .catch(report)
        .finally(() => setBusy(false));
    };
    const question = `Put the page back as it was at ${when(chosen.created_at)}? What is there now is kept in history.`;
    // Alert.alert does nothing in the web build, so the browser asks instead.
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(question)) go();
      return;
    }
    Alert.alert("Put this version back?", question, [
      { text: "Cancel", style: "cancel" },
      { text: "Restore", onPress: go },
    ]);
  };

  /**
   * Put one line back on the page as it is now, saved at once. A save that
   * crossed with this one is read again and the line put into that.
   */
  const putBack = (source: DocBlock[], index: number) => {
    setBusy(true);
    const save = (page: Doc) =>
      client.updateDoc(doc.id, {
        content: restoreLine(page.content, source, index),
        version: page.version,
      });
    save(doc)
      .catch((e: { statusCode?: number }) =>
        e.statusCode === 409
          ? client.getDoc(doc.id).then(save)
          : Promise.reject(e),
      )
      .then((saved) => {
        onRestored(saved);
        showToast({ text: "Line restored" });
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <Text style={styles.title}>History</Text>
        <Text style={styles.toggle}>{open ? "Hide" : "Show"}</Text>
      </Pressable>

      {open &&
        (versions === null ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : versions.length === 0 ? (
          <Text style={styles.empty}>
            Nothing to go back to yet. Each time you sit down and change the
            page, the version you started from is kept here.
          </Text>
        ) : (
          <View style={styles.list}>
            {versions.map((v) => (
              <Pressable
                key={v.version}
                disabled={busy || !canWrite}
                onPress={() => pick(v)}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen?.version === v.version }}
                style={({ pressed }) => [
                  styles.item,
                  chosen?.version === v.version && styles.itemChosen,
                  pressed && styles.itemPressed,
                ]}
              >
                <Text style={styles.itemWhen}>{when(v.created_at)}</Text>
                <View style={styles.itemMetaRow}>
                  <Text style={styles.initials}>{initials(v.author)}</Text>
                  <Text style={styles.itemMeta}>
                    {v.author ?? "Someone"}
                    {v.via_agent ? ` via ${v.via_agent}` : ""} · {v.blocks}{" "}
                    {v.blocks === 1 ? "block" : "blocks"}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ))}

      {open && chosen && (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>
            As it was at {when(chosen.created_at)}
          </Text>
          <ChipRow label="Compare with">
            <Chip
              compact
              label="Current page"
              selected={compare === "current"}
              onPress={() => setCompare("current")}
            />
            <Chip
              compact
              label="Previous version"
              selected={compare === "previous"}
              disabled={!older}
              onPress={() => setCompare("previous")}
            />
            <Chip
              compact
              label="As it was"
              selected={compare === "none"}
              onPress={() => setCompare("none")}
            />
          </ChipRow>
          <Text style={styles.previewTitle}>{chosen.title || "Untitled"}</Text>
          {compare === "none" ? (
            <DocBody content={chosen.content} />
          ) : (
            <Changes
              before={
                compare === "previous" && older ? older.content : chosen.content
              }
              after={
                compare === "previous" && older ? chosen.content : doc.content
              }
              by={compare === "previous" && older ? older.author : null}
              sittings={compare === "previous" && older ? undefined : sittings}
              sitting={compare === "previous"}
              canRestore={canWrite && !busy}
              onRestoreLine={putBack}
            />
          )}
          <Button
            title="Restore this version"
            secondary
            disabled={busy || !canWrite}
            onPress={restore}
          />
        </View>
      )}
    </View>
  );
}

/**
 * "Show changes" on the phone: added lines on a soft accent tint, removed
 * lines struck through on a soft danger tint, long unchanged stretches
 * folded away, and "Restore this line" under each removed line.
 */
function Changes({
  before,
  after,
  by,
  sittings,
  sitting,
  canRestore,
  onRestoreLine,
}: {
  before: DocBlock[];
  after: DocBlock[];
  /** Who made the changes, when they are one sitting's. */
  by: string | null;
  /**
   * Every sitting since `before`, oldest first, to tell who made each
   * change (null when there were too many); left out for one sitting.
   */
  sittings?: Sitting[] | null;
  sitting: boolean;
  canRestore: boolean;
  onRestoreLine: (source: DocBlock[], index: number) => void;
}) {
  const lines = useMemo(() => diffBlocks(before, after), [before, after]);
  const counts = diffCounts(lines);
  const authors = useMemo(
    () =>
      sittings === undefined
        ? lines.map((l) => (l.change === "same" ? null : by))
        : sittings
          ? changeAuthors(lines, sittings)
          : null,
    [lines, by, sittings],
  );
  const layoutBefore = useMemo(() => listLayout(before), [before]);
  const layoutAfter = useMemo(() => listLayout(after), [after]);
  const [unfolded, setUnfolded] = useState(false);
  const near = new Set<number>();
  lines.forEach((l, i) => {
    if (l.change !== "same")
      for (let j = i - CONTEXT; j <= i + CONTEXT; j++) near.add(j);
  });
  const nothing = counts.added + counts.removed + counts.edited === 0;
  const hidden = lines.filter(
    (l, i) => l.change === "same" && !near.has(i),
  ).length;

  return (
    <View style={styles.changes}>
      <Text style={styles.summary}>
        {nothing
          ? sitting
            ? "Nothing changed in this sitting."
            : "The page is the same as it was then."
          : [
              counts.added && `${counts.added} added`,
              counts.removed && `${counts.removed} removed`,
              counts.edited && `${counts.edited} rewritten`,
            ]
              .filter(Boolean)
              .join(" · ")}
        {!nothing &&
          !authors &&
          " · made over too many sittings to say who changed each line"}
      </Text>
      {lines.map((line, i) =>
        line.change === "same" && !near.has(i) && !unfolded ? null : (
          <DiffRow
            key={`${line.change}-${i}`}
            line={line}
            layout={
              line.change === "removed"
                ? layoutBefore[line.index]
                : layoutAfter[line.index]
            }
            by={authors?.[i] ?? null}
            onRestore={
              line.change === "removed" && canRestore
                ? () => onRestoreLine(before, line.index)
                : undefined
            }
          />
        ),
      )}
      {hidden > 0 && !unfolded && (
        <SmallAction
          label={`Show ${hidden} unchanged ${hidden === 1 ? "line" : "lines"}`}
          disabled={false}
          onPress={() => setUnfolded(true)}
        />
      )}
    </View>
  );
}

/** One line of a comparison, drawn the way the page draws it. */
function DiffRow({
  line,
  layout,
  by,
  onRestore,
}: {
  line: DocDiffLine;
  layout: { depth: number; number: number | null };
  /** Who made this change, when it is known. */
  by: string | null;
  onRestore?: () => void;
}) {
  const b = line.block;
  const marker =
    b.type === "bullet"
      ? "•"
      : b.type === "numbered"
        ? `${layout.number ?? 1}.`
        : b.type === "todo"
          ? b.done
            ? "☑"
            : "☐"
          : null;
  const removed = line.change === "removed";
  const body =
    b.type === "divider" ? (
      <View style={styles.rule} />
    ) : (
      <Text
        style={[
          styles.lineText,
          b.type === "heading" && styles.lineHeading,
          (b.type === "code" || b.type === "quote") && styles.lineQuiet,
          removed && styles.lineRemoved,
        ]}
      >
        {b.type === "math" ? (
          mathToText(b.text)
        ) : b.type === "code" ? (
          b.text
        ) : (
          <Inline text={b.text} />
        )}
      </Text>
    );
  return (
    <View
      style={[
        styles.diffLine,
        line.change === "added" && styles.added,
        removed && styles.removed,
      ]}
      accessibilityLabel={
        line.change === "added"
          ? "Added line"
          : removed
            ? "Removed line"
            : undefined
      }
    >
      <View style={[styles.diffMain, { marginLeft: layout.depth * 20 }]}>
        {line.change !== "same" && (
          <Text style={styles.sign}>{line.change === "added" ? "+" : "−"}</Text>
        )}
        {marker && (
          <Text style={[styles.marker, removed && styles.lineRemoved]}>
            {marker}
          </Text>
        )}
        <View style={styles.diffBody}>{body}</View>
        {by && <Text style={styles.initials}>{initials(by)}</Text>}
      </View>
      {onRestore && (
        <Pressable
          accessibilityRole="button"
          onPress={onRestore}
          hitSlop={8}
          style={({ pressed }) => [
            styles.restore,
            pressed && styles.itemPressed,
          ]}
        >
          <Text style={styles.restoreText}>Restore this line</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    section: {
      gap: 10,
      marginTop: 18,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 44,
    },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    toggle: { color: colors.accent, fontSize: 13, fontFamily: fonts.semibold },
    list: { gap: 4 },
    item: {
      gap: 2,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    itemChosen: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accentSoft,
    },
    itemPressed: { backgroundColor: colors.surfaceMuted },
    itemWhen: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    itemMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    itemMeta: { color: colors.muted, fontSize: 13 },
    initials: {
      minWidth: 22,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radii.pill,
      overflow: "hidden",
      backgroundColor: colors.soft,
      color: colors.textSoft,
      fontSize: 11,
      fontFamily: fonts.semibold,
      textAlign: "center",
    },
    preview: {
      gap: 10,
      padding: 12,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
    },
    previewLabel: { color: colors.muted, fontSize: 13 },
    previewTitle: {
      color: colors.text,
      fontSize: 18,
      fontFamily: fonts.display,
    },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    changes: { gap: 4 },
    summary: { color: colors.muted, fontSize: 13, marginBottom: 2 },
    diffLine: {
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: radii.input,
    },
    added: { backgroundColor: colors.accentSoft },
    removed: { backgroundColor: colors.dangerSoft },
    diffMain: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
    diffBody: { flex: 1, minWidth: 0 },
    sign: {
      width: 12,
      color: colors.muted,
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
    },
    marker: { color: colors.muted, fontSize: 15, lineHeight: 22 },
    lineText: { color: colors.text, fontSize: 15, lineHeight: 22 },
    lineHeading: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
    lineQuiet: { color: colors.textSoft },
    lineRemoved: {
      color: colors.muted,
      textDecorationLine: "line-through",
    },
    rule: { height: 1, marginVertical: 10, backgroundColor: colors.border },
    restore: {
      alignSelf: "flex-start",
      marginLeft: 18,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radii.input,
    },
    restoreText: {
      color: colors.accent,
      fontSize: 13,
      fontFamily: fonts.semibold,
    },
  }),
);

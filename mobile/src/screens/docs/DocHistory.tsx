import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "../../components/BottomSheet";
import { session } from "../../lib/session";
import { Pressable } from "../../motion";
import {
  changeAuthors,
  diffBlocks,
  diffCounts,
  docContainerBlocks,
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
import { DocContainerBody } from "./DocContainerBody";
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
export function DocHistory(props: DocHistoryProps) {
  return <DocHistoryBody key={`${session.token}:${props.doc.id}`} {...props} />;
}

type DocHistoryProps = {
  doc: Doc;
  canWrite?: boolean;
  openKey?: number;
  showEntry?: boolean;
  onRestored: (doc: Doc) => void;
  beforeRestore: () => Promise<boolean>;
  onRestoreEnd: () => void;
  report: (e: unknown) => void;
};

function DocHistoryBody({
  doc,
  onRestored,
  canWrite = true,
  openKey = 0,
  showEntry = true,
  report,
  beforeRestore,
  onRestoreEnd,
}: DocHistoryProps) {
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

  const owner = session.token;
  const alive = useRef(true);
  const pending = useRef(false);
  const latest = useRef({
    doc,
    canWrite,
    onRestored,
    beforeRestore,
    onRestoreEnd,
  });
  latest.current = { doc, canWrite, onRestored, beforeRestore, onRestoreEnd };
  const current = () => alive.current && session.token === owner;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setVersions(null);
    setFailed(false);
    setChosen(null);
    client.listDocVersions(doc.id).then(
      (rows) => {
        if (active && current()) setVersions(rows);
      },
      () => {
        if (active && current()) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [open, doc.id, owner, retry]);

  const pick = async (v: DocVersion) => {
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    try {
      const [{ older: prior, sittings: since }, version] = await Promise.all([
        client.getDocVersionChanges(doc.id, v.version),
        client.getDocVersion(doc.id, v.version),
      ]);
      if (!current()) return;
      setChosen(version);
      setOlder(prior);
      setSittings(since);
      setCompare((value) =>
        value === "previous" && !prior ? "current" : value,
      );
    } catch (e) {
      if (current()) report(e);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };

  const restore = async () => {
    if (!chosen || !latest.current.canWrite || pending.current || !current())
      return;
    pending.current = true;
    setBusy(true);
    setRestoreFailed(false);
    let prepared = false;
    try {
      prepared = await latest.current.beforeRestore();
      if (!prepared || !current() || !latest.current.canWrite) return;
      const restored = await client.restoreDocVersion(doc.id, chosen.version);
      if (!current()) return;
      latest.current.onRestored(restored);
      setChosen(null);
      setRestoreOpen(false);
      setRetry((value) => value + 1);
    } catch {
      if (current()) setRestoreFailed(true);
    } finally {
      if (prepared) latest.current.onRestoreEnd();
      pending.current = false;
      if (current()) setBusy(false);
    }
  };

  const putBack = async (source: DocBlock[], index: number) => {
    if (pending.current || !current() || !latest.current.canWrite) return;
    pending.current = true;
    setBusy(true);
    let prepared = false;
    const save = (page: Doc) => {
      if (!current() || !latest.current.canWrite)
        throw new Error("Page is no longer editable");
      return client.updateDoc(doc.id, {
        content: restoreLine(page.content, source, index),
        version: page.version,
      });
    };
    try {
      prepared = await latest.current.beforeRestore();
      if (!prepared || !current() || !latest.current.canWrite) return;
      const saved = await save(latest.current.doc).catch(
        (e: { statusCode?: number }) =>
          e.statusCode === 409
            ? client.getDoc(doc.id).then(save)
            : Promise.reject(e),
      );
      if (!current()) return;
      latest.current.onRestored(saved);
      showToast({ text: "Line restored" });
      setRetry((value) => value + 1);
    } catch (e) {
      if (current()) report(e);
    } finally {
      if (prepared) latest.current.onRestoreEnd();
      pending.current = false;
      if (current()) setBusy(false);
    }
  };

  const beforePage = compare === "previous" && older ? older : chosen;
  const afterPage = compare === "previous" && older ? chosen : doc;
  const structuredComparison =
    beforePage?.document?.format === 2 || afterPage?.document?.format === 2;
  const historyBlocks = (page: Doc | Required<DocVersion>) =>
    page.document?.format === 2
      ? docContainerBlocks(page.document.nodes, { projected: true })
      : page.content;

  return (
    <View style={showEntry ? styles.section : undefined}>
      {showEntry && (
        <Pressable
          disabled={busy}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          style={styles.head}
        >
          <Text style={styles.title}>History</Text>
          <Text style={styles.toggle}>View</Text>
        </Pressable>
      )}

      <BottomSheet
        visible={open && !restoreOpen}
        title="Page history"
        footer={
          chosen ? (
            <Button
              title="Restore this version"
              secondary
              disabled={busy || !canWrite}
              onPress={() => {
                setRestoreFailed(false);
                setRestoreOpen(true);
              }}
            />
          ) : undefined
        }
        closeDisabled={busy}
        onClose={() => {
          if (!pending.current) setOpen(false);
        }}
      >
        {chosen ? (
          <SmallAction
            label="Back to versions"
            disabled={busy}
            onPress={() => setChosen(null)}
          />
        ) : failed ? (
          <View style={styles.list}>
            <Text style={styles.empty}>Couldn't load history.</Text>
            <SmallAction
              label="Retry"
              disabled={busy}
              onPress={() => setRetry((n) => n + 1)}
            />
          </View>
        ) : versions === null ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : versions.length === 0 ? (
          <Text style={styles.empty}>No earlier versions yet.</Text>
        ) : (
          <View style={styles.list}>
            {versions.map((v) => (
              <Pressable
                key={v.version}
                disabled={busy}
                onPress={() => void pick(v)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.item,
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
        )}

        {busy && !restoreOpen && <Text style={styles.empty}>Loading…</Text>}
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
                disabled={busy}
                onPress={() => setCompare("current")}
              />
              <Chip
                compact
                label="Previous version"
                selected={compare === "previous"}
                disabled={busy || !older}
                onPress={() => setCompare("previous")}
              />
              <Chip
                compact
                label="As it was"
                selected={compare === "none"}
                disabled={busy}
                onPress={() => setCompare("none")}
              />
            </ChipRow>
            <Text style={styles.previewTitle}>
              {chosen.title || "Untitled"}
            </Text>
            {compare === "none" ? (
              chosen.document?.format === 2 ? (
                <DocContainerBody nodes={chosen.document.nodes} />
              ) : (
                <DocBody content={chosen.content} />
              )
            ) : (
              <Changes
                before={historyBlocks(beforePage ?? chosen)}
                after={historyBlocks(afterPage ?? doc)}
                by={
                  !structuredComparison && compare === "previous" && older
                    ? older.author
                    : null
                }
                sittings={
                  structuredComparison
                    ? null
                    : compare === "previous" && older
                      ? undefined
                      : sittings
                }
                sitting={compare === "previous"}
                canRestore={
                  canWrite &&
                  !busy &&
                  !structuredComparison &&
                  doc.document?.format !== 2
                }
                onRestoreLine={putBack}
              />
            )}
          </View>
        )}
      </BottomSheet>
      <BottomSheet
        visible={restoreOpen}
        title="Restore version?"
        closeDisabled={busy}
        onClose={() => setRestoreOpen(false)}
        footer={
          <Button
            title={busy ? "Restoring…" : "Restore"}
            disabled={busy || !canWrite}
            onPress={() => void restore()}
          />
        }
      >
        <Text style={styles.empty}>
          Restore the version from{" "}
          {chosen ? when(chosen.created_at) : "history"}? The current version
          stays in history.
        </Text>
        {restoreFailed && (
          <Text style={styles.error}>
            Couldn't restore this version. Try again.
          </Text>
        )}
      </BottomSheet>
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
        {!nothing && !authors && " · author details unavailable"}
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
      <View
        style={[
          styles.diffMain,
          { marginLeft: Math.min(layout.depth, 3) * 16 },
        ]}
      >
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
    error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
    item: {
      gap: 2,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      minHeight: 44,
    },
    itemChosen: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accentSoft,
    },
    itemPressed: { backgroundColor: colors.surfaceMuted },
    itemWhen: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    itemMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    itemMeta: { color: colors.muted, fontSize: 13, flex: 1, minWidth: 0 },
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
      borderTopWidth: 1,
      borderTopColor: colors.border,
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
      minHeight: 44,
      justifyContent: "center",
      maxWidth: "100%",
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

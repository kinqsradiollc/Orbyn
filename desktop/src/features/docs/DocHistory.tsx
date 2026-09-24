import { useConfirm } from "../../components/Confirm";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronsUpDown,
  History,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import {
  changeAuthors,
  diffBlocks,
  diffCounts,
  listLayout,
  MAX_SITTINGS,
  type Doc,
  type DocBlock,
  type DocDiffLine,
  type DocVersion,
  type Sitting,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { BlockView } from "./DocBlocks";

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

/**
 * A version chosen in history, and what it is being compared with: the page
 * as it is now, or the version kept before it (what that sitting changed).
 */
export type HistoryView = {
  version: Required<DocVersion>;
  /** The version kept before this one, when there is one. */
  older: Required<DocVersion> | null;
  compare: "current" | "previous";
  /**
   * This version and every one kept since, oldest first, to tell who made
   * each change since; null when there are too many to read.
   */
  sittings: Sitting[] | null;
};

/**
 * The page as it was. Each entry is a sitting — the state a run of saves
 * replaced — so the list reads as "before Tuesday's edits", not as a
 * keystroke log. Choosing one shows what changed on the page itself (see
 * DocChanges); Restore puts the whole version back as a new version on top,
 * so nothing is ever thrown away.
 */
export function DocHistory({
  doc,
  onRestored,
  canWrite = true,
  onClose,
  onView,
  viewing,
  report,
}: {
  doc: Doc;
  canWrite?: boolean;
  onRestored: (doc: Doc) => void;
  onClose: () => void;
  /** Show a version on the page, compared with something, or stop. */
  onView: (view: HistoryView | null) => void;
  viewing: HistoryView | null;
  report: (e: unknown) => void;
}) {
  const { ask } = useConfirm();
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = viewing?.version ?? null;

  useEffect(() => {
    client.listDocVersions(doc.id).then(setVersions, (e) => {
      setVersions([]);
      report(e);
    });
  }, [doc.id, doc.version, report]);

  const open = (v: DocVersion) => {
    if (!versions) return;
    setBusy(true);
    const at = versions.findIndex((x) => x.version === v.version);
    // The version kept before this one, for "what this sitting changed".
    const older = versions[at + 1];
    // The ones kept since, newest first, for who changed what since.
    const since = at < MAX_SITTINGS ? versions.slice(0, at) : null;
    Promise.all([
      client.getDocVersion(doc.id, v.version),
      older ? client.getDocVersion(doc.id, older.version) : null,
      since
        ? Promise.all(since.map((x) => client.getDocVersion(doc.id, x.version)))
        : null,
    ])
      .then(([version, before, newer]) =>
        onView({
          version,
          older: before,
          compare: viewing?.compare ?? "current",
          sittings: newer
            ? [version, ...newer.reverse()].map((x) => ({
                content: x.content,
                author: x.author,
              }))
            : null,
        }),
      )
      .catch(report)
      .finally(() => setBusy(false));
  };

  const restore = async () => {
    if (!chosen || !canWrite) return;
    if (
      !(await ask({
        title: `Put the page back as it was at ${when(chosen.created_at)}? What is there now is kept in history.`,
      }))
    )
      return;
    setBusy(true);
    client
      .restoreDocVersion(doc.id, chosen.version)
      .then((restored) => {
        onRestored(restored);
        onView(null);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  return (
    <aside className="doc-history" aria-label="Page history">
      <div className="doc-history-head">
        <h3>
          <History size={15} aria-hidden="true" /> History
        </h3>
        <button
          className="icon-button"
          aria-label="Close history"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      {versions === null ? (
        <p className="muted small">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="muted small">
          Nothing to go back to yet. Each time you sit down and change the page,
          the version you started from is kept here.
        </p>
      ) : (
        <ol className="doc-history-list">
          {versions.map((v) => (
            <li key={v.version}>
              <button
                className={
                  "doc-history-item" +
                  (chosen?.version === v.version ? " is-chosen" : "")
                }
                aria-pressed={chosen?.version === v.version}
                disabled={busy || !canWrite}
                onClick={() => open(v)}
              >
                <strong>{when(v.created_at)}</strong>
                <small>
                  <span className="doc-initials" aria-hidden="true">
                    {initials(v.author)}
                  </span>{" "}
                  {v.author ?? "Someone"} · {v.blocks}{" "}
                  {v.blocks === 1 ? "block" : "blocks"}
                  {v.title !== doc.title && v.title ? ` · “${v.title}”` : ""}
                </small>
              </button>
            </li>
          ))}
        </ol>
      )}

      {chosen && (
        <div className="doc-history-preview">
          <span className="doc-history-note">
            Showing the page as it was at {when(chosen.created_at)}, with what
            has changed.
          </span>
          <button
            className="text-button"
            disabled={busy || !canWrite}
            onClick={restore}
          >
            <RotateCcw size={14} aria-hidden="true" /> Restore this version
          </button>
        </div>
      )}
    </aside>
  );
}

/** Unchanged lines kept around each change when the rest are folded away. */
const CONTEXT = 2;

/**
 * "Show changes": a version of the page set against the page as it is now,
 * or against the version before it. Added lines sit on a soft accent tint,
 * removed ones are struck through on a soft danger tint, and long runs of
 * unchanged lines fold away. A removed or rewritten line can be put back on
 * its own with "Restore this line", without going back on anything else.
 */
export function DocChanges({
  view,
  current,
  title,
  canRestore,
  onCompare,
  onRestoreLine,
  onClose,
}: {
  view: HistoryView;
  /** The page as it stands now, as the editor has it. */
  current: DocBlock[];
  title: string;
  canRestore: boolean;
  onCompare: (compare: HistoryView["compare"]) => void;
  /** Put line `index` of `source` back on the page. */
  onRestoreLine: (source: DocBlock[], index: number) => void;
  onClose: () => void;
}) {
  const previous = view.compare === "previous" && view.older;
  const before = previous ? view.older!.content : view.version.content;
  const after = previous ? view.version.content : current;
  const lines = useMemo(() => diffBlocks(before, after), [before, after]);
  const counts = diffCounts(lines);
  // Who made each change: for one sitting, the person who replaced the
  // older version's state; since then, whichever sitting made it.
  const authors = useMemo(
    () =>
      previous
        ? lines.map((l) => (l.change === "same" ? null : view.older!.author))
        : view.sittings
          ? changeAuthors(lines, view.sittings)
          : null,
    [lines, previous, view],
  );
  const layoutBefore = useMemo(() => listLayout(before), [before]);
  const layoutAfter = useMemo(() => listLayout(after), [after]);
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  useEffect(() => setUnfolded(new Set()), [view]);

  // Which unchanged lines are near enough a change to stay in view.
  const near = useMemo(() => {
    const keep = new Set<number>();
    lines.forEach((l, i) => {
      if (l.change === "same") return;
      for (let j = i - CONTEXT; j <= i + CONTEXT; j++) keep.add(j);
    });
    return keep;
  }, [lines]);

  const rows: ({ line: DocDiffLine; at: number } | { fold: number[] })[] = [];
  let hidden: number[] = [];
  lines.forEach((line, at) => {
    const foldable = line.change === "same" && !near.has(at);
    if (foldable && !unfolded.has(at)) {
      hidden.push(at);
      return;
    }
    if (hidden.length) rows.push({ fold: hidden });
    hidden = [];
    rows.push({ line, at });
  });
  if (hidden.length) rows.push({ fold: hidden });
  const nothing = counts.added + counts.removed + counts.edited === 0;

  return (
    <section className="doc-page doc-changes" aria-label="Show changes">
      <div className="doc-changes-head">
        <button className="text-button" onClick={onClose}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to the page
        </button>
        <div
          className="doc-changes-compare"
          role="radiogroup"
          aria-label="Compare with"
        >
          <span className="muted small">Compare with</span>
          <button
            role="radio"
            aria-checked={!previous}
            className={!previous ? "is-on" : ""}
            onClick={() => onCompare("current")}
          >
            Current page
          </button>
          <button
            role="radio"
            aria-checked={!!previous}
            className={previous ? "is-on" : ""}
            disabled={!view.older}
            title={view.older ? undefined : "This is the oldest version kept"}
            onClick={() => onCompare("previous")}
          >
            Previous version
          </button>
        </div>
      </div>
      <h1 className="doc-title is-reading">{title || "Untitled"}</h1>
      <p className="doc-changes-summary muted small" role="status">
        {nothing
          ? previous
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
      </p>
      <div className="doc-body doc-changes-body">
        {rows.map((row) =>
          "fold" in row ? (
            <button
              key={`fold-${row.fold[0]}`}
              className="doc-changes-fold"
              onClick={() =>
                setUnfolded((was) => new Set([...was, ...row.fold]))
              }
            >
              <ChevronsUpDown size={14} aria-hidden="true" />
              {row.fold.length} unchanged{" "}
              {row.fold.length === 1 ? "line" : "lines"}
            </button>
          ) : (
            <div
              key={`${row.line.change}-${row.at}`}
              className={
                "doc-diff-line" +
                (row.line.change === "added" ? " is-added" : "") +
                (row.line.change === "removed" ? " is-removed" : "")
              }
            >
              {row.line.change !== "same" && (
                <span className="doc-diff-sign" aria-hidden="true">
                  {row.line.change === "added" ? "+" : "−"}
                </span>
              )}
              <span className="sr-only">
                {row.line.change === "added"
                  ? "Added: "
                  : row.line.change === "removed"
                    ? "Removed: "
                    : ""}
              </span>
              <div className="doc-block is-static">
                <BlockView
                  block={row.line.block}
                  {...(row.line.change === "removed"
                    ? layoutBefore[row.line.index]
                    : layoutAfter[row.line.index])}
                />
              </div>
              {authors?.[row.at] && (
                <span className="doc-initials" title={authors[row.at]!}>
                  {initials(authors[row.at])}
                </span>
              )}
              {row.line.change === "removed" && canRestore && (
                <button
                  className="text-button doc-diff-restore"
                  onClick={() => onRestoreLine(before, row.line.index)}
                >
                  <Undo2 size={14} aria-hidden="true" /> Restore this line
                </button>
              )}
            </div>
          ),
        )}
      </div>
    </section>
  );
}

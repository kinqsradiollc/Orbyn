import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  GripVertical,
  ListPlus,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import {
  BLOCK_KINDS,
  blockToType,
  mergeDocs,
  parseDoc,
  serializeBlock,
  serializeDoc,
  type Doc,
  type DocBlock,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { BlockView } from "./DocBlocks";
import { DocBlockMenu, SlashMenu } from "./DocBlockMenu";
import { DocComments } from "./DocComments";

type Kind = (typeof BLOCK_KINDS)[number];

/** Kinds that carry on when you press Enter at the end of a line. */
const LISTS = new Set<DocBlock["type"]>(["bullet", "numbered", "todo"]);

/** How long to wait after typing stops before saving. */
const SAVE_AFTER_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

/** How long the "someone else edited this" note stays up. */
const MERGE_NOTE_MS = 6_000;

/**
 * Re-read an edited line, so "# " or "- " changes the block's type. Pasting
 * several lines yields several blocks, which the caller splices in, so nothing
 * typed or pasted is dropped.
 */
function blocksFromSource(source: string): DocBlock[] {
  const parsed = parseDoc(source);
  return parsed.length ? parsed : [{ type: "paragraph", text: "" }];
}

export function DocEditor({
  doc,
  onBack,
  onChanged,
  onDeleted,
  onItemsChanged,
  userId,
  report,
}: {
  doc: Doc;
  /** Left out for the agenda, which has no list to go back to. */
  onBack?: () => void;
  onChanged: (doc: Doc) => void;
  onDeleted: (id: string) => void;
  /** Called after checklist lines are turned into real tasks. */
  onItemsChanged?: () => void;
  /** Whose comments show a remove button. */
  userId?: string;
  report: (e: unknown) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [blocks, setBlocks] = useState<DocBlock[]>(
    doc.content.length ? doc.content : [{ type: "paragraph", text: "" }],
  );
  const [focused, setFocused] = useState<number | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const version = useRef(doc.version);
  const dirty = useRef(false);
  /**
   * The document as the server last had it. Merging needs this: it is what
   * tells an edit made here apart from one that arrived from somewhere else.
   */
  const base = useRef<DocBlock[]>(doc.content);
  /** Current state, readable from callbacks that were made earlier. */
  const live = useRef({ title: doc.title, blocks: [] as DocBlock[] });
  const [note, setNote] = useState("");
  /** Which line is open for editing, readable from the live subscription. */
  const focusedRef = useRef<number | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The block whose handle menu is open, and where to hang it. */
  const [menu, setMenu] = useState<{ index: number; at: DOMRect } | null>(null);
  /** A line that starts with "/", waiting for a kind to be picked. */
  const [slash, setSlash] = useState<{
    index: number;
    query: string;
    at: DOMRect;
  } | null>(null);

  // A different document replaces the editor's state entirely.
  useEffect(() => {
    setTitle(doc.title);
    setBlocks(
      doc.content.length ? doc.content : [{ type: "paragraph", text: "" }],
    );
    version.current = doc.version;
    base.current = doc.content;
    dirty.current = false;
    setSave("idle");
    setNote("");
    setFocused(null);
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  live.current = { title, blocks };
  focusedRef.current = focused;

  /**
   * Fold a copy of the document that came from elsewhere into what is on
   * screen. Lines only one side touched are kept as they are; where both
   * sides changed the same line, the version that is already saved stands
   * and the other is put back on the line below, so nothing typed is lost.
   * Returns the blocks now on screen.
   */
  const reconcile = useCallback((theirs: Doc): DocBlock[] => {
    const mine = live.current.blocks;
    const merge = mergeDocs(base.current, mine, theirs.content);
    const next = merge.blocks.length
      ? merge.blocks
      : [{ type: "paragraph", text: "" } as DocBlock];
    version.current = theirs.version;
    base.current = theirs.content;
    setBlocks(next);
    // The title is one field; whoever saved last has it.
    if (theirs.title !== live.current.title) setTitle(theirs.title);
    live.current = { title: theirs.title, blocks: next };
    setNote(
      merge.conflicts.length === 1
        ? "Someone else edited this. The line you changed is kept below theirs."
        : merge.conflicts.length > 1
          ? `Someone else edited this. The ${merge.conflicts.length} lines you changed are kept below theirs.`
          : "Updated with someone else's changes.",
    );
    return next;
  }, []);

  const persist = useCallback(
    async (nextTitle: string, nextBlocks: DocBlock[]) => {
      setSave("saving");
      try {
        const saved = await client.updateDoc(doc.id, {
          title: nextTitle,
          content: nextBlocks,
          version: version.current,
        });
        version.current = saved.version;
        base.current = saved.content;
        dirty.current = false;
        setSave("saved");
        onChanged(saved);
      } catch (e) {
        // Someone saved first. Take their copy, fold this edit into it and
        // save again, rather than making the writer sort it out by hand.
        if ((e as { statusCode?: number }).statusCode === 409) {
          try {
            const theirs = await client.getDoc(doc.id);
            const merged = reconcile(theirs);
            const saved = await client.updateDoc(doc.id, {
              title: live.current.title,
              content: merged,
              version: version.current,
            });
            version.current = saved.version;
            base.current = saved.content;
            dirty.current = false;
            setSave("saved");
            onChanged(saved);
            return;
          } catch (again) {
            setSave("error");
            report(again);
            return;
          }
        }
        setSave("error");
        report(e);
      }
    },
    [doc.id, onChanged, reconcile, report],
  );

  /** Queue a save; typing again restarts the clock. */
  const queueSave = useCallback(
    (nextTitle: string, nextBlocks: DocBlock[]) => {
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => void persist(nextTitle, nextBlocks),
        SAVE_AFTER_MS,
      );
    },
    [persist],
  );

  // Don't lose the last keystrokes when the editor closes.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * The subscription must outlive re-renders: it depends on the document,
   * not on callbacks that are rebuilt each time the page is typed into.
   * Without this the stream was torn down and reopened on every keystroke.
   */
  const onEvent = useRef<(version: number) => void>(() => {});
  onEvent.current = (remote: number) => {
    if (remote && remote <= version.current) return;
    void client.getDoc(doc.id).then((theirs) => {
      if (theirs.version <= version.current) return;
      // A line open for editing counts as ours even before a keystroke:
      // replacing the whole page would pull the text out from under it.
      if (!dirty.current && focusedRef.current === null) {
        version.current = theirs.version;
        base.current = theirs.content;
        setTitle(theirs.title);
        setBlocks(
          theirs.content.length
            ? theirs.content
            : [{ type: "paragraph", text: "" }],
        );
        setNote("Updated with someone else's changes.");
        onChanged(theirs);
        return;
      }
      const merged = reconcile(theirs);
      // Only send the merged page back when something of ours was waiting;
      // an open but untouched line has nothing to add.
      if (dirty.current) void persist(live.current.title, merged);
      else onChanged(theirs);
    }, report);
  };

  /**
   * Follow the document while it is open. When it changes somewhere else the
   * server says only that it moved on; the new copy is read here and folded
   * in, so two people can work on the same page at once.
   */
  useEffect(() => client.watchDoc(doc.id, (v) => onEvent.current(v)), [doc.id]);

  // The note is news, not a state to sit in.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), MERGE_NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);

  const update = (next: DocBlock[]) => {
    setBlocks(next);
    queueSave(title, next);
  };

  const editBlock = (index: number, source: string) => {
    const next = blocks.slice();
    next.splice(index, 1, ...blocksFromSource(source));
    update(next);
  };

  const insertAfter = (index: number) => {
    const current = blocks[index];
    const next = blocks.slice();
    // Enter at the end of a list item makes another; on an empty one it
    // leaves the list instead, the way every editor since Word has.
    if (LISTS.has(current.type)) {
      if (!("text" in current) || current.text.trim() === "") {
        next[index] = { type: "paragraph", text: "" };
        update(next);
        return;
      }
      next.splice(
        index + 1,
        0,
        blockToType({ type: "paragraph", text: "" }, current.type),
      );
    } else next.splice(index + 1, 0, { type: "paragraph", text: "" });
    update(next);
    setFocused(index + 1);
  };

  /** The same words as another kind of block. */
  const turnInto = (index: number, kind: Kind) => {
    const next = blocks.slice();
    next[index] = blockToType(blocks[index], kind.type, kind.level);
    update(next);
  };

  const moveBlock = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= blocks.length) return;
    const next = blocks.slice();
    [next[index], next[to]] = [next[to], next[index]];
    update(next);
  };

  const duplicate = (index: number) => {
    const next = blocks.slice();
    const copy = { ...blocks[index] };
    // A copied checklist line is a new line, not the same task twice.
    if (copy.type === "todo") delete copy.id;
    next.splice(index + 1, 0, copy);
    update(next);
  };

  /** A "/" at the start of an empty line asks what the line should be. */
  const watchSlash = (
    index: number,
    value: string,
    el: HTMLTextAreaElement,
  ) => {
    const m = /^\/([^\s]*)$/.exec(value);
    if (m && blocks[index].type === "paragraph")
      setSlash({ index, query: m[1], at: el.getBoundingClientRect() });
    else if (slash) setSlash(null);
  };

  const pickSlash = (kind: Kind) => {
    if (!slash) return;
    const next = blocks.slice();
    next[slash.index] = blockToType(
      { type: "paragraph", text: "" },
      kind.type,
      kind.level,
    );
    setSlash(null);
    update(next);
    // Stay on the line, now of its new kind, ready to type into.
    setFocused(null);
    requestAnimationFrame(() => setFocused(slash.index));
  };

  const removeAt = (index: number) => {
    const next = blocks.slice();
    // A page is never empty: the last block goes back to a blank line.
    if (blocks.length === 1) next[0] = { type: "paragraph", text: "" };
    else next.splice(index, 1);
    update(next);
    setFocused(Math.max(0, index - 1));
  };

  const toggleTodo = (index: number) => {
    const b = blocks[index];
    if (b.type !== "todo") return;
    const next = blocks.slice();
    next[index] = { ...b, done: !b.done };
    update(next);
  };

  const onKey = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    index: number,
  ) => {
    const value = e.currentTarget.value;
    const multiline =
      blocks[index].type === "code" || blocks[index].type === "math";
    if (e.key === "Enter" && !e.shiftKey && !multiline) {
      e.preventDefault();
      insertAfter(index);
    } else if (e.key === "Backspace" && value === "" && blocks.length > 1) {
      e.preventDefault();
      removeAt(index);
    } else if (e.key === "ArrowUp" && index > 0 && !multiline) {
      e.preventDefault();
      setFocused(index - 1);
    } else if (
      e.key === "ArrowDown" &&
      index < blocks.length - 1 &&
      !multiline
    ) {
      e.preventDefault();
      setFocused(index + 1);
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
      setFocused(null);
    }
  };

  // Keep the open textarea sized to its content.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focused]);

  const markdown = useMemo(() => serializeDoc(blocks), [blocks]);

  const download = () => {
    const blob = new Blob([`# ${title}\n\n${markdown}`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "document"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Lines already tied to a task are not offered again.
  const openTodos = blocks.filter(
    (b) => b.type === "todo" && !b.done && !b.id && b.text.trim().length > 0,
  ).length;

  /** Turn the unticked checklist lines into real tasks. */
  const makeTasks = () =>
    void (async () => {
      // Save first so the server works from what's on screen.
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) await persist(title, blocks);
      try {
        const { created, doc: updated } = await client.docToTasks(doc.id);
        // The server ties each line to its task and hands back the document;
        // adopting it keeps the ids, so the lines now follow their tasks.
        if (updated) {
          version.current = updated.version;
          dirty.current = false;
          setBlocks(updated.content);
          setSave("saved");
          onChanged(updated);
        }
        onItemsChanged?.();
        alert(
          created === 0
            ? "Every item here is already a task."
            : `Added ${created} task${created === 1 ? "" : "s"} to your planner. Ticking one here ticks it there.`,
        );
      } catch (e) {
        report(e);
      }
    })();

  const remove = () => {
    if (!confirm(`Delete “${title || "Untitled"}”? This can't be undone.`))
      return;
    void client
      .deleteDoc(doc.id)
      .then(() => onDeleted(doc.id))
      .catch(report);
  };

  return (
    <div className="doc-editor">
      <div className="doc-bar">
        {onBack && (
          <button className="text-button" onClick={onBack}>
            <ArrowLeft size={15} /> All documents
          </button>
        )}
        <span className="doc-save" role="status">
          {save === "saving" && (
            <>
              <Loader2 size={13} className="spin" /> Saving…
            </>
          )}
          {save === "saved" && (
            <>
              <Check size={13} /> Saved
            </>
          )}
          {save === "error" && "Not saved"}
        </span>
        {!!note && (
          <span className="doc-merged" role="status">
            <Users size={13} aria-hidden="true" /> {note}
          </span>
        )}
        <span className="doc-bar-actions">
          {openTodos > 0 && (
            <button className="text-button" onClick={makeTasks}>
              <ListPlus size={15} /> Add {openTodos} to my tasks
            </button>
          )}
          <button
            className="icon-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(`# ${title}\n\n${markdown}`)
                .then(() => setNote("Copied as Markdown."), report)
            }
            aria-label="Copy as Markdown"
            title="Copy as Markdown"
          >
            <Copy size={15} />
          </button>
          <button
            className="icon-button"
            onClick={download}
            aria-label="Export as Markdown"
            title="Export as Markdown"
          >
            <Download size={15} />
          </button>
          <button
            className="icon-button"
            onClick={remove}
            aria-label="Delete document"
            title="Delete document"
          >
            <Trash2 size={15} />
          </button>
        </span>
      </div>

      <div className="doc-page">
        <input
          id="doc-title"
          className="doc-title"
          value={title}
          placeholder="Untitled"
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            queueSave(e.target.value, blocks);
          }}
        />

        <div className="doc-body">
          {blocks.map((block, index) =>
            focused === index ? (
              <textarea
                key={`${index}-${block.type}`}
                id={`doc-block-${index}`}
                ref={areaRef}
                className="doc-input"
                rows={1}
                defaultValue={serializeBlock(block)}
                onChange={(e) => {
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                  watchSlash(index, e.currentTarget.value, e.currentTarget);
                  editBlock(index, e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  // The slash menu owns Enter and the arrows while it is open.
                  if (
                    slash &&
                    ["Enter", "ArrowUp", "ArrowDown"].includes(e.key)
                  )
                    return;
                  onKey(e, index);
                }}
                onBlur={() => setFocused((f) => (f === index ? null : f))}
              />
            ) : (
              <div key={index} className="doc-block-row">
                <button
                  className="doc-handle"
                  aria-label="Block options"
                  aria-haspopup="menu"
                  onClick={(e) =>
                    setMenu({
                      index,
                      at: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                >
                  <GripVertical size={14} aria-hidden="true" />
                </button>
                <div
                  className="doc-block"
                  role="button"
                  tabIndex={0}
                  onClick={() => setFocused(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setFocused(index);
                    }
                  }}
                >
                  <BlockView
                    block={block}
                    onToggleTodo={() => toggleTodo(index)}
                  />
                </div>
              </div>
            ),
          )}
          <button
            className="doc-add"
            onClick={() => insertAfter(blocks.length - 1)}
          >
            <Plus size={14} aria-hidden="true" /> Add a block
            <kbd>/</kbd>
          </button>
          {menu && (
            <DocBlockMenu
              anchor={menu.at}
              block={blocks[menu.index]}
              isFirst={menu.index === 0}
              isLast={menu.index === blocks.length - 1}
              onTurnInto={(kind) => turnInto(menu.index, kind)}
              onMove={(by) => moveBlock(menu.index, by)}
              onDuplicate={() => duplicate(menu.index)}
              onDelete={() => removeAt(menu.index)}
              onClose={() => setMenu(null)}
            />
          )}
          {slash && (
            <SlashMenu
              anchor={slash.at}
              query={slash.query}
              onPick={pickSlash}
              onClose={() => setSlash(null)}
            />
          )}
        </div>

        <p className="doc-hint">
          Click any line to edit it. Start a line with <code>#</code> for a
          heading, <code>-</code> for a bullet, <code>- [ ]</code> for a
          checkbox, <code>&gt;</code> to quote, <code>```</code> for code or{" "}
          <code>$$</code> for a formula. Inline maths goes between single{" "}
          <code>$</code> signs.
        </p>

        <DocComments docId={doc.id} userId={userId} report={report} />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  ListPlus,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  parseDoc,
  serializeBlock,
  serializeDoc,
  type Doc,
  type DocBlock,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { BlockView } from "./DocBlocks";
import { DocComments } from "./DocComments";

/** How long to wait after typing stops before saving. */
const SAVE_AFTER_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

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
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different document replaces the editor's state entirely.
  useEffect(() => {
    setTitle(doc.title);
    setBlocks(
      doc.content.length ? doc.content : [{ type: "paragraph", text: "" }],
    );
    version.current = doc.version;
    dirty.current = false;
    setSave("idle");
    setFocused(null);
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        dirty.current = false;
        setSave("saved");
        onChanged(saved);
      } catch (e) {
        setSave("error");
        report(e);
      }
    },
    [doc.id, onChanged, report],
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
    const next = blocks.slice();
    next.splice(index + 1, 0, { type: "paragraph", text: "" });
    update(next);
    setFocused(index + 1);
  };

  const removeAt = (index: number) => {
    if (blocks.length === 1) return;
    const next = blocks.slice();
    next.splice(index, 1);
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
        <span className="doc-bar-actions">
          {openTodos > 0 && (
            <button className="text-button" onClick={makeTasks}>
              <ListPlus size={15} /> Add {openTodos} to my tasks
            </button>
          )}
          <button
            className="icon-button"
            onClick={download}
            aria-label="Export as Markdown"
          >
            <Download size={15} />
          </button>
          <button
            className="icon-button"
            onClick={remove}
            aria-label="Delete document"
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
                key={index}
                id={`doc-block-${index}`}
                ref={areaRef}
                className="doc-input"
                rows={1}
                defaultValue={serializeBlock(block)}
                onChange={(e) => {
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                  editBlock(index, e.currentTarget.value);
                }}
                onKeyDown={(e) => onKey(e, index)}
                onBlur={() => setFocused((f) => (f === index ? null : f))}
              />
            ) : (
              <div
                key={index}
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
            ),
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

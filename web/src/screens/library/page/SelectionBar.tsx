import {
  createDocSelectionSettler,
  DOC_AI_ACTIONS,
  DOC_AI_LABELS,
  linkRange,
  styleRange,
  tintRange,
  type DocAiAction,
  type DocBlock,
  type DocSelection,
  type HighlightTint,
  type InlineStyle,
} from "@orbyn/core";
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link2,
  ListChecks,
  MessageSquarePlus,
  Sparkles,
  Strikethrough,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button, IconButton, Input, useToast } from "../../../ui/kit";
import { findLeaf, leafList } from "./tree";
import type { Page } from "./usePage";

export type Picked = {
  blockId: string;
  start: number;
  end: number;
  quote: string;
  at: DOMRect;
};

type Piece = { node: Text; start: number };

function pieces(block: Element) {
  const out: Piece[] = [];
  const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const holder = (node as Text).parentElement?.closest("[data-src]");
    if (!holder || !block.contains(holder)) continue;
    out.push({
      node: node as Text,
      start: Number(holder.getAttribute("data-src")),
    });
  }
  return out;
}

function edge(list: Piece[], node: Node, offset: number, toEnd: boolean) {
  if (node.nodeType === Node.TEXT_NODE) {
    const hit = list.find((piece) => piece.node === node);
    if (hit) return hit.start + offset;
  }
  const inside = list.filter((piece) => node.contains(piece.node));
  if (!inside.length) return null;
  const piece = toEnd ? inside[inside.length - 1] : inside[0];
  return toEnd ? piece.start + piece.node.length : piece.start;
}

/** A selection on the page, as a range in the line's stored source. */
function readSelection(root: HTMLElement): Picked | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const container = range.commonAncestorContainer;
  const block = (
    container instanceof Element ? container : container.parentElement
  )?.closest("[data-block-id]");
  if (!block) return null;
  const blockId = block.getAttribute("data-block-id");
  const source = block.getAttribute("data-block-source");
  if (!blockId || source === null) return null;
  const list = pieces(block);
  const from = edge(list, range.startContainer, range.startOffset, false);
  const to = edge(list, range.endContainer, range.endOffset, true);
  if (from === null || to === null) return null;
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(source.length, Math.max(from, to));
  if (end <= start) return null;
  const quote = source.slice(start, end).trim();
  if (!quote) return null;
  const lead = source.slice(start, end).indexOf(quote);
  return {
    blockId,
    start: start + lead,
    end: start + lead + quote.length,
    quote,
    at: range.getBoundingClientRect(),
  };
}

/** Visible text is an unanchored excerpt; a block mapping is never invented. */
function excerptFrom(root: HTMLElement | null): DocSelection | null {
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const source = root.textContent ?? "";
  const start = prefix.toString().length;
  const quote = range.toString();
  if (!quote.trim() || source.slice(start, start + quote.length) !== quote)
    return null;
  return { format: "note", source, start, end: start + quote.length, quote };
}

const QUICK = DOC_AI_ACTIONS.filter((action) => action !== "custom");
const TINTS: { tint: HighlightTint; label: string }[] = [
  { tint: "amber", label: "Amber" },
  { tint: "green", label: "Green" },
  { tint: "rose", label: "Rose" },
];

/** Tools for selected words; they wait for the selection to settle. */
export function SelectionBar({
  root,
  page,
  canWrite,
  disabled,
  onComment,
  onAssist,
  onTask,
  onAskPage,
}: {
  root: RefObject<HTMLDivElement | null>;
  page: Page;
  canWrite: boolean;
  disabled: boolean;
  onComment: (picked: Picked) => void;
  onAssist: (picked: Picked, action: DocAiAction, instruction?: string) => void;
  onTask: (picked: Picked) => void;
  onAskPage: (selection: DocSelection) => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  const bar = useRef<HTMLDivElement>(null);
  const latest = useRef(setPicked);
  latest.current = setPicked;
  useEffect(() => {
    const controller = createDocSelectionSettler(
      () => (root.current ? readSelection(root.current) : null),
      (value) => latest.current(value),
      (callback, delay) => {
        const timer = window.setTimeout(callback, delay);
        return () => window.clearTimeout(timer);
      },
    );
    const owns = (event: Event) =>
      event.target instanceof Node &&
      !!root.current?.contains(event.target) &&
      !(
        event.target instanceof Element &&
        event.target.closest(".doc-select-bar")
      );
    const start = (event: Event) => {
      if (owns(event)) controller.start();
    };
    const end = () => controller.finish();
    const cancel = () => controller.cancel();
    const change = () => controller.change();
    const keydown = (event: KeyboardEvent) => {
      if (
        owns(event) &&
        (event.shiftKey ||
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
          ].includes(event.key))
      )
        controller.start();
    };
    document.addEventListener("pointerdown", start, true);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("selectionchange", change);
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", end);
    const pane = root.current;
    pane?.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      controller.dispose();
      document.removeEventListener("pointerdown", start, true);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("selectionchange", change);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", end);
      pane?.removeEventListener("scroll", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [root]);
  useEffect(() => {
    setLinking(false);
    setAsking(false);
    setUrl("");
    setInstruction("");
  }, [picked?.blockId, picked?.start, picked?.end]);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element || !picked) return;
    const size = element.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(
        picked.at.left + picked.at.width / 2 - size.width / 2,
        innerWidth - size.width - 8,
      ),
    );
    const above = picked.at.top - size.height - 8;
    element.style.left = `${left}px`;
    element.style.top = `${above > 56 ? above : Math.min(picked.at.bottom + 8, innerHeight - size.height - 8)}px`;
  }, [picked, linking, asking]);

  if (!picked) return null;
  const done = () => {
    setPicked(null);
    window.getSelection()?.removeAllRanges();
  };
  const leafNow = () => {
    const document = page.store.state.session?.document;
    if (!document) return null;
    const unnamed = /^index:(\d+)$/.exec(picked.blockId);
    return unnamed
      ? (leafList(document)[Number(unnamed[1])] ?? null)
      : findLeaf(document, picked.blockId);
  };
  const restyle = (make: (text: string) => { text: string } | null) => {
    const leaf = leafNow();
    if (!leaf || !("text" in leaf.block)) return;
    const made = make(leaf.block.text);
    if (!made) {
      toast({ text: "Those words already have another style.", error: true });
      return;
    }
    page.edit({
      kind: "replace-leaf",
      path: leaf.path,
      block: { ...leaf.block, text: made.text } as DocBlock,
    });
    done();
  };
  const style = (name: InlineStyle) =>
    restyle((text) => styleRange(text, picked.start, picked.end, name));
  return (
    <div
      ref={bar}
      className="doc-select-bar"
      role="toolbar"
      aria-label="Selected words"
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      {linking ? (
        <form
          className="doc-select-form"
          onSubmit={(event) => {
            event.preventDefault();
            const leaf = leafNow();
            if (!leaf || !("text" in leaf.block)) return;
            const made = linkRange(
              leaf.block.text,
              picked.start,
              picked.end,
              url,
            );
            if (!made) {
              toast({
                text: "That doesn't look like a web address.",
                error: true,
              });
              return;
            }
            page.edit({
              kind: "replace-leaf",
              path: leaf.path,
              block: { ...leaf.block, text: made.text } as DocBlock,
            });
            done();
          }}
        >
          <Input
            autoFocus
            aria-label="Web address for the link"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <Button type="submit" variant="primary" disabled={!url.trim()}>
            Link
          </Button>
        </form>
      ) : asking ? (
        <div className="doc-select-ask">
          <div className="doc-select-chips">
            {QUICK.map((action) => (
              <button
                key={action}
                type="button"
                disabled={disabled}
                onClick={() => {
                  const value = picked;
                  done();
                  onAssist(value, action);
                }}
              >
                {DOC_AI_LABELS[action].name}
              </button>
            ))}
          </div>
          <form
            className="doc-select-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!instruction.trim()) return;
              const value = picked;
              done();
              onAssist(value, "custom", instruction.trim());
            }}
          >
            <Input
              aria-label="Instruction"
              placeholder="Or say what you want"
              value={instruction}
              onChange={(event) => setInstruction(event.currentTarget.value)}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={disabled || !instruction.trim()}
            >
              Ask
            </Button>
          </form>
        </div>
      ) : (
        <>
          {canWrite && (
            <>
              <IconButton label="Bold (⌘B)" onClick={() => style("bold")}>
                <Bold />
              </IconButton>
              <IconButton label="Italic (⌘I)" onClick={() => style("italic")}>
                <Italic />
              </IconButton>
              <IconButton
                label="Strikethrough (⌘⇧X)"
                onClick={() => style("strike")}
              >
                <Strikethrough />
              </IconButton>
              <IconButton label="Code (⌘E)" onClick={() => style("code")}>
                <Code />
              </IconButton>
              <IconButton
                label="Highlight (⌘⇧H)"
                onClick={() => style("highlight")}
              >
                <Highlighter />
              </IconButton>
              {TINTS.slice(1).map(({ tint, label }) => (
                <button
                  key={tint}
                  type="button"
                  className={`doc-tint is-${tint}`}
                  aria-label={`Highlight ${label}`}
                  title={`Highlight ${label}`}
                  onClick={() =>
                    restyle((text) =>
                      tintRange(text, picked.start, picked.end, tint),
                    )
                  }
                />
              ))}
              <IconButton label="Link (⌘K)" onClick={() => setLinking(true)}>
                <Link2 />
              </IconButton>
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              const value = picked;
              done();
              onComment(value);
            }}
          >
            <MessageSquarePlus /> Comment
          </Button>
          {canWrite ? (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => setAsking(true)}
            >
              <Sparkles /> Refine
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                const excerpt = excerptFrom(root.current);
                done();
                if (excerpt) onAskPage(excerpt);
              }}
            >
              <Sparkles /> Ask
            </Button>
          )}
          {canWrite && (
            <Button
              variant="ghost"
              onClick={() => {
                const value = picked;
                done();
                onTask(value);
              }}
            >
              <ListChecks /> Make task
            </Button>
          )}
        </>
      )}
    </div>
  );
}

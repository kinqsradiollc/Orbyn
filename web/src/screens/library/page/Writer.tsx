import {
  BLOCK_KINDS,
  blockDepth,
  blockToType,
  blockText,
  docReferenceLinks,
  emptyTable,
  EMBED_LANG,
  embedText,
  foldedLines,
  footnoteNumbers,
  footnoteTexts,
  htmlToBlocks,
  indentBlocks,
  insertLink,
  isListBlock,
  isUrl,
  linkQueryAt,
  linkRange,
  linkShortcut,
  listLayout,
  LIVE_LIST_LANG,
  mentionMarkdown,
  mentionQuery,
  newBlockId,
  nextFootnoteLabel,
  CALLOUT_LABELS,
  serializeDoc,
  slashMatches,
  slashQueryAt,
  styleRange,
  textToBlocks,
  withDepth,
  addedInlineTags,
  type DocBlock,
  type DocContainerItem,
  type DocContainerNode,
  type DocContentOperation,
  type InlineStyle,
  type LinkOption,
  type ObjectRef,
  type Restyled,
  type VersionedDocContent,
} from "@orbyn/core";
import { MoreVertical, Plus } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { useToast } from "../../../ui/kit";
import { BlockView } from "./Blocks";
import { BlockMenu } from "./BlockMenu";
import { FootnoteContext } from "./context";
import { liveListChoices } from "./LiveList";
import type { Mark } from "./marks";
import type { Page } from "./usePage";
import {
  isCodeLike,
  isTextLeaf,
  leafList,
  lineSource,
  listOwner,
  nodeAt,
  paragraph,
  pathKey,
  rootsOf,
  settledOperation,
  shortcutNode,
  liveEdit,
  nodesFromSource,
  type Leaf,
} from "./tree";

export type WriterMode = "edit" | "read" | "suggest";

type Editing = { path: number[]; caret?: number; id: string; nonce?: number };

export type WriterHandle = {
  /** Settle the open line so the store holds everything typed. */
  settle: () => void;
};

export type SlashChoice = {
  key: string;
  label: string;
  hint?: string;
  keywords?: string;
  inline?: boolean;
  run: (at: SlashTarget) => void;
};

type SlashTarget = { leaf: Leaf; value: string; from: number; caret: number };

export function Writer({
  page,
  mode,
  canWrite,
  linked,
  folds,
  onFold,
  marks,
  handle,
  onComment,
  onTask,
  onMoveToPage,
  onCopyLink,
  onAddFiles,
  onPickFiles,
  onTemplate,
  onTagsTyped,
  onPropose,
  onOpenCode,
  flashId,
}: {
  page: Page;
  mode: WriterMode;
  canWrite: boolean;
  linked: Set<string>;
  folds: Set<string>;
  onFold: (id: string) => void;
  marks: Record<string, Mark[]>;
  handle: React.RefObject<WriterHandle | null>;
  onComment: (leaf: Leaf) => void;
  onTask: (leaf: Leaf) => void;
  onMoveToPage: (leaf: Leaf) => void;
  onCopyLink: (leaf: Leaf) => void;
  onAddFiles: (files: File[], after: Leaf | null, replace: boolean) => void;
  onPickFiles: (leaf: Leaf, images: boolean) => void;
  onTemplate: (leaf: Leaf) => void;
  onTagsTyped: (names: string[]) => void;
  onPropose: (leaf: Leaf, before: string, after: string) => void;
  onOpenCode: (leaf: Leaf) => void;
  flashId: string | null;
}) {
  const toast = useToast();
  const document = page.document!;
  const blocks = page.leaves;
  const writable =
    canWrite &&
    mode === "edit" &&
    !page.state.conflict &&
    !page.state.sourceInvalid;
  const typing = writable || (mode === "suggest" && !page.state.conflict);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<{ leaf: Leaf; at: DOMRect } | null>(null);
  const settleRef = useRef<() => void>(() => {});
  handle.current = { settle: () => settleRef.current() };

  useEffect(() => {
    const reopen = (event: Event) => {
      const { path, id } = (
        event as CustomEvent<{ path: number[]; id: string }>
      ).detail;
      setEditing({ path, caret: 0, id });
    };
    window.addEventListener("orbyn:doc-open-line", reopen);
    return () => window.removeEventListener("orbyn:doc-open-line", reopen);
  }, []);

  const leaves = useMemo(() => leafList(document), [document]);
  const layout = useMemo(() => listLayout(blocks), [blocks]);
  const hidden = useMemo(() => foldedLines(blocks, folds), [blocks, folds]);
  const notes = useMemo(
    () => ({
      references: docReferenceLinks(blocks),
      numbers: footnoteNumbers(blocks),
      texts: footnoteTexts(blocks),
    }),
    [blocks],
  );
  const tagBase = useRef(blocks);
  const report = (text: string) => toast({ text, error: true });

  const open = useCallback(
    (leaf: Leaf, caret?: number) =>
      setEditing({ path: leaf.path, caret, id: leaf.block.id ?? newBlockId() }),
    [],
  );

  const currentDoc = useCallback(
    () => page.store.state.session?.document ?? null,
    [page.store],
  );

  /** Swap a node for others; removal plus inserts are one synchronous edit. */
  const replaceNode = (path: number[], nodes: DocContainerNode[]) => {
    const owner = path.slice(0, -1);
    const index = path[path.length - 1];
    if (!page.edit({ kind: "remove", path })) return false;
    nodes.forEach((node, offset) => {
      page.edit({ kind: "insert", owner, index: index + offset, node });
    });
    return true;
  };

  const withoutItem = (
    node: Extract<DocContainerNode, { kind: "list" }>,
    item: number,
  ) => ({
    head: node.items.slice(0, item),
    tail: node.items.slice(item + 1),
  });
  const listOf = (
    node: Extract<DocContainerNode, { kind: "list" }>,
    items: DocContainerItem[],
    id?: string,
  ): DocContainerNode => ({
    ...node,
    ...(id ? { id } : { id: undefined }),
    items,
  });

  /** An empty list item steps out of its list. */
  const exitList = (leaf: Leaf) => {
    const doc = currentDoc();
    if (!doc) return;
    const roots = rootsOf(doc);
    const owner = listOwner(leaf.path, roots);
    if (!owner) return;
    const { head, tail } = withoutItem(owner.node, owner.item);
    const next = paragraph();
    const nodes: DocContainerNode[] = [
      ...(head.length ? [listOf(owner.node, head, owner.node.id)] : []),
      { kind: "block", block: next },
      ...(tail.length
        ? [
            listOf(
              { ...owner.node, start: owner.node.start + head.length + 1 },
              tail,
            ),
          ]
        : []),
    ];
    if (replaceNode(owner.list, nodes)) {
      const at = [
        ...owner.list.slice(0, -1),
        owner.list[owner.list.length - 1] + (head.length ? 1 : 0),
      ];
      setEditing({ path: at, caret: 0, id: next.id! });
    }
  };

  const enter = (leaf: Leaf, value: string, caret: number) => {
    const doc = currentDoc();
    if (!doc) return;
    const head = value.slice(0, caret);
    const tail = value.slice(caret);
    const block = leaf.block;
    // At the start of a line, the words keep their identity and a line opens above.
    if (
      caret === 0 &&
      value.trim() &&
      !isListBlock(block) &&
      leaf.path.length < 3
    ) {
      const parent = leaf.path.slice(0, -1);
      const index = leaf.path[leaf.path.length - 1];
      page.edit({
        kind: "insert",
        owner: parent,
        index,
        node: { kind: "block", block: paragraph() },
      });
      setEditing({
        path: [...parent, index + 1],
        caret: 0,
        id: block.id ?? newBlockId(),
      });
      return;
    }
    if (doc.format === 1) {
      if (isListBlock(block)) {
        if (!blockText(block).trim() && !tail.trim()) {
          if (blockDepth(block) > 0)
            page.edit({
              kind: "replace-leaf",
              path: leaf.path,
              block: withDepth(block, blockDepth(block) - 1),
            });
          else {
            page.edit({
              kind: "replace-leaf",
              path: leaf.path,
              block: {
                type: "paragraph",
                text: "",
                ...(block.id ? { id: block.id } : {}),
              },
            });
            setEditing({ ...editingOf(leaf), caret: 0, nonce: Date.now() });
          }
          return;
        }
      }
      page.edit({
        kind: "replace-leaf",
        path: leaf.path,
        block: liveEdit(doc, block, head),
      });
      const after = currentDoc()!;
      const here = nodeAt(rootsOf(after), leaf.path);
      const base = here?.kind === "block" ? here.block : block;
      const id = newBlockId();
      const text = tail.replace(/^\s+/, "");
      const made = isListBlock(base)
        ? {
            ...withDepth(
              blockToType({ type: "paragraph", text }, base.type),
              blockDepth(base),
            ),
            id,
          }
        : ({ type: "paragraph", text, id } as DocBlock);
      page.edit({
        kind: "insert",
        owner: [],
        index: leaf.path[0] + 1,
        node: { kind: "block", block: made },
      });
      setEditing({
        path: [leaf.path[0] + 1],
        caret: isListBlock(base) ? lineSource(made).length - text.length : 0,
        id,
      });
      return;
    }
    const roots = rootsOf(doc);
    const owner = listOwner(leaf.path, roots);
    if (owner && !value.trim()) return exitList(leaf);
    page.edit({
      kind: "replace-leaf",
      path: leaf.path,
      block: liveEdit(doc, block, head),
    });
    const fresh = paragraph(tail.replace(/^\s+/, ""));
    if (owner) {
      page.edit({
        kind: "split-item",
        list: owner.list,
        item: owner.item,
        at: owner.child + 1,
      });
      const ownerPath = [...owner.list, owner.item + 1];
      page.edit({
        kind: "insert",
        owner: ownerPath,
        index: 0,
        node: { kind: "block", block: fresh },
      });
      setEditing({ path: [...ownerPath, 0], caret: 0, id: fresh.id! });
      return;
    }
    const parent = leaf.path.slice(0, -1);
    const index = leaf.path[leaf.path.length - 1] + 1;
    page.edit({
      kind: "insert",
      owner: parent,
      index,
      node: { kind: "block", block: fresh },
    });
    setEditing({ path: [...parent, index], caret: 0, id: fresh.id! });
  };

  const editingOf = (leaf: Leaf): Editing => ({
    path: leaf.path,
    id: leaf.block.id ?? newBlockId(),
  });

  /** Removing a line must also remove a list item or quote it leaves empty. */
  const removeLeaf = (leaf: Leaf) => {
    const doc = currentDoc();
    if (!doc) return;
    const roots = rootsOf(doc);
    const owner = listOwner(leaf.path, roots);
    if (owner && owner.node.items[owner.item].children.length === 1) {
      const { head, tail } = withoutItem(owner.node, owner.item);
      const items = [...head, ...tail];
      if (items.length)
        replaceNode(owner.list, [listOf(owner.node, items, owner.node.id)]);
      else page.edit({ kind: "remove", path: owner.list });
      return;
    }
    const parent =
      leaf.path.length > 1 ? nodeAt(roots, leaf.path.slice(0, -1)) : null;
    if (parent?.kind === "quote" && parent.children.length === 1) {
      page.edit({ kind: "remove", path: leaf.path.slice(0, -1) });
      return;
    }
    if (roots.length === 1 && leaf.path.length === 1) {
      page.edit({
        kind: "replace-leaf",
        path: leaf.path,
        block: {
          type: "paragraph",
          text: "",
          ...(leaf.block.id ? { id: leaf.block.id } : {}),
        },
      });
      return;
    }
    page.edit({ kind: "remove", path: leaf.path });
  };

  const backspace = (leaf: Leaf, value: string) => {
    const doc = currentDoc();
    if (!doc) return false;
    const list = leafList(doc);
    const here = list.findIndex(
      (one) => pathKey(one.path) === pathKey(leaf.path),
    );
    const previous = list[here - 1];
    if (!value) {
      if (list.length === 1) return false;
      removeLeaf(leaf);
      if (previous) {
        const after = currentDoc()!;
        const target = leafList(after).find(
          (one) => pathKey(one.path) === pathKey(previous.path),
        );
        if (target && isTextLeaf(target.block))
          open(target, lineSource(target.block).length);
        else setEditing(null);
      } else {
        const first = leafList(currentDoc()!)[0];
        if (first) open(first, 0);
      }
      return true;
    }
    if (
      !previous ||
      !isTextLeaf(previous.block) ||
      isCodeLike(previous.block) ||
      isCodeLike(leaf.block)
    )
      return false;
    if (doc.format === 2 && previous.path.length !== leaf.path.length)
      return false;
    const joined =
      lineSource(previous.block) +
      value.replace(/^(?:#{1,6} |[-*+] (?:\[[ xX]\] )?|\d+\. |> )/, "");
    const caret = lineSource(previous.block).length;
    page.edit({
      kind: "replace-leaf",
      path: previous.path,
      block: liveEdit(doc, previous.block, joined),
    });
    const refreshed = leafList(currentDoc()!).find(
      (one) => pathKey(one.path) === pathKey(leaf.path),
    );
    if (refreshed) removeLeaf(refreshed);
    const target = leafList(currentDoc()!).find(
      (one) => pathKey(one.path) === pathKey(previous.path),
    );
    if (target) open(target, caret);
    return true;
  };

  const indent = (leaf: Leaf, by: 1 | -1) => {
    const doc = currentDoc();
    if (!doc) return;
    if (doc.format === 1) {
      const next = indentBlocks(doc.blocks, leaf.path[0], by);
      if (next === doc.blocks) return;
      next.forEach((block, index) => {
        if (block !== doc.blocks[index])
          page.edit({ kind: "replace-leaf", path: [index], block });
      });
      return;
    }
    const roots = rootsOf(doc);
    const owner = listOwner(leaf.path, roots);
    if (!owner) return;
    const { list, item, node } = owner;
    if (by === 1) {
      if (item === 0) return;
      const previous = node.items[item - 1];
      const moved = node.items[item];
      const nested = previous.children[previous.children.length - 1];
      const children =
        nested?.kind === "list"
          ? [
              ...previous.children.slice(0, -1),
              { ...nested, items: [...nested.items, moved] },
            ]
          : [
              ...previous.children,
              {
                kind: "list" as const,
                ordered: node.ordered,
                start: 1,
                delimiter: node.delimiter,
                loose: false,
                items: [moved],
              },
            ];
      const items = [
        ...node.items.slice(0, item - 1),
        { ...previous, children },
        ...node.items.slice(item + 1),
      ];
      if (replaceNode(list, [listOf(node, items, node.id)])) {
        const childIndex = children.length - 1;
        const inner = nested?.kind === "list" ? nested.items.length : 0;
        setEditing({
          path: [...list, item - 1, childIndex, inner, 0],
          id: leaf.block.id ?? newBlockId(),
        });
      }
      return;
    }
    // Out one level: the item joins the list that holds this one.
    if (list.length < 3) return;
    const outerRef =
      listOwner([...list, 0].slice(0, list.length), roots) ?? null;
    const outerList = list.slice(0, -2);
    const outerItem = list[list.length - 2];
    const outer = nodeAt(roots, outerList);
    if (outer?.kind !== "list" || !outerRef) return;
    const moved = node.items[item];
    const remaining = node.items.filter((_, index) => index !== item);
    const holder = outer.items[outerItem];
    const childAt = list[list.length - 1];
    const children = holder.children.flatMap((child, index) =>
      index !== childAt
        ? [child]
        : remaining.length
          ? [{ ...node, items: remaining }]
          : [],
    );
    const items = [...outer.items];
    items[outerItem] = { ...holder, children };
    items.splice(outerItem + 1, 0, moved);
    if (replaceNode(outerList, [listOf(outer, items, outer.id)]))
      setEditing({
        path: [...outerList, outerItem + 1, 0],
        id: leaf.block.id ?? newBlockId(),
      });
  };

  const turnInto = (leaf: Leaf, kind: (typeof BLOCK_KINDS)[number]) => {
    const doc = currentDoc();
    if (!doc) return;
    if (
      doc.format === 2 &&
      (kind.type === "bullet" ||
        kind.type === "numbered" ||
        kind.type === "todo" ||
        kind.type === "quote")
    ) {
      const marker =
        kind.type === "bullet"
          ? "- "
          : kind.type === "numbered"
            ? "1. "
            : kind.type === "todo"
              ? "- [ ] "
              : "> ";
      const nodes = nodesFromSource(
        doc,
        leaf.block,
        `${marker}${blockText(leaf.block)}`,
      );
      page.edit({ kind: "splice-leaf", path: leaf.path, nodes });
      return;
    }
    const next = blockToType(leaf.block, kind.type, kind.level);
    page.edit({
      kind: "replace-leaf",
      path: leaf.path,
      block: leaf.block.id ? { ...next, id: leaf.block.id } : next,
    });
  };
  const move = (leaf: Leaf, by: -1 | 1) => {
    const index = leaf.path[leaf.path.length - 1] + by;
    const owner = leaf.path.slice(0, -1);
    const doc = currentDoc();
    if (!doc || index < 0) return;
    const siblings = owner.length
      ? (() => {
          const up = nodeAt(
            rootsOf(doc),
            owner.length % 2 === 0 ? owner.slice(0, -1) : owner,
          );
          return up?.kind === "quote"
            ? up.children
            : up?.kind === "list"
              ? up.items[owner[owner.length - 1]].children
              : [];
        })()
      : rootsOf(doc);
    if (index >= siblings.length) return;
    page.edit({ kind: "move", path: leaf.path, owner, index });
  };
  const duplicate = (leaf: Leaf) => {
    const copy: DocBlock = { ...leaf.block, id: newBlockId() };
    page.edit({
      kind: "insert",
      owner: leaf.path.slice(0, -1),
      index: leaf.path[leaf.path.length - 1] + 1,
      node: { kind: "block", block: copy },
    });
  };
  const addAfterLast = () => {
    const doc = currentDoc();
    if (!doc) return;
    const roots = rootsOf(doc);
    const fresh = paragraph();
    if (
      page.edit({
        kind: "insert",
        owner: [],
        index: roots.length,
        node: { kind: "block", block: fresh },
      })
    )
      setEditing({ path: [roots.length], caret: 0, id: fresh.id! });
  };
  const replaceLeaf = (leaf: Leaf) => (block: DocBlock) =>
    page.edit({ kind: "replace-leaf", path: leaf.path, block });

  const today = () =>
    new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const slashChoices = useMemo<SlashChoice[]>(() => {
    const whole =
      (block: DocBlock, reopen = false) =>
      (at: SlashTarget) => {
        const id = at.leaf.block.id ?? newBlockId();
        const doc = currentDoc();
        if (!doc) return;
        page.edit({
          kind: "replace-leaf",
          path: at.leaf.path,
          block: { ...block, id },
        });
        setEditing(
          reopen ? { path: at.leaf.path, id, nonce: Date.now() } : null,
        );
      };
    return [
      ...BLOCK_KINDS.map((kind) => ({
        key: `${kind.type}-${kind.level ?? ""}`,
        label: kind.label,
        hint: kind.hint,
        keywords: kind.shorthand,
        run: (at: SlashTarget) => {
          if (
            page.document?.format === 2 &&
            (kind.type === "bullet" ||
              kind.type === "numbered" ||
              kind.type === "todo" ||
              kind.type === "quote")
          ) {
            const shortcut = shortcutNode(
              kind.type === "bullet"
                ? "- "
                : kind.type === "numbered"
                  ? "1. "
                  : kind.type === "todo"
                    ? "[ ] "
                    : "> ",
              at.leaf.block.id,
            );
            if (shortcut) {
              page.edit({
                kind: "splice-leaf",
                path: at.leaf.path,
                nodes: [shortcut.node],
              });
              setEditing({
                path: [...at.leaf.path, ...shortcut.into],
                caret: 0,
                id: at.leaf.block.id ?? newBlockId(),
              });
            }
            return;
          }
          const made = blockToType(
            { type: "paragraph", text: "" },
            kind.type,
            kind.level,
          );
          whole(made, kind.type !== "divider")(at);
        },
      })),
      {
        key: "date",
        label: "Date",
        hint: "Today's date",
        inline: true,
        run: (at) => retype(at, today()),
      },
      {
        key: "link",
        label: "Link",
        hint: "To a page, task or project",
        inline: true,
        run: (at) => retype(at, "[["),
      },
      {
        key: "table",
        label: "Table",
        hint: "Rows and columns",
        run: (at) => whole({ type: "table", text: emptyTable() })(at),
      },
      {
        key: "live-list",
        label: "Live list",
        hint: "Tasks or pages that keep up",
        keywords: "view",
        run: (at) =>
          whole({
            type: "code",
            lang: LIVE_LIST_LANG,
            text: liveListChoices(page.state.doc?.project_id ?? null)[0].text,
          })(at),
      },
      {
        key: "image",
        label: "Picture",
        hint: "From this device",
        keywords: "image photo",
        run: (at) => onPickFiles(at.leaf, true),
      },
      {
        key: "file",
        label: "File",
        hint: "PDF, Word, Excel, CSV",
        keywords: "attachment",
        run: (at) => onPickFiles(at.leaf, false),
      },
      {
        key: "template",
        label: "Template",
        hint: "Insert saved lines",
        run: (at) => onTemplate(at.leaf),
      },
      {
        key: "footnote",
        label: "Footnote",
        hint: "A note at the page's end",
        inline: true,
        run: (at) => {
          const label = nextFootnoteLabel(page.leaves);
          retype(at, `[^${label}]`);
          const doc = currentDoc();
          if (doc)
            page.edit({
              kind: "insert",
              owner: [],
              index: rootsOf(doc).length,
              node: {
                kind: "block",
                block: { type: "footnote", label, text: "", id: newBlockId() },
              },
            });
        },
      },
      {
        key: "embed-section",
        label: "Embed a page",
        hint: "A live part of another page",
        keywords: "section",
        run: (at) => {
          embedNext.current = true;
          retype(at, "[[");
        },
      },
      {
        key: "embed-tasks",
        label: "Tasks linked here",
        hint: "Every task this page links to",
        run: (at) =>
          whole({
            type: "code",
            lang: EMBED_LANG,
            text: embedText({ kind: "tasks" }),
          })(at),
      },
      {
        key: "diagram",
        label: "Diagram",
        hint: "Flowcharts and more",
        keywords: "mermaid chart",
        run: (at) =>
          whole(
            {
              type: "code",
              lang: "mermaid",
              text: "flowchart TD\n  A[Start] --> B[Next step]",
            },
            true,
          )(at),
      },
      ...(["note", "tip", "warning", "question", "summary"] as const).map(
        (tone) => ({
          key: `callout-${tone}`,
          label: `${CALLOUT_LABELS[tone]} callout`,
          hint: "A set-apart box",
          run: (at: SlashTarget) => {
            if (page.document?.format === 2) {
              page.edit({
                kind: "splice-leaf",
                path: at.leaf.path,
                nodes: [
                  {
                    kind: "quote",
                    callout: { tone, folded: false },
                    children: [
                      {
                        kind: "block",
                        block: {
                          type: "paragraph",
                          text: "",
                          ...(at.leaf.block.id ? { id: at.leaf.block.id } : {}),
                        },
                      },
                    ],
                  },
                ],
              });
              setEditing({
                path: [...at.leaf.path, 0],
                caret: 0,
                id: at.leaf.block.id ?? newBlockId(),
              });
            } else whole({ type: "callout", kind: tone, text: "" }, true)(at);
          },
        }),
      ),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.document?.format, page.leaves]);

  const embedNext = useRef(false);
  const retypeRef = useRef<(at: SlashTarget, words: string) => void>(() => {});
  const retype = (at: SlashTarget, words: string) =>
    retypeRef.current(at, words);

  const renderLeaf = (leaf: Leaf): ReactNode => {
    if (hidden[leaf.index]) return null;
    const block = leaf.block;
    const key = pathKey(leaf.path);
    const isOpen = editing && pathKey(editing.path) === key;
    const lineMarks = block.id ? marks[block.id] : undefined;
    const editable = typing && isTextLeaf(block);
    const heading = block.type === "heading" && block.id;
    return (
      <div
        className="doc-line"
        data-block-id={block.id ?? `index:${leaf.index}`}
        data-block-source={"text" in block ? block.text : undefined}
        data-leaf-index={leaf.index}
        data-container-path={key}
        data-editing={isOpen || undefined}
        data-flash={flashId && flashId === block.id ? true : undefined}
      >
        {writable && !isOpen && (
          <button
            type="button"
            className="doc-handle"
            aria-label={`Block ${leaf.index + 1} options`}
            aria-haspopup="menu"
            onClick={(event) =>
              setMenu({ leaf, at: event.currentTarget.getBoundingClientRect() })
            }
          >
            <MoreVertical aria-hidden="true" />
          </button>
        )}
        {heading && folds.has(block.id!) && (
          <button
            type="button"
            className="doc-unfold small"
            onClick={() => onFold(block.id!)}
          >
            Show section
          </button>
        )}
        {isOpen && editing ? (
          <LineEditor
            key={`${key}:${editing.nonce ?? 0}`}
            page={page}
            leaf={leaf}
            editing={editing}
            number={layout[leaf.index]?.number}
            suggesting={mode === "suggest"}
            slashChoices={slashChoices}
            embedNext={embedNext}
            retypeRef={retypeRef}
            settleRef={settleRef}
            onClose={() => setEditing(null)}
            onEnter={enter}
            onBackspace={backspace}
            onIndent={indent}
            onMove={(to) => {
              const list = leafList(currentDoc()!);
              const here = list.findIndex(
                (one) => pathKey(one.path) === pathKey(leaf.path),
              );
              for (let at = here + to; at >= 0 && at < list.length; at += to)
                if (isTextLeaf(list[at].block)) {
                  open(
                    list[at],
                    to < 0 ? lineSource(list[at].block).length : 0,
                  );
                  return;
                }
            }}
            onFiles={(files) => onAddFiles(files, leaf, true)}
            onLeave={() => {
              const added = addedInlineTags(tagBase.current, page.leaves);
              tagBase.current = page.leaves;
              if (added.length && canWrite) onTagsTyped(added);
            }}
            onPropose={onPropose}
            report={report}
          />
        ) : (
          <div
            className="doc-rendered"
            tabIndex={editable ? 0 : undefined}
            role={editable ? "group" : undefined}
            aria-label={editable ? `Block ${leaf.index + 1}` : undefined}
            aria-description={editable ? "Press Enter to edit." : undefined}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                event.key === "Enter" &&
                editable
              ) {
                event.preventDefault();
                activate(leaf);
              }
            }}
            onClick={(event) => {
              if (!editable) return;
              const target = event.target as HTMLElement;
              if (
                target.closest(
                  "a, button, input, textarea, iframe, summary, select",
                )
              )
                return;
              if (!window.getSelection()?.isCollapsed) return;
              activate(
                leaf,
                caretFromPoint(
                  event.clientX,
                  event.clientY,
                  event.currentTarget,
                  block,
                ),
              );
            }}
          >
            <BlockView
              block={block}
              marks={lineMarks}
              number={layout[leaf.index]?.number}
              depth={layout[leaf.index]?.depth}
              isTask={!!block.id && linked.has(block.id)}
              pageBlocks={blocks}
              onReplace={writable ? replaceLeaf(leaf) : undefined}
              onToggleTodo={
                block.type === "todo" && writable
                  ? () =>
                      page.edit({
                        kind: "replace-leaf",
                        path: leaf.path,
                        block: { ...block, done: !block.done },
                      })
                  : undefined
              }
            />
          </div>
        )}
      </div>
    );
  };

  const activate = (leaf: Leaf, caret?: number) => {
    if (
      isCodeLike(leaf.block) &&
      leaf.block.type === "code" &&
      leaf.block.lang === "latex-document"
    )
      return onOpenCode(leaf);
    if (
      leaf.block.type === "code" &&
      (leaf.block.lang === LIVE_LIST_LANG || leaf.block.lang === EMBED_LANG)
    )
      return;
    open(leaf, caret);
  };

  let cursor = 0;
  const tree = (
    nodes: readonly DocContainerNode[],
    path: number[],
  ): ReactNode =>
    nodes.map((node, index) => {
      const here = [...path, index];
      const key =
        node.kind === "block"
          ? (node.block.id ?? pathKey(here))
          : (node.id ?? pathKey(here));
      if (node.kind === "block") {
        const leaf = leaves[cursor++];
        return <Fragment key={key}>{leaf ? renderLeaf(leaf) : null}</Fragment>;
      }
      if (node.kind === "quote")
        return (
          <blockquote
            key={key}
            className={
              node.callout
                ? `doc-callout is-${node.callout.tone}`
                : "doc-quote-box"
            }
            data-container-path={pathKey(here)}
          >
            {node.callout && (
              <strong className="small">
                {CALLOUT_LABELS[node.callout.tone]}
              </strong>
            )}
            {tree(node.children, here)}
          </blockquote>
        );
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className="doc-list"
          start={node.ordered ? node.start : undefined}
          data-container-path={pathKey(here)}
        >
          {node.items.map((item, itemIndex) => (
            <li
              key={itemIndex}
              data-task={item.checked !== undefined || undefined}
            >
              {item.checked !== undefined && (
                <input
                  type="checkbox"
                  className="doc-check"
                  checked={item.checked}
                  disabled={!writable}
                  aria-label="Checklist item"
                  onChange={(event) =>
                    page.edit({
                      kind: "check-item",
                      list: here,
                      item: itemIndex,
                      checked: event.currentTarget.checked,
                    } as DocContentOperation)
                  }
                />
              )}
              <div className={`doc-item${item.checked ? " doc-done" : ""}`}>
                {tree(item.children, [...here, itemIndex])}
              </div>
            </li>
          ))}
        </Tag>
      );
    });

  return (
    <FootnoteContext.Provider value={notes}>
      <div className="doc-writer" data-mode={mode}>
        {tree(rootsOf(document), [])}
        {writable && (
          <button type="button" className="doc-add" onClick={addAfterLast}>
            <Plus aria-hidden="true" /> Add a block
          </button>
        )}
      </div>
      {menu && (
        <BlockMenu
          anchor={menu.at}
          leaf={menu.leaf}
          kinds={BLOCK_KINDS}
          onClose={() => setMenu(null)}
          onTurn={(kind) => turnInto(menu.leaf, kind)}
          onDuplicate={() => duplicate(menu.leaf)}
          onMove={(by) => move(menu.leaf, by)}
          onRemove={() => removeLeaf(menu.leaf)}
          onComment={() => onComment(menu.leaf)}
          onTask={() => onTask(menu.leaf)}
          onMoveToPage={() => onMoveToPage(menu.leaf)}
          onCopyLink={() => onCopyLink(menu.leaf)}
          onFold={
            menu.leaf.block.id && menu.leaf.block.type === "heading"
              ? () => onFold(menu.leaf.block.id!)
              : undefined
          }
        />
      )}
    </FootnoteContext.Provider>
  );
}

/** Where a click landed, as an offset in the line's own source. */
function caretFromPoint(
  x: number,
  y: number,
  root: HTMLElement,
  block: DocBlock,
) {
  const source = lineSource(block);
  const text = "text" in block ? block.text : "";
  const prefix = Math.max(0, source.indexOf(text));
  const range = (
    globalThis.document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    }
  ).caretRangeFromPoint?.(x, y);
  if (!range || !root.contains(range.startContainer)) return undefined;
  const holder = range.startContainer.parentElement?.closest("[data-src]");
  if (!holder) return undefined;
  return prefix + Number(holder.getAttribute("data-src")) + range.startOffset;
}

function fit(area: HTMLTextAreaElement) {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight}px`;
}

type Picker =
  | { kind: "slash"; from: number; query: string; inline: boolean }
  | { kind: "mention"; from: number; query: string }
  | { kind: "link"; start: number; query: string };

function LineEditor({
  page,
  leaf,
  editing,
  number,
  suggesting,
  slashChoices,
  embedNext,
  retypeRef,
  settleRef,
  onClose,
  onEnter,
  onBackspace,
  onIndent,
  onMove,
  onFiles,
  onLeave,
  onPropose,
  report,
}: {
  page: Page;
  leaf: Leaf;
  editing: Editing;
  number?: number | null;
  suggesting: boolean;
  slashChoices: SlashChoice[];
  embedNext: React.RefObject<boolean>;
  retypeRef: React.RefObject<(at: SlashTarget, words: string) => void>;
  settleRef: React.RefObject<() => void>;
  onClose: () => void;
  onEnter: (leaf: Leaf, value: string, caret: number) => void;
  onBackspace: (leaf: Leaf, value: string) => boolean;
  onIndent: (leaf: Leaf, by: 1 | -1) => void;
  onMove: (to: -1 | 1) => void;
  onFiles: (files: File[]) => void;
  onLeave: () => void;
  onPropose: (leaf: Leaf, before: string, after: string) => void;
  report: (text: string) => void;
}) {
  const block = leaf.block;
  const code = isCodeLike(block);
  const initial = useRef(lineSource(block, number)).current;
  const [value, setValue] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(JSON.stringify(block));
  const settled = useRef(false);
  const plainPaste = useRef(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [active, setActive] = useState(0);
  const [options, setOptions] = useState<
    { key: string; label: string; hint?: string | null; run: () => void }[]
  >([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const leafRef = useRef(leaf);
  leafRef.current = leaf;
  const locked = page.state.conflict || page.state.sourceInvalid;

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    fit(element);
    element.focus({ preventScroll: true });
    const at = Math.min(editing.caret ?? value.length, value.length);
    element.setSelectionRange(at, at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.caret, editing.path.join("/")]);
  useLayoutEffect(() => {
    if (area.current) fit(area.current);
  }, [value]);

  // Someone else's change to a line not typed in here reaches the box too.
  useEffect(() => {
    const now = JSON.stringify(block);
    if (now === committed.current || suggesting) return;
    const incoming = lineSource(block, number);
    if (incoming === valueRef.current) {
      committed.current = now;
      return;
    }
    if (valueRef.current === initial) {
      committed.current = now;
      setValue(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block]);

  const commit = useCallback(
    (text: string) => {
      if (suggesting) return;
      const document = page.store.state.session?.document;
      if (!document) return;
      const current = leafRef.current.block;
      const next = liveEdit(
        document,
        { ...current, id: current.id ?? editing.id },
        text,
      );
      committed.current = JSON.stringify(next);
      page.edit({
        kind: "replace-leaf",
        path: leafRef.current.path,
        block: next,
      });
    },
    [page, suggesting, editing.id],
  );

  /** Make the structure the words describe, once, when the line is left. */
  const settle = useCallback(() => {
    if (settled.current || page.replacing.current) return;
    settled.current = true;
    if (suggesting) {
      if (valueRef.current !== initial)
        onPropose(leafRef.current, initial, valueRef.current);
      return;
    }
    const document = page.store.state.session?.document;
    if (!document) return;
    const operation = settledOperation(
      document,
      leafRef.current,
      valueRef.current,
    );
    if (operation) page.edit(operation);
    onLeave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, suggesting]);
  settleRef.current = settle;
  useEffect(() => () => settle(), [settle]);

  const typeInto = (
    made: Restyled | { text: string; start: number; end: number },
  ) => {
    setValue(made.text);
    valueRef.current = made.text;
    commit(made.text);
    requestAnimationFrame(() =>
      area.current?.setSelectionRange(made.start, made.end),
    );
  };

  retypeRef.current = (at, words) => {
    const text = at.value.slice(0, at.from) + words + at.value.slice(at.caret);
    const caret = at.from + words.length;
    typeInto({ text, start: caret, end: caret });
    setPicker(
      words === "[[" ? { kind: "link", start: at.from, query: "" } : null,
    );
  };

  const watch = (text: string, caret: number) => {
    if (code) return setPicker(null);
    const link = linkQueryAt(text, caret);
    if (link)
      return setPicker({ kind: "link", start: link.start, query: link.query });
    const mention = mentionQuery(text, caret);
    if (mention)
      return setPicker({
        kind: "mention",
        from: mention.from,
        query: mention.query,
      });
    const slash = slashQueryAt(text, caret);
    if (slash) {
      const whole =
        slash.start === 0 &&
        text.slice(0, caret).length === caret &&
        !text.slice(caret).trim();
      if (!whole && !slash.query) return setPicker(null);
      return setPicker({
        kind: "slash",
        from: slash.start,
        query: slash.query,
        inline: !whole,
      });
    }
    setPicker(null);
  };

  // What the open picker offers. Search-backed lists guard against late answers.
  useEffect(() => {
    if (!picker) {
      setOptions([]);
      return;
    }
    setActive(0);
    const target: SlashTarget = {
      leaf: leafRef.current,
      value: valueRef.current,
      from: picker.kind === "link" ? picker.start : picker.from,
      caret: area.current?.selectionStart ?? valueRef.current.length,
    };
    if (picker.kind === "slash") {
      setOptions(
        slashChoices
          .filter(
            (choice) =>
              (!picker.inline || choice.inline) &&
              slashMatches(picker.query, choice),
          )
          .slice(0, 24)
          .map((choice) => ({
            key: choice.key,
            label: choice.label,
            hint: choice.hint,
            run: () => {
              setPicker(null);
              choice.run(target);
            },
          })),
      );
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      if (picker.kind === "mention") {
        client.docPeople(page.id).then(
          (people) => {
            if (!live) return;
            const words = picker.query.toLocaleLowerCase();
            setOptions(
              people
                .filter((person) =>
                  person.name.toLocaleLowerCase().includes(words),
                )
                .slice(0, 8)
                .map((person) => ({
                  key: person.id,
                  label: person.name,
                  run: () => {
                    const made = mentionMarkdown(person);
                    const caret = picker.from + made.length + 1;
                    typeInto({
                      text: `${valueRef.current.slice(0, picker.from)}${made} ${valueRef.current.slice(target.caret)}`,
                      start: caret,
                      end: caret,
                    });
                    setPicker(null);
                  },
                })),
            );
          },
          () => live && setOptions([]),
        );
        return;
      }
      client.pickLinks(picker.query, 12).then(
        (hits: LinkOption[]) => {
          if (!live) return;
          const put = (ref: ObjectRef, title: string) => {
            const caret =
              area.current?.selectionStart ?? valueRef.current.length;
            setPicker(null);
            if (embedNext.current) {
              embedNext.current = false;
              if (ref.kind !== "doc" || ref.id === page.id) {
                report(
                  ref.kind !== "doc"
                    ? "Only a page can be embedded."
                    : "That's this page.",
                );
                return;
              }
              const id = leafRef.current.block.id ?? newBlockId();
              page.edit({
                kind: "replace-leaf",
                path: leafRef.current.path,
                block: {
                  type: "code",
                  lang: EMBED_LANG,
                  text: embedText({
                    kind: "section",
                    doc: ref.id,
                    block: ref.block ?? null,
                  }),
                  id,
                },
              });
              onClose();
              return;
            }
            const made = insertLink(
              valueRef.current,
              picker.start,
              caret,
              ref,
              title,
            );
            typeInto({ text: made.text, start: made.caret, end: made.caret });
          };
          const doc = page.state.doc;
          const creating = picker.query.trim();
          setOptions([
            ...hits.map((hit) => ({
              key: `${hit.kind}:${hit.id}`,
              label: hit.title,
              hint: hit.hint,
              run: () => put({ kind: hit.kind, id: hit.id }, hit.title),
            })),
            ...(creating
              ? [
                  {
                    key: "new-page",
                    label: `New page: ${creating}`,
                    run: () =>
                      void client
                        .createDoc({
                          title: creating,
                          team_id: doc?.team_id,
                          project_id: doc?.project_id,
                        })
                        .then(
                          (made) =>
                            put({ kind: "doc", id: made.id }, made.title),
                          (failure) =>
                            report(
                              messageOf(failure, "Couldn't create the page."),
                            ),
                        ),
                  },
                  {
                    key: "new-task",
                    label: `New task: ${creating}`,
                    run: () =>
                      void client
                        .createItem({
                          title: creating,
                          ...(doc?.team_id ? { team_id: doc.team_id } : {}),
                          ...(doc?.project_id
                            ? { project_id: doc.project_id }
                            : {}),
                        })
                        .then(
                          (made) =>
                            put({ kind: "task", id: made.id }, made.title),
                          (failure) =>
                            report(
                              messageOf(failure, "Couldn't create the task."),
                            ),
                        ),
                  },
                ]
              : []),
          ]);
        },
        () => live && setOptions([]),
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker?.kind, picker?.query, slashChoices]);

  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const element = event.currentTarget;
    const text = element.value;
    if (picker && options.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((at) => (at + 1) % options.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((at) => (at - 1 + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        options[active]?.run();
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (picker) return setPicker(null);
      settle();
      onClose();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Tab") {
      if (code || suggesting) return;
      const inList = isListBlock(block) || leaf.path.length >= 3;
      if (!inList) return;
      event.preventDefault();
      onIndent(leaf, event.shiftKey ? -1 : 1);
      return;
    }
    if (mod && !event.altKey && !code) {
      const pressed = event.key.toLowerCase();
      const style: InlineStyle | null =
        pressed === "b" && !event.shiftKey
          ? "bold"
          : pressed === "i" && !event.shiftKey
            ? "italic"
            : pressed === "e" && !event.shiftKey
              ? "code"
              : pressed === "h" && event.shiftKey
                ? "highlight"
                : pressed === "x" && event.shiftKey
                  ? "strike"
                  : null;
      const restyle = (made: Restyled | null) => {
        if (made) typeInto(made);
        else report("Those words already have another style.");
      };
      if (style) {
        event.preventDefault();
        event.stopPropagation();
        restyle(
          styleRange(text, element.selectionStart, element.selectionEnd, style),
        );
        return;
      }
      if (pressed === "k" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        restyle(
          linkShortcut(text, element.selectionStart, element.selectionEnd),
        );
        return;
      }
      if (pressed === "v" && event.shiftKey) plainPaste.current = Date.now();
      if (event.key === "Enter" && block.type === "todo") {
        event.preventDefault();
        const box = /^(\s*[-*]\s+\[)( |x|X)\]/.exec(text);
        if (box) {
          const at = box[1].length;
          typeInto({
            text: `${text.slice(0, at)}${box[2] === " " ? "x" : " "}${text.slice(at + 1)}`,
            start: element.selectionStart,
            end: element.selectionEnd,
          });
        }
        return;
      }
    }
    if (code || suggesting) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      settled.current = true;
      onEnter(leaf, text, element.selectionStart);
      return;
    }
    if (
      event.key === "Backspace" &&
      element.selectionStart === 0 &&
      element.selectionEnd === 0
    ) {
      settled.current = true;
      if (onBackspace(leaf, text)) event.preventDefault();
      else settled.current = false;
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const before = element.selectionStart;
      const to = event.key === "ArrowUp" ? -1 : 1;
      const atEdge = to < 0 ? before === 0 : before === text.length;
      window.setTimeout(() => {
        if (atEdge && element.selectionStart === before) onMove(to);
      });
    }
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const plain = Date.now() - plainPaste.current < 1000;
    plainPaste.current = 0;
    const files = [...(event.clipboardData.files ?? [])];
    if (files.length && !suggesting) {
      event.preventDefault();
      onFiles(files);
      return;
    }
    if (code) return;
    const element = event.currentTarget;
    const text = event.clipboardData.getData("text/plain");
    const html = plain ? "" : event.clipboardData.getData("text/html");
    const { selectionStart: start, selectionEnd: end } = element;
    if (start !== end && isUrl(text) && !/\n/.test(text.trim())) {
      const made = linkRange(element.value, start, end, text.trim());
      if (made) {
        event.preventDefault();
        typeInto(made);
        return;
      }
    }
    if (suggesting) return;
    let pasted: DocBlock[] = html ? htmlToBlocks(html) : [];
    if (!pasted.length) {
      if (!/\n/.test(text.trim())) return;
      pasted = textToBlocks(text, plain);
    }
    if (!pasted.length) return;
    event.preventDefault();
    if (pasted.length === 1 && pasted[0].type === "paragraph") {
      const words = pasted[0].text;
      const at = start + words.length;
      typeInto({
        text: element.value.slice(0, start) + words + element.value.slice(end),
        start: at,
        end: at,
      });
      return;
    }
    const document = page.store.state.session?.document as
      VersionedDocContent | undefined;
    if (!document) return;
    const head = element.value.slice(0, start);
    const tail = element.value.slice(end);
    const body = serializeDoc(pasted);
    const joined = `${head}${head && !head.endsWith("\n") ? "\n\n" : ""}${body}${tail ? `\n\n${tail}` : ""}`;
    settled.current = true;
    page.edit({
      kind: "splice-leaf",
      path: leaf.path,
      nodes: nodesFromSource(document, leaf.block, joined),
    });
    onClose();
  };

  return (
    <div
      className="doc-editing"
      data-type={block.type}
      data-level={block.type === "heading" ? block.level : undefined}
    >
      {block.type === "code" && (
        <input
          className="doc-lang small"
          aria-label="Code language"
          placeholder="Language"
          value={block.lang}
          readOnly={locked}
          onChange={(event) =>
            page.edit({
              kind: "replace-leaf",
              path: leaf.path,
              block: { ...block, lang: event.currentTarget.value },
            })
          }
        />
      )}
      <textarea
        ref={area}
        rows={1}
        dir="auto"
        aria-label={`Edit block ${leaf.index + 1}`}
        spellCheck={!code}
        className={code ? "doc-input is-code" : "doc-input"}
        value={value}
        readOnly={locked}
        onChange={(event) => {
          const text = event.currentTarget.value;
          const caret = event.currentTarget.selectionStart;
          const document = page.store.state.session?.document;
          const shortcut =
            !suggesting && document?.format === 2 && block.type === "paragraph"
              ? shortcutNode(text, leaf.block.id ?? editing.id)
              : null;
          if (shortcut) {
            settled.current = true;
            page.edit({
              kind: "splice-leaf",
              path: leaf.path,
              nodes: [shortcut.node],
            });
            window.dispatchEvent(
              new CustomEvent("orbyn:doc-open-line", {
                detail: {
                  path: [...leaf.path, ...shortcut.into],
                  id: leaf.block.id ?? editing.id,
                },
              }),
            );
            return;
          }
          setValue(text);
          valueRef.current = text;
          commit(text);
          watch(text, caret);
        }}
        onSelect={(event) => {
          if (picker)
            watch(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
            );
        }}
        onKeyDown={key}
        onPaste={paste}
        onBlur={(event) => {
          if (
            (event.relatedTarget as HTMLElement | null)?.closest?.(
              ".doc-picker",
            )
          )
            return;
          settle();
          onClose();
        }}
      />
      {block.type === "code" && block.lang === "mermaid" && (
        <div className="doc-live-preview">
          <BlockView block={{ ...block, text: value }} />
        </div>
      )}
      {block.type === "math" && (
        <div className="doc-live-preview">
          <BlockView block={{ ...block, text: value }} />
        </div>
      )}
      {picker && options.length > 0 && (
        <ul className="doc-picker" role="listbox" aria-label="Suggestions">
          {options.map((option, index) => (
            <li key={option.key} role="option" aria-selected={index === active}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={option.run}
              >
                <span dir="auto">{option.label}</span>
                {option.hint && (
                  <small className="muted" dir="auto">
                    {option.hint}
                  </small>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

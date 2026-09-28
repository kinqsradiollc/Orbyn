import { useState, type DragEvent, type ReactNode } from "react";
import {
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  type LucideIcon,
} from "lucide-react";
import {
  canNest,
  docLibrary,
  docTree,
  nestTargets,
  treeOrder,
  treePath,
  treeRows,
  type DocSummary,
  type Folder,
} from "@orbyn/core";
import { carries, DOC_MIME, startDrag } from "../../lib/drag";
import { Popover } from "../../components/Popover";

/**
 * The Docs library as a tree (W5): folders at the top, pages inside pages
 * below them, each opened and closed on its own and remembered on this
 * device. A page dragged onto a page goes inside it; dropped above or below
 * one it goes beside it; onto a folder, to that folder's top level. Every
 * drag has a ⋯ menu twin (Move to…) for the keyboard.
 */

const OPEN_KEY = "orbyn-docs-tree";

/** Which folders and pages are open, remembered per device. */
export function useTreeOpen() {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
      return new Set(Array.isArray(saved) ? saved.map(String) : []);
    } catch {
      return new Set();
    }
  });
  const keep = (next: Set<string>) => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next].slice(-500)));
    } catch {
      // Storage can be blocked; the tree stays as it is for this visit.
    }
    return next;
  };
  return {
    isOpen: (id: string) => open.has(id),
    toggle: (id: string) =>
      setOpen((was) => {
        const next = new Set(was);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return keep(next);
      }),
    show: (...ids: string[]) =>
      setOpen((was) =>
        ids.every((id) => was.has(id)) ? was : keep(new Set([...was, ...ids])),
      ),
  };
}

export type TreeOpen = ReturnType<typeof useTreeOpen>;

/** Where a page goes: inside a page, or a folder's top level, at a place. */
export type TreeMoveTo = {
  parent_id?: string | null;
  folder_id?: string | null;
  position?: number;
};

/** The page being dragged in the tree, for checking drops as it moves. */
let held: DocSummary | null = null;

/** A folder of the tree: its row, and its pages while open. */
export function TreeFolder({
  id,
  icon: Icon = FolderIcon,
  name,
  count,
  tree,
  drop,
  children,
}: {
  /** Kept with the open pages ("folder:<id>"). */
  id: string;
  icon?: LucideIcon;
  name: string;
  count: number;
  tree: TreeOpen;
  /** Drag handlers for dropping a page onto the folder itself. */
  drop?: Record<string, unknown>;
  children: ReactNode;
}) {
  const open = tree.isOpen(id);
  return (
    <div className="docs-nav-folder">
      <button
        {...drop}
        className={
          "docs-tree-summary" +
          (drop?.className ? ` ${String(drop.className)}` : "")
        }
        aria-expanded={open}
        onClick={() => tree.toggle(id)}
      >
        <ChevronRight size={14} className="docs-tree-caret" />
        <Icon size={16} />
        <span>{name}</span>
        {count > 0 && <small className="docs-nav-count">{count}</small>}
      </button>
      {open && <div className="docs-nav-children">{children}</div>}
    </div>
  );
}

type Zone = "before" | "inside" | "after";

/**
 * The pages of one folder as a tree. `all` is every page listed, so a move
 * is checked against the whole library (a page can't go inside its own).
 */
export function TreePages({
  pages,
  all,
  openId,
  busy,
  tree,
  canWrite,
  onOpen,
  onMove,
  onRename,
  onNewInside,
  onMoveMenu,
}: {
  pages: DocSummary[];
  all: DocSummary[];
  openId: string | null;
  busy: boolean;
  tree: TreeOpen;
  canWrite: (doc: DocSummary) => boolean;
  onOpen: (id: string) => void;
  onMove: (doc: DocSummary, to: TreeMoveTo) => void;
  onRename: (doc: DocSummary, title: string) => void;
  onNewInside: (doc: DocSummary) => void;
  onMoveMenu: (doc: DocSummary, anchor: DOMRect) => void;
}) {
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [menu, setMenu] = useState<{
    doc: DocSummary;
    anchor: DOMRect;
  } | null>(null);
  const here = new Map(pages.map((d) => [d.id, d] as const));
  const rows = treeRows(docTree(pages), tree.isOpen);
  /** The page a row sits inside as the tree shows it (null: top level). */
  const shownParent = (d: DocSummary) =>
    d.parent_id ? (here.get(d.parent_id) ?? null) : null;

  /** Whether `page` may land at `zone` of `target`. */
  const allowed = (page: DocSummary, target: DocSummary, zone: Zone) => {
    if (page.id === target.id) return false;
    if (zone === "inside") return canNest(all, page, target);
    const parent = shownParent(target);
    if (parent) return canNest(all, page, parent);
    return (
      (page.team_id ?? null) === (target.team_id ?? null) &&
      (!!page.team_id || page.user_id === target.user_id) &&
      docLibrary(page.kind) === docLibrary(target.kind)
    );
  };

  const land = (target: DocSummary, zone: Zone) => {
    const page = held;
    held = null;
    setDrop(null);
    if (!page || !allowed(page, target, zone)) return;
    if (zone === "inside") {
      tree.show(target.id);
      onMove(page, { parent_id: target.id });
      return;
    }
    const parent = shownParent(target);
    const siblings = pages
      .filter(
        (d) =>
          d.id !== page.id &&
          (parent ? d.parent_id === parent.id : !shownParent(d)),
      )
      .sort(treeOrder);
    const at = siblings.findIndex((d) => d.id === target.id);
    const position = zone === "before" ? at : at + 1;
    onMove(
      page,
      parent
        ? { parent_id: parent.id, position }
        : { parent_id: null, folder_id: target.folder_id, position },
    );
  };

  const zoneOf = (e: DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(r.height, 1);
    return y < 0.3 ? "before" : y > 0.7 ? "after" : "inside";
  };

  const finishRename = (doc: DocSummary) => {
    const title = name.trim();
    setRenaming(null);
    if (title !== (doc.title || "").trim()) onRename(doc, title);
  };

  return (
    <>
      {rows.map(({ doc, depth, children, open }) => {
        const title = doc.title || "Untitled";
        const writable = canWrite(doc);
        const marked = drop?.id === doc.id ? ` is-drop-${drop.zone}` : "";
        return (
          <div
            key={doc.id}
            className={"docs-tree-row" + marked}
            style={{ "--depth": depth } as never}
            onDragOver={(e) => {
              if (!carries(e, DOC_MIME) || !held) return;
              const zone = zoneOf(e);
              if (!allowed(held, doc, zone)) {
                if (drop?.id === doc.id) setDrop(null);
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              if (drop?.id !== doc.id || drop.zone !== zone)
                setDrop({ id: doc.id, zone });
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null))
                return;
              setDrop((d) => (d?.id === doc.id ? null : d));
            }}
            onDrop={(e) => {
              if (!held || !carries(e, DOC_MIME)) return;
              e.preventDefault();
              e.stopPropagation();
              land(doc, zoneOf(e));
            }}
          >
            {children > 0 ? (
              <button
                className="docs-tree-toggle"
                aria-expanded={open}
                aria-label={`${open ? "Close" : "Open"} the pages in ${title}`}
                title={open ? "Hide pages inside" : "Show pages inside"}
                onClick={() => tree.toggle(doc.id)}
              >
                <ChevronRight size={14} className="docs-tree-caret" />
              </button>
            ) : (
              <span className="docs-tree-toggle" aria-hidden="true" />
            )}
            {renaming === doc.id ? (
              <input
                className="docs-tree-rename"
                aria-label={`Rename ${title}`}
                value={name}
                maxLength={200}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onBlur={() => finishRename(doc)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    finishRename(doc);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <button
                id={`doc-tree-${doc.id}`}
                className="docs-nav-page"
                aria-current={openId === doc.id ? "page" : undefined}
                disabled={busy}
                onClick={() => onOpen(doc.id)}
                onDoubleClick={() => {
                  if (!writable) return;
                  setName(doc.title);
                  setRenaming(doc.id);
                }}
                draggable={writable}
                onDragStart={(e) => {
                  held = doc;
                  startDrag(e, { kind: "doc", id: doc.id, title });
                }}
                onDragEnd={() => {
                  held = null;
                  setDrop(null);
                }}
              >
                <FileText size={14} />
                <span>{title}</span>
                {children > 0 && !open && (
                  <small className="docs-nav-count">{children}</small>
                )}
              </button>
            )}
            {writable && renaming !== doc.id && (
              <button
                className="docs-tree-more"
                aria-label={`More for ${title}`}
                title="More"
                aria-haspopup="menu"
                aria-expanded={menu?.doc.id === doc.id}
                onClick={(e) =>
                  setMenu({
                    doc,
                    anchor: e.currentTarget.getBoundingClientRect(),
                  })
                }
              >
                <MoreHorizontal size={14} />
              </button>
            )}
          </div>
        );
      })}
      {menu && (
        <Popover
          label={`${menu.doc.title || "Untitled"} actions`}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          width={220}
        >
          <div className="docs-move-menu" role="menu">
            <button
              className="doc-menu-item"
              role="menuitem"
              onClick={() => {
                setName(menu.doc.title);
                setRenaming(menu.doc.id);
                setMenu(null);
              }}
            >
              <Pencil size={16} />
              <span>Rename</span>
            </button>
            <button
              className="doc-menu-item"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                tree.show(menu.doc.id);
                onNewInside(menu.doc);
                setMenu(null);
              }}
            >
              <Plus size={16} />
              <span>New page inside</span>
            </button>
            <button
              className="doc-menu-item"
              role="menuitem"
              aria-haspopup="dialog"
              onClick={() => {
                onMoveMenu(menu.doc, menu.anchor);
                setMenu(null);
              }}
            >
              <FolderInput size={16} />
              <span>Move to…</span>
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

/**
 * "Move to…" for one page (W5): a folder's top level, or inside another
 * page it may go in, found by name. The keyboard's way to do what dragging
 * in the tree does.
 */
export function TreeMoveMenu({
  doc,
  all,
  folders,
  anchor,
  busy,
  onPick,
  onClose,
}: {
  doc: DocSummary;
  all: DocSummary[];
  folders: Folder[];
  anchor: DOMRect;
  busy: boolean;
  onPick: (to: TreeMoveTo) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase();
  const library = docLibrary(doc.kind) === "library";
  // Memory and Agent notes have one top level of their own.
  const places = library
    ? [{ id: "", name: "Unfiled", team_id: null as string | null }, ...folders]
        .filter((f) => !("archived_at" in f) || !f.archived_at)
        .filter((f) => !f.id || (f.team_id ?? null) === (doc.team_id ?? null))
    : [
        {
          id: "",
          name: doc.kind === "memory" ? "Memory" : "Agent notes",
          team_id: null,
        },
      ];
  const shownPlaces = places.filter((f) =>
    f.name.toLocaleLowerCase().includes(q),
  );
  const pages = nestTargets(all, doc).filter((d) =>
    (d.title || "Untitled").toLocaleLowerCase().includes(q),
  );
  const where = (d: DocSummary) =>
    treePath(all, d.id)
      .map((p) => p.title || "Untitled")
      .join(" › ");
  const first = () => {
    const f = shownPlaces[0];
    if (f) return onPick({ parent_id: null, folder_id: f.id || null });
    if (pages[0]) onPick({ parent_id: pages[0].id });
  };
  return (
    <Popover label="Move to" anchor={anchor} onClose={onClose} width={300}>
      <div className="docs-move-menu">
        <strong>Move to</strong>
        <p>{doc.title || "Untitled"}</p>
        <input
          className="docs-move-search"
          aria-label="Find a folder or page"
          placeholder="Find a folder or page…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            first();
          }}
        />
        {shownPlaces.map((f) => {
          const here = !doc.parent_id && (doc.folder_id ?? "") === f.id;
          return (
            <button
              key={`folder-${f.id}`}
              className={"doc-menu-item" + (here ? " is-active" : "")}
              disabled={busy || here}
              onClick={() =>
                onPick({ parent_id: null, folder_id: f.id || null })
              }
            >
              <FolderIcon size={16} />
              <span>{f.name}</span>
            </button>
          );
        })}
        {pages.length > 0 && <strong>Inside a page</strong>}
        {pages.slice(0, 40).map((d) => {
          const path = where(d);
          return (
            <button
              key={d.id}
              className={
                "doc-menu-item" + (doc.parent_id === d.id ? " is-active" : "")
              }
              disabled={busy || doc.parent_id === d.id}
              onClick={() => onPick({ parent_id: d.id })}
            >
              <FileText size={16} />
              <span>
                {d.title || "Untitled"}
                {path && <small className="docs-tree-path"> in {path}</small>}
              </span>
            </button>
          );
        })}
        {!shownPlaces.length && !pages.length && (
          <p className="muted">Nothing here is called that.</p>
        )}
      </div>
    </Popover>
  );
}

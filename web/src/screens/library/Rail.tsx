import {
  agendaGroups,
  docTree,
  canNest,
  treeRows,
  TRASH_DAYS,
  type DocSummary,
  type Folder,
} from "@orbyn/core";
import {
  Archive,
  Brain,
  CalendarDays,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Hourglass,
  Inbox,
  MoreHorizontal,
  NotebookPen,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { messageOf } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  Menu,
  useToast,
} from "../../ui/kit";
import { MoveDialog, type MoveTarget } from "./Move";
import { useUploads } from "./Uploads";
import { DOC_MIME, dragDoc } from "./drag";
import {
  canWriteDoc,
  createPage,
  goTo,
  libraryState,
  loadLibrary,
  setFolders,
  teamName,
  useLibraryState,
  type FixedKind,
  type Place,
} from "./store";

const OPEN_KEY = "orbyn-docs-tree";
function readOpen() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return new Set<string>(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set<string>();
  }
}

function useTreeOpen() {
  const [open, setOpen] = useState(readOpen);
  const toggle = useCallback((id: string, force?: boolean) => {
    setOpen((was) => {
      const next = new Set(was);
      if (force ?? !next.has(id)) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next].slice(-500)));
      } catch {
        // Which branches are open lasts this visit without storage.
      }
      return next;
    });
  }, []);
  return { open, toggle };
}

const samePlace = (a: Place, b: Place) =>
  JSON.stringify(a) === JSON.stringify(b);

export function Rail({
  fixedKind,
  openId,
  onChose,
}: {
  fixedKind?: FixedKind;
  openId: string | null;
  onChose: () => void;
}) {
  const { docs, folders, place, memory, agents, fading, teams } =
    useLibraryState();
  const uploads = useUploads();
  const tree = useTreeOpen();
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  const [moving, setMoving] = useState<DocSummary | null>(null);
  const [renaming, setRenaming] = useState<DocSummary | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const report = (failure: unknown, fallback: string) =>
    toast({ text: messageOf(failure, fallback), error: true });

  const everyPage = [...(docs ?? []), ...memory, ...agents];
  const pick = (next: Place) => {
    goTo(next);
    onChose();
    if (location.pathname !== "/app/docs") navigate("/app/docs");
  };
  const showFixed = (kind: FixedKind) => {
    onChose();
    navigate(kind === "memory" ? "/app/memory" : "/app/agent-notes");
  };
  const open = (id: string) => {
    onChose();
    navigate(`/app/doc/${id}`);
  };
  const nav = (
    label: string,
    Icon: LucideIcon,
    target: Place,
    extra?: { count?: number; title?: string },
  ) => {
    const here = !fixedKind && !openId && samePlace(place, target);
    return (
      <button
        type="button"
        className="lib-nav"
        aria-current={here ? "page" : undefined}
        title={extra?.title}
        onClick={() => pick(target)}
      >
        <Icon aria-hidden="true" />
        <span className="lib-nav-label">{label}</span>
        {!!extra?.count && <span className="lib-count">{extra.count}</span>}
      </button>
    );
  };

  const moveTo = async (doc: DocSummary, to: MoveTarget) => {
    try {
      await client.moveDoc(doc.id, to);
      if (to.parent_id) tree.toggle(to.parent_id, true);
      await loadLibrary();
      toast({ text: "Page moved." });
    } catch (failure) {
      report(failure, "Couldn't move this page.");
    }
  };
  const dropInto = (
    key: string,
    accept: (doc: DocSummary) => string | MoveTarget | null,
  ) => ({
    "data-drop": dropOn === key || undefined,
    onDragOver: (event: DragEvent) => {
      if (![...event.dataTransfer.types].includes(DOC_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropOn !== key) setDropOn(key);
    },
    onDragLeave: (event: DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null))
        return;
      setDropOn((was) => (was === key ? null : was));
    },
    onDrop: (event: DragEvent) => {
      setDropOn(null);
      const id = event.dataTransfer.getData(DOC_MIME);
      const doc = everyPage.find((one) => one.id === id);
      if (!doc) return;
      event.preventDefault();
      event.stopPropagation();
      if (!canWriteDoc(teams, doc.team_id)) return;
      const outcome = accept(doc);
      if (typeof outcome === "string") toast({ text: outcome, error: true });
      else if (outcome) void moveTo(doc, outcome);
    },
  });
  const folderDrop = (folder: Folder) =>
    dropInto(`folder:${folder.id}`, (doc) => {
      if ((doc.folder_id ?? "") === folder.id && !doc.parent_id) return null;
      if ((folder.team_id ?? null) !== (doc.team_id ?? null))
        return folder.team_id
          ? `Only the team's own pages can go in ${folder.name}.`
          : `${folder.name} is your own folder, so a team's page can't go in it.`;
      return { parent_id: null, folder_id: folder.id };
    });
  const newInside = async (parent: DocSummary) => {
    try {
      const kind =
        parent.kind === "memory" || parent.kind === "agent"
          ? parent.kind
          : "doc";
      const made = await createPage({
        kind,
        team_id: parent.team_id,
        parent_id: parent.id,
      });
      tree.toggle(parent.id, true);
      await loadLibrary();
      open(made.id);
    } catch (failure) {
      report(failure, "Couldn't create the page.");
    }
  };

  const pages = (list: DocSummary[], label: string): ReactNode => {
    if (!list.length) return null;
    const rows = treeRows(docTree(list), (id) => tree.open.has(id));
    return (
      <ul className="lib-tree" aria-label={label}>
        {rows.map(({ doc, depth, children, open: expanded }) => {
          const title = doc.title || "Untitled";
          const writable = canWriteDoc(teams, doc.team_id);
          return (
            <li
              key={doc.id}
              className="lib-branch"
              style={{ paddingInlineStart: depth * 14 }}
              {...dropInto(`page:${doc.id}`, (dragged) =>
                dragged.id !== doc.id && canNest(everyPage, dragged, doc)
                  ? { parent_id: doc.id }
                  : null,
              )}
            >
              {children ? (
                <button
                  type="button"
                  className="lib-twist"
                  aria-label={`${expanded ? "Close" : "Open"} the pages in ${title}`}
                  aria-expanded={expanded}
                  onClick={() => tree.toggle(doc.id)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              ) : (
                <span className="lib-twist" aria-hidden="true" />
              )}
              <button
                type="button"
                className="lib-leaf"
                draggable
                aria-current={doc.id === openId ? "page" : undefined}
                onDragStart={(event) => dragDoc(event, doc)}
                onClick={() => open(doc.id)}
                dir="auto"
              >
                {title}
              </button>
              {writable && (
                <Menu
                  label={`Actions for ${title}`}
                  trigger={(show, expanded2) => (
                    <IconButton
                      className="lib-leaf-more"
                      label={`More for ${title}`}
                      aria-expanded={expanded2}
                      onClick={show}
                    >
                      <MoreHorizontal />
                    </IconButton>
                  )}
                >
                  {(close) => (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          void newInside(doc);
                        }}
                      >
                        New page inside
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          setRenaming(doc);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          setMoving(doc);
                        }}
                      >
                        Move…
                      </button>
                    </>
                  )}
                </Menu>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const activeFolders = folders.filter((folder) => !folder.archived_at);
  const groups = [
    ...new Set(activeFolders.map((folder) => folder.team_id ?? "")),
  ].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0));
  const unfiled = (docs ?? []).filter(
    (doc) => !doc.folder_id && doc.kind !== "agenda",
  );
  const waiting =
    (docs ?? []).filter((doc) => doc.in_uploads).length +
    uploads.jobs.filter((job) =>
      ["waiting", "queued", "reading", "ocr", "failed"].includes(job.status),
    ).length;
  const agendas = agendaGroups(docs ?? []);
  const [agendaOpen, setAgendaOpen] = useState(false);
  useEffect(() => {
    if (place.at === "agenda") setAgendaOpen(true);
  }, [place.at]);

  if (fixedKind)
    return (
      <nav
        className="lib-rail"
        aria-label={fixedKind === "memory" ? "Memory" : "Agent notes"}
      >
        <div className="lib-rail-group">
          <button
            type="button"
            className="lib-nav"
            onClick={() => pick({ at: "all" })}
          >
            <FileText aria-hidden="true" />
            <span className="lib-nav-label">All documents</span>
          </button>
          <button
            type="button"
            className="lib-nav"
            aria-current={!openId ? "page" : undefined}
            onClick={() => showFixed(fixedKind)}
          >
            {fixedKind === "memory" ? (
              <Brain aria-hidden="true" />
            ) : (
              <NotebookPen aria-hidden="true" />
            )}
            <span className="lib-nav-label">
              {fixedKind === "memory" ? "Memory" : "Agent notes"}
            </span>
          </button>
        </div>
        <div className="lib-rail-group">
          {pages(fixedKind === "memory" ? memory : agents, "Notes") ?? (
            <p className="small muted lib-rail-note">No notes yet</p>
          )}
        </div>
        {moving && (
          <MoveDialog
            doc={moving}
            onClose={() => setMoving(null)}
            onMove={moveTo}
          />
        )}
        {renaming && (
          <RenamePage doc={renaming} onClose={() => setRenaming(null)} />
        )}
      </nav>
    );

  return (
    <nav className="lib-rail" aria-label="Document library">
      <div className="lib-rail-group">
        {nav("All documents", FileText, { at: "all" })}
        {nav("Favorites", Star, { at: "favorites" })}
        {nav(
          "Uploads",
          Inbox,
          { at: "uploads" },
          {
            count: waiting,
            title: "Imported PDFs, Word files and photos not filed yet",
          },
        )}
        {agendas.length > 0 && (
          <>
            <div className="lib-nav-row">
              {nav("Daily briefs", CalendarDays, { at: "agenda", month: null })}
              <button
                type="button"
                className="lib-twist"
                aria-label={agendaOpen ? "Hide months" : "Show months"}
                aria-expanded={agendaOpen}
                onClick={() => setAgendaOpen(!agendaOpen)}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
            {agendaOpen &&
              agendas.flatMap((year) =>
                year.months.map((month) => (
                  <button
                    key={month.key}
                    type="button"
                    className="lib-nav lib-nav-sub"
                    aria-current={
                      place.at === "agenda" && place.month === month.key
                        ? "page"
                        : undefined
                    }
                    onClick={() => pick({ at: "agenda", month: month.key })}
                  >
                    <span className="lib-nav-label">
                      {month.label} {year.year}
                    </span>
                  </button>
                )),
              )}
          </>
        )}
        {fading.size > 0 &&
          nav(
            "Might be out of date",
            Hourglass,
            { at: "fading" },
            {
              count: fading.size,
              title:
                "Pages nobody has changed or confirmed in three months or more",
            },
          )}
      </div>

      <div className="lib-rail-group">
        <div className="lib-rail-head">
          <h2 className="lib-rail-title">Folders</h2>
          <IconButton label="New folder" onClick={() => setNaming(true)}>
            <FolderPlus />
          </IconButton>
        </div>
        {groups.map((group) => {
          const inGroup = activeFolders.filter(
            (folder) => (folder.team_id ?? "") === group,
          );
          const name = group
            ? (teams.find((team) => team.id === group)?.name ??
              teamName(teams, {
                team_id: group,
                team_name: (docs ?? []).find((doc) => doc.team_id === group)
                  ?.team_name,
              }))
            : "Personal";
          const groupKey = `team-open:${group}`;
          const shown =
            !group ||
            tree.open.has(groupKey) ||
            (place.at === "folder" &&
              inGroup.some((folder) => folder.id === place.id));
          return (
            <div key={group || "personal"}>
              {groups.length > 1 &&
                (group ? (
                  <button
                    type="button"
                    className="lib-rail-scope"
                    aria-expanded={shown}
                    onClick={() => tree.toggle(groupKey)}
                  >
                    <ChevronRight aria-hidden="true" />{" "}
                    <span dir="auto">{name}</span>
                  </button>
                ) : (
                  <p className="lib-rail-scope">{name}</p>
                ))}
              {shown &&
                inGroup.map((folder) => {
                  const inside = (docs ?? []).filter(
                    (doc) =>
                      doc.folder_id === folder.id && doc.kind !== "agenda",
                  );
                  const openKey = `folder:${folder.id}`;
                  const expanded = tree.open.has(openKey);
                  return (
                    <div
                      key={folder.id}
                      {...folderDrop(folder)}
                      className="lib-drop-zone"
                    >
                      <div className="lib-nav-row">
                        <button
                          type="button"
                          className="lib-twist"
                          aria-label={`${expanded ? "Hide" : "Show"} pages in ${folder.name}`}
                          aria-expanded={expanded}
                          disabled={!inside.length}
                          onClick={() => tree.toggle(openKey)}
                        >
                          <ChevronRight aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="lib-nav"
                          aria-current={
                            !openId &&
                            place.at === "folder" &&
                            place.id === folder.id
                              ? "page"
                              : undefined
                          }
                          onClick={() => pick({ at: "folder", id: folder.id })}
                        >
                          <FolderIcon aria-hidden="true" />
                          <span className="lib-nav-label" dir="auto">
                            {folder.name}
                          </span>
                          {!!folder.doc_count && (
                            <span className="lib-count">
                              {folder.doc_count}
                            </span>
                          )}
                        </button>
                      </div>
                      {expanded && pages(inside, `Pages in ${folder.name}`)}
                    </div>
                  );
                })}
            </div>
          );
        })}
        <div
          className="lib-drop-zone"
          {...dropInto("unfiled", (doc) =>
            doc.folder_id || doc.parent_id
              ? { parent_id: null, folder_id: null }
              : null,
          )}
        >
          {nav(
            "Unfiled",
            FileText,
            { at: "unfiled" },
            { count: unfiled.length },
          )}
        </div>
      </div>

      <div className="lib-rail-group">
        <div
          className="lib-drop-zone"
          {...dropInto("memory", (doc) =>
            doc.kind !== "memory"
              ? "Only Memory notes go in Memory."
              : doc.parent_id
                ? { parent_id: null }
                : null,
          )}
        >
          <button
            type="button"
            className="lib-nav"
            onClick={() => showFixed("memory")}
          >
            <Brain aria-hidden="true" />
            <span className="lib-nav-label">Memory</span>
            {!!memory.length && (
              <span className="lib-count">{memory.length}</span>
            )}
          </button>
        </div>
        <div
          className="lib-drop-zone"
          {...dropInto("agent", (doc) =>
            doc.kind !== "agent"
              ? "Only Agent notes go in Agent notes."
              : doc.parent_id
                ? { parent_id: null }
                : null,
          )}
        >
          <button
            type="button"
            className="lib-nav"
            onClick={() => showFixed("agent")}
          >
            <Sparkles aria-hidden="true" />
            <span className="lib-nav-label">Agent notes</span>
            {!!agents.length && (
              <span className="lib-count">{agents.length}</span>
            )}
          </button>
        </div>
      </div>

      <div className="lib-rail-group">
        {nav(
          "Archived",
          Archive,
          { at: "archived" },
          {
            title: "Pages and folders kept out of the library and search",
          },
        )}
        {nav(
          "Trash",
          Trash2,
          { at: "trash" },
          {
            title: `Deleted pages, kept for ${TRASH_DAYS} days`,
          },
        )}
      </div>

      {naming && (
        <NewFolder
          onClose={() => setNaming(false)}
          onMade={(id) => pick({ at: "folder", id })}
        />
      )}
      {moving && (
        <MoveDialog
          doc={moving}
          onClose={() => setMoving(null)}
          onMove={moveTo}
        />
      )}
      {renaming && (
        <RenamePage doc={renaming} onClose={() => setRenaming(null)} />
      )}
    </nav>
  );
}

function NewFolder({
  onClose,
  onMade,
}: {
  onClose: () => void;
  onMade: (id: string) => void;
}) {
  const { teams } = useLibraryState();
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writable = teams.filter((one) => canWriteDoc(teams, one.id));
  return (
    <Dialog
      title="New folder"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="lib-new-folder"
            busy={busy}
            disabled={!name.trim()}
          >
            Create folder
          </Button>
        </>
      }
    >
      <form
        id="lib-new-folder"
        className="lib-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          setError("");
          client
            .createFolder({ name: name.trim(), team_id: team || null })
            .then(
              (folder) => {
                setFolders((all) => [...all, folder]);
                onClose();
                onMade(folder.id);
              },
              (failure) => {
                setError(messageOf(failure, "Couldn't create the folder."));
                setBusy(false);
              },
            );
        }}
      >
        <Field label="Folder name" error={error}>
          <Input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        {writable.length > 0 && (
          <Field label="Space">
            <select
              className="input"
              value={team}
              onChange={(event) => setTeam(event.currentTarget.value)}
            >
              <option value="">Personal</option>
              {writable.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </form>
    </Dialog>
  );
}

function RenamePage({
  doc,
  onClose,
}: {
  doc: DocSummary;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const full = await client.getDocForEditor(doc.id);
      await client.updateDocForEditor(doc.id, {
        title: title.trim(),
        document: full.document ?? { format: 1, blocks: full.content },
        version: full.version,
      });
      await loadLibrary();
      onClose();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't rename this page."));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Rename page"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!title.trim()}
            onClick={() => void submit()}
          >
            Rename
          </Button>
        </>
      }
    >
      <Field label="Title" error={error}>
        <Input
          autoFocus
          value={title}
          maxLength={200}
          dir="auto"
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && title.trim() && !busy) void submit();
          }}
        />
      </Field>
    </Dialog>
  );
}

export const libraryDocs = () => libraryState().docs ?? [];

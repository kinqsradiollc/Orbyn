import {
  agendaGroups,
  savedAgo,
  trashLeft,
  TRASH_DAYS,
  type DocSummary,
  type Tag,
  type TrashedDoc,
} from "@orbyn/core";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  FolderInput,
  Globe,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { messageOf } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  IconButton,
  Input,
  Loading,
  Menu,
  Pill,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { MakeCards } from "../study/MakeCards";
import { facets, KIND_LABEL, placeName, visibleDocs, when } from "./model";
import { MoveDialog, type MoveTarget } from "./Move";
import { PublishDialog } from "./page/Publish";
import { TemplatesDialog } from "./Templates";
import { ImportButton, UploadsPanel, useUploads } from "./Uploads";
import { AssistChips } from "./AssistChips";
import { dragDoc } from "./drag";
import {
  canWriteDoc,
  createPage,
  dropDoc,
  goTo,
  isStarred,
  loadLibrary,
  resetFilters,
  setFilters,
  setFolders,
  starDoc,
  teamName,
  useLibraryState,
  type FixedKind,
} from "./store";

export function Collection({
  fixedKind,
  railToggle,
}: {
  fixedKind?: FixedKind;
  railToggle: ReactNode;
}) {
  const state = useLibraryState();
  const { place, filters, folders, stars, fading, teams, memory, agents } =
    state;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lastPicked, setLastPicked] = useState<string | null>(null);
  const [moving, setMoving] = useState<{
    doc: DocSummary;
    many?: DocSummary[];
  } | null>(null);
  const [tagging, setTagging] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [cards, setCards] = useState<DocSummary | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const source: DocSummary[] | null = fixedKind
    ? fixedKind === "memory"
      ? memory
      : agents
    : state.docs;
  const effective = fixedKind ? ({ at: "all" } as const) : place;
  const { inView, ordered } = useMemo(
    () => visibleDocs(source ?? [], effective, filters, stars, fading),
    [source, effective, filters, stars, fading],
  );
  const { projects, spaces, tags } = useMemo(
    () => facets(source ?? [], inView, teams),
    [source, inView, teams],
  );
  useEffect(() => setPicked(new Set()), [place, fixedKind]);

  const folder =
    place.at === "folder"
      ? folders.find((one) => one.id === place.id)
      : undefined;
  const name = placeName(effective, fixedKind, folder?.name, state.docs ?? []);
  const report = (failure: unknown, fallback: string) =>
    toast({ text: messageOf(failure, fallback), error: true });

  const run = async (work: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      report(failure, fallback);
    } finally {
      setBusy(false);
    }
  };

  const create = (kind: "doc" | "note" | FixedKind) =>
    run(async () => {
      const made = await createPage({
        kind,
        folder_id: place.at === "folder" && !fixedKind ? place.id : null,
      });
      void loadLibrary();
      navigate(`/app/doc/${made.id}`);
    }, "Couldn't create the page.");

  const moveDoc = async (doc: DocSummary, to: MoveTarget) => {
    try {
      if (moving?.many) {
        const ids = moving.many.map((one) => one.id);
        const result = await client.bulkDocs({
          ids,
          folder_id: to.folder_id ?? null,
        });
        setPicked(new Set(result.skipped.map((row) => row.id)));
        toast({
          text: `Moved ${result.done.length} pages.${result.skipped.length ? ` ${result.skipped.length} couldn't be changed.` : ""}`,
        });
      } else {
        await client.moveDoc(doc.id, to);
        toast({ text: "Page moved." });
      }
      await loadLibrary();
    } catch (failure) {
      report(failure, "Couldn't move this page.");
    }
  };
  const moveToProject = async (doc: DocSummary, projectId: string) => {
    try {
      const full = await client.getDocForEditor(doc.id);
      await client.updateDocForEditor(doc.id, {
        version: full.version,
        document: full.document ?? { format: 1, blocks: full.content },
        project_id: projectId,
      });
      toast({ text: "Page moved to project." });
      await loadLibrary();
    } catch (failure) {
      report(failure, "Couldn't move this page.");
    }
  };

  const pick = (doc: DocSummary, run_: boolean) => {
    setPicked((was) => {
      const next = new Set(was);
      const list = ordered.map((one) => one.id);
      const from = lastPicked ? list.indexOf(lastPicked) : -1;
      const to = list.indexOf(doc.id);
      if (run_ && from !== -1 && to !== -1) {
        const [a, b] = from < to ? [from, to] : [to, from];
        list.slice(a, b + 1).forEach((id) => next.add(id));
      } else if (next.has(doc.id)) next.delete(doc.id);
      else next.add(doc.id);
      return next;
    });
    setLastPicked(doc.id);
  };
  const pickedDocs = ordered.filter((doc) => picked.has(doc.id));
  const bulkArchive = () =>
    run(async () => {
      const ids = [...picked];
      const result = await client.bulkDocs({ ids, archived: true });
      setPicked(new Set(result.skipped.map((row) => row.id)));
      await loadLibrary();
      toast({
        text: `${result.done.length} pages archived.${result.skipped.length ? ` ${result.skipped.length} couldn't be changed.` : ""}`,
        action: {
          label: "Undo",
          run: () =>
            void client.bulkDocs({ ids: result.done, archived: false }).then(
              () => loadLibrary(),
              (failure) => report(failure, "Couldn't restore those pages."),
            ),
        },
      });
    }, "Couldn't archive those pages.");
  const bulkTag = (tag: Tag) =>
    run(async () => {
      const result = await client.bulkDocs({
        ids: [...picked],
        tag_id: tag.id,
      });
      setPicked(new Set(result.skipped.map((row) => row.id)));
      setTagging(false);
      await loadLibrary();
      toast({
        text: `Tagged ${result.done.length} pages.${result.skipped.length ? ` ${result.skipped.length} couldn't be changed.` : ""}`,
      });
    }, "Couldn't tag those pages.");

  const archiveFolder = () =>
    folder &&
    run(async () => {
      const saved = await client.archiveFolder(folder.id, true);
      setFolders((all) =>
        all.map((one) =>
          one.id === folder.id
            ? { ...one, archived_at: saved.archived_at }
            : one,
        ),
      );
      goTo({ at: "all" });
      await loadLibrary();
      toast({ text: "Folder archived." });
    }, "Couldn't archive this folder.");

  const hasFilters = !!(
    filters.query ||
    filters.tag ||
    filters.project ||
    filters.scope ||
    filters.source ||
    filters.kind
  );
  const canCreate = effective.at !== "archived" && effective.at !== "trash";
  const selectedProject = projects.find(
    (project) => project.id === filters.project,
  );

  return (
    <div className="lib-collection">
      <div className="lib-head">
        {railToggle}
        <h1 className="lib-title" dir="auto">
          {name}
        </h1>
        {!fixedKind && canCreate && <ImportButtonInline />}
        {canCreate && (
          <div className="lib-primary">
            <Button
              variant="primary"
              disabled={busy}
              aria-label={
                fixedKind === "memory"
                  ? "New memory"
                  : fixedKind === "agent"
                    ? "New note"
                    : "New page"
              }
              onClick={() => void create(fixedKind ?? "doc")}
            >
              <Plus />
              <span className="lib-new-label">
                {fixedKind === "memory"
                  ? "New memory"
                  : fixedKind === "agent"
                    ? "New note"
                    : "New page"}
              </span>
            </Button>
            {!fixedKind && (
              <Menu
                label="Library options"
                trigger={(show, expanded) => (
                  <IconButton
                    label="Library options"
                    aria-expanded={expanded}
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
                        void create("note");
                      }}
                    >
                      <Plus aria-hidden="true" /> New note
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        setTemplates(true);
                      }}
                    >
                      <LayoutTemplate aria-hidden="true" /> From template
                    </button>
                    {folder && (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            close();
                            setPublishing(folder.id);
                          }}
                        >
                          <Globe aria-hidden="true" /> Publish folder
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            close();
                            void archiveFolder();
                          }}
                        >
                          <Archive aria-hidden="true" /> Archive folder
                        </button>
                      </>
                    )}
                  </>
                )}
              </Menu>
            )}
          </div>
        )}
      </div>

      {state.partial && (
        <ErrorNotice
          message={state.partial}
          onRetry={() => void loadLibrary()}
        />
      )}

      {effective.at === "archived" ? (
        <ArchivedList fixedKind={fixedKind} />
      ) : effective.at === "trash" ? (
        <TrashList />
      ) : (
        <>
          {effective.at === "uploads" && <UploadsPanel />}
          <div className="lib-tools">
            <label className="lib-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={filters.query}
                placeholder="Search titles, previews and file names"
                aria-label="Search document titles, previews and source filenames"
                onChange={(event) =>
                  setFilters({ query: event.currentTarget.value })
                }
              />
            </label>
            <select
              className="input lib-select"
              aria-label="Sort documents"
              value={filters.sort}
              onChange={(event) =>
                setFilters({ sort: event.currentTarget.value })
              }
            >
              <option value="recent">Last edited</option>
              <option value="created">Newest first</option>
              <option value="title">Title A to Z</option>
            </select>
            <Button
              variant={hasFilters ? "secondary" : "ghost"}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal /> Filters
            </Button>
          </div>
          {filtersOpen && (
            <div className="lib-filters">
              <select
                className="input lib-select"
                aria-label="Filter documents by project"
                value={filters.project}
                onChange={(event) =>
                  setFilters({ project: event.currentTarget.value })
                }
              >
                <option value="">All projects</option>
                <option value="none">Without a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.scope}
                  </option>
                ))}
              </select>
              {!fixedKind && (
                <select
                  className="input lib-select"
                  aria-label="Filter documents by type"
                  value={filters.kind}
                  onChange={(event) =>
                    setFilters({ kind: event.currentTarget.value })
                  }
                >
                  <option value="">All documents</option>
                  <option value="doc">Pages</option>
                  <option value="note">Notes</option>
                  <option value="meeting">Meeting notes</option>
                </select>
              )}
              <select
                className="input lib-select"
                aria-label="Filter documents by sharing scope"
                value={filters.scope}
                onChange={(event) =>
                  setFilters({ scope: event.currentTarget.value })
                }
              >
                <option value="">All accessible spaces</option>
                <option value="personal">Personal</option>
                {filters.scope &&
                  filters.scope !== "personal" &&
                  !spaces.some(([id]) => id === filters.scope) && (
                    <option value={filters.scope}>Team unavailable</option>
                  )}
                {spaces.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className="input lib-select"
                aria-label="Filter documents by source"
                value={filters.source}
                onChange={(event) =>
                  setFilters({ source: event.currentTarget.value })
                }
              >
                <option value="">All sources</option>
                <option value="imported">Imported material</option>
                <option value="original">With original file</option>
              </select>
              {tags.length > 0 && (
                <select
                  className="input lib-select"
                  aria-label="Show pages with a tag"
                  value={filters.tag}
                  onChange={(event) =>
                    setFilters({ tag: event.currentTarget.value })
                  }
                >
                  <option value="">All tags</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name} · {tag.scope}
                    </option>
                  ))}
                </select>
              )}
              {selectedProject && (
                <Button
                  variant="ghost"
                  onClick={() => navigate(`/app/project/${selectedProject.id}`)}
                >
                  <ArrowUpRight /> Open project
                </Button>
              )}
              {hasFilters && (
                <Button variant="ghost" onClick={resetFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          )}

          {state.failed && source === null ? (
            <ErrorNotice
              message={state.failed}
              onRetry={() => void loadLibrary()}
            />
          ) : source === null ? (
            <Loading label="Loading your documents" />
          ) : !ordered.length ? (
            <Empty
              title={
                hasFilters
                  ? `No matching ${fixedKind === "memory" ? "Memory notes" : fixedKind === "agent" ? "Agent notes" : "pages"}`
                  : "Nothing in here yet"
              }
            >
              {hasFilters ? (
                <Button variant="ghost" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : effective.at === "uploads" ? (
                <p className="small">
                  Files you import wait here until you file them.
                </p>
              ) : null}
            </Empty>
          ) : (
            <>
              {picked.size > 0 && (
                <div
                  className="lib-bulk"
                  role="toolbar"
                  aria-label="Picked pages"
                >
                  <span className="small">{picked.size} picked</span>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      pickedDocs[0] &&
                      setMoving({ doc: pickedDocs[0], many: pickedDocs })
                    }
                  >
                    <FolderInput /> Move
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setTagging(true)}
                  >
                    <TagIcon /> Tag
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void bulkArchive()}
                  >
                    <Archive /> Archive
                  </Button>
                  <IconButton
                    label="Clear the picked pages"
                    onClick={() => setPicked(new Set())}
                  >
                    <X />
                  </IconButton>
                </div>
              )}
              <Rows
                docs={ordered}
                agenda={effective.at === "agenda"}
                picked={picked}
                onPick={pick}
                onMove={(doc) => setMoving({ doc })}
                onCards={setCards}
                uploads={effective.at === "uploads"}
              />
            </>
          )}
        </>
      )}

      {moving && (
        <MoveDialog
          doc={moving.doc}
          many={moving.many}
          onClose={() => setMoving(null)}
          onMove={moveDoc}
          onProject={moveToProject}
        />
      )}
      {tagging && (
        <TagPicked onClose={() => setTagging(false)} onPick={bulkTag} />
      )}
      {templates && (
        <TemplatesDialog
          onClose={() => setTemplates(false)}
          folderId={place.at === "folder" ? place.id : null}
        />
      )}
      {publishing && (
        <PublishDialog
          kind="folder"
          id={publishing}
          title={folder?.name ?? ""}
          onClose={() => setPublishing(null)}
        />
      )}
      {cards && (
        <MakeCards
          docId={cards.id}
          title={cards.title || "Untitled"}
          onClose={() => setCards(null)}
        />
      )}
    </div>
  );
}

function ImportButtonInline() {
  useUploads();
  return (
    <span className="lib-import">
      <ImportButton variant="secondary" />
    </span>
  );
}

function Rows({
  docs,
  agenda,
  picked,
  onPick,
  onMove,
  onCards,
  uploads,
}: {
  docs: DocSummary[];
  agenda: boolean;
  picked: Set<string>;
  onPick: (doc: DocSummary, run: boolean) => void;
  onMove: (doc: DocSummary) => void;
  onCards: (doc: DocSummary) => void;
  uploads: boolean;
}) {
  const { folders, stars, teams, fading } = useLibraryState();
  const toast = useToast();
  const row = (doc: DocSummary) => {
    const title = doc.title || "Untitled";
    const writable = canWriteDoc(teams, doc.team_id);
    const star = isStarred(stars, doc.id);
    const folderName = folders.find(
      (folder) => folder.id === doc.folder_id,
    )?.name;
    const source = doc.imported_from?.file_name || doc.original?.file_name;
    return (
      <li
        key={doc.id}
        className="lib-row"
        data-picked={picked.has(doc.id) || undefined}
      >
        <input
          type="checkbox"
          className="lib-pick"
          aria-label={`Pick ${title}`}
          title="Pick (Shift-click picks a run)"
          checked={picked.has(doc.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            onPick(doc, (event.nativeEvent as MouseEvent).shiftKey)
          }
        />
        <a
          href={`/app/doc/${doc.id}`}
          className="lib-row-main"
          draggable
          onDragStart={(event) => dragDoc(event, doc)}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            navigate(`/app/doc/${doc.id}`);
          }}
        >
          <span className="lib-row-title" dir="auto">
            {title}
          </span>
          <span className="lib-row-preview small muted" dir="auto">
            {doc.preview || "Empty document"}
          </span>
          <span className="lib-row-meta">
            <span>{KIND_LABEL[doc.kind] ?? "Page"}</span>
            {(doc.kind !== "agenda" || doc.folder_id) && (
              <span dir="auto">{folderName || "Unfiled"}</span>
            )}
            <span dir="auto">
              {teamName(teams, doc)}
              {writable ? "" : " · Read only"}
            </span>
            {doc.project_id && (
              <span dir="auto">{doc.project_name || "Linked project"}</span>
            )}
            {source && <span dir="auto">Source: {source}</span>}
            {fading.has(doc.id) && <span>Might be out of date</span>}
            {doc.tags?.map((tag) => (
              <span key={tag.id} className="lib-tag">
                <i style={{ background: tag.color }} aria-hidden="true" />
                {tag.name}
              </span>
            ))}
          </span>
        </a>
        {uploads && (
          <span className="lib-row-assist">
            <AssistChips
              docId={doc.id}
              title={title}
              onCards={() => onCards(doc)}
            />
          </span>
        )}
        <time
          className="small muted lib-row-when"
          dateTime={doc.updated_at}
          title={savedAgo(doc.updated_at)}
        >
          {when(doc.updated_at)}
        </time>
        {writable && (
          <IconButton
            label={`Move ${title} to folder`}
            className="lib-row-act"
            onClick={() => onMove(doc)}
          >
            <FolderInput />
          </IconButton>
        )}
        <IconButton
          label={
            star
              ? `Remove ${title} from favorites`
              : `Add ${title} to favorites`
          }
          aria-pressed={star}
          className={`lib-row-act${star ? " is-on" : ""}`}
          onClick={() =>
            void starDoc(doc.id, !star).then(
              () =>
                toast({
                  text: star
                    ? "Page removed from favorites."
                    : "Page added to favorites.",
                }),
              (failure) =>
                toast({
                  text: messageOf(failure, "Couldn't change favorites."),
                  error: true,
                }),
            )
          }
        >
          <Star fill={star ? "currentColor" : "none"} />
        </IconButton>
      </li>
    );
  };
  if (agenda) {
    const groups = agendaGroups(docs).flatMap((year) =>
      year.months.flatMap((month) =>
        month.weeks.map((week, index) => ({
          key: week.key,
          month: index === 0 ? `${month.label} ${year.year}` : "",
          label: week.label,
          docs: week.docs,
        })),
      ),
    );
    return (
      <div>
        {groups.map((group) => (
          <section key={group.key} className="lib-week">
            {group.month && <h2>{group.month}</h2>}
            <h3 className="small muted">{group.label}</h3>
            <ul className="lib-rows">{group.docs.map(row)}</ul>
          </section>
        ))}
      </div>
    );
  }
  return (
    <ul className="lib-rows" aria-label="Documents">
      {docs.map(row)}
    </ul>
  );
}

function TagPicked({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (tag: Tag) => void;
}) {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    client.listTags().then(
      (list) => live && setTags(list),
      (failure) => live && setError(messageOf(failure, "Couldn't load tags.")),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const words = query.trim().toLocaleLowerCase();
  const shown = tags?.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(words),
  );
  return (
    <Dialog title="Add a tag" onClose={onClose}>
      <Input
        autoFocus
        aria-label="Find a tag"
        placeholder="Find a tag"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {error && (
        <ErrorNotice message={error} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {!tags && !error && <Loading label="Loading tags" />}
      <div className="lib-picklist">
        {shown?.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="row"
            onClick={() => onPick(tag)}
          >
            <span className="lib-tag">
              <i style={{ background: tag.color }} aria-hidden="true" />
              {tag.name}
            </span>
          </button>
        ))}
        {tags && !shown?.length && (
          <p className="small muted">No matching tags.</p>
        )}
      </div>
    </Dialog>
  );
}

function ArchivedList({ fixedKind }: { fixedKind?: FixedKind }) {
  const { folders } = useLibraryState();
  const toast = useToast();
  const [rows, setRows] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState("");
  const read = useRef(0);
  const load = useCallback(async () => {
    const id = ++read.current;
    setError("");
    try {
      const list = await client.listDocs({
        archived: "only",
        ...(fixedKind ? { kind: fixedKind } : {}),
      });
      if (id === read.current) setRows(list);
    } catch (failure) {
      if (id === read.current)
        setError(messageOf(failure, "Couldn't load archived pages."));
    }
  }, [fixedKind]);
  useEffect(() => void load(), [load]);
  const archived = folders.filter((folder) => folder.archived_at);
  const restoreDoc = (doc: DocSummary) =>
    client.archiveDoc(doc.id, false).then(
      () => {
        setRows((all) => all?.filter((one) => one.id !== doc.id) ?? all);
        toast({ text: "Page restored." });
        void loadLibrary();
      },
      (failure) =>
        toast({
          text: messageOf(failure, "Couldn't restore this page."),
          error: true,
        }),
    );
  const restoreFolder = (id: string) =>
    client.archiveFolder(id, false).then(
      () => {
        setFolders((all) =>
          all.map((one) =>
            one.id === id ? { ...one, archived_at: null } : one,
          ),
        );
        toast({ text: "Folder restored." });
        void load();
        void loadLibrary();
      },
      (failure) =>
        toast({
          text: messageOf(failure, "Couldn't restore this folder."),
          error: true,
        }),
    );
  if (error) return <ErrorNotice message={error} onRetry={() => void load()} />;
  if (!rows) return <Loading label="Loading archived pages" />;
  if (!rows.length && !archived.length)
    return (
      <Empty title="Nothing archived">
        <p className="small">Archived pages stay out of lists and search.</p>
      </Empty>
    );
  return (
    <ul className="lib-rows">
      {archived.map((folder) => (
        <li key={folder.id} className="lib-row">
          <div className="lib-row-main">
            <span className="lib-row-title" dir="auto">
              {folder.name}
            </span>
            <span className="small muted">
              Folder · {folder.doc_count} pages
            </span>
          </div>
          <Button variant="ghost" onClick={() => void restoreFolder(folder.id)}>
            <ArchiveRestore /> Restore
          </Button>
        </li>
      ))}
      {rows.map((doc) => (
        <li key={doc.id} className="lib-row">
          <a
            href={`/app/doc/${doc.id}`}
            className="lib-row-main"
            onClick={(event) => {
              event.preventDefault();
              navigate(`/app/doc/${doc.id}`);
            }}
          >
            <span className="lib-row-title" dir="auto">
              {doc.title || "Untitled"}
            </span>
            <span className="lib-row-preview small muted" dir="auto">
              {doc.preview || "Empty document"}
            </span>
          </a>
          <Button variant="ghost" onClick={() => void restoreDoc(doc)}>
            <ArchiveRestore /> Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}

function TrashList() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<TrashedDoc[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const read = useRef(0);
  const load = useCallback(async () => {
    const id = ++read.current;
    setError("");
    try {
      const list = await client.listTrash();
      if (id === read.current) setRows(list);
    } catch (failure) {
      if (id === read.current)
        setError(messageOf(failure, "Couldn't load Trash."));
    }
  }, []);
  useEffect(() => void load(), [load]);
  const restore = async (page: TrashedDoc) => {
    setBusy(true);
    try {
      const back = await client.restoreDoc(page.id);
      setRows((all) => all?.filter((one) => one.id !== page.id) ?? all);
      void loadLibrary();
      toast({
        text: "Page restored.",
        action: { label: "Open", run: () => navigate(`/app/doc/${back.id}`) },
      });
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't restore this page."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  const destroy = async (page: TrashedDoc) => {
    const ok = await confirm({
      title: "Delete page permanently?",
      body: `${page.title || "Untitled"} · Its history and comments are also deleted.`,
      action: "Delete permanently",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await client.deleteDocForever(page.id);
      setRows((all) => all?.filter((one) => one.id !== page.id) ?? all);
      dropDoc(page.id);
      toast({ text: "Page permanently deleted." });
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't delete this page."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  if (error) return <ErrorNotice message={error} onRetry={() => void load()} />;
  if (!rows) return <Loading label="Loading Trash" />;
  if (!rows.length)
    return (
      <Empty title="Trash is empty">
        <p className="small">Deleted pages stay here for {TRASH_DAYS} days.</p>
      </Empty>
    );
  return (
    <ul className="lib-rows" aria-label="Deleted pages">
      {rows.map((page) => (
        <li key={page.id} className="lib-row">
          <div className="lib-row-main">
            <span className="lib-row-title" dir="auto">
              {page.title || "Untitled"}
            </span>
            <span className="lib-row-preview small muted" dir="auto">
              {page.preview || "Empty document"}
            </span>
            <span className="lib-row-meta">
              <span>{trashLeft(page.purge_at)}</span>
              {page.team_name && <span dir="auto">{page.team_name}</span>}
              {page.deleted_by && (
                <span dir="auto">Deleted by {page.deleted_by}</span>
              )}
              {!page.can_restore && <Pill>Read only</Pill>}
            </span>
          </div>
          {page.can_restore && (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void restore(page)}
              >
                <RotateCcw /> Restore
              </Button>
              <IconButton
                label={`Delete ${page.title || "Untitled"} for good`}
                disabled={busy}
                onClick={() => void destroy(page)}
              >
                <Trash2 />
              </IconButton>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

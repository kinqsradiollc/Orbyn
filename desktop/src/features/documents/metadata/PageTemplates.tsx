import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../../hooks/useModalFocus";
import {
  ArrowLeft,
  FileText,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  addDays,
  blankDate,
  blanksIn,
  eventNoteFor,
  fillTitle,
  hasTeamPermission,
  localDateKey,
  seriesNoteFor,
  templateTodos,
  type CalendarEntry,
  type Doc,
  type EventNoteRef,
  type Folder,
  type PageTemplate,
  type Project,
  type Team,
} from "@orbyn/core";
import { client } from "../../../lib/api";
import { deviceTimeZone, errorText } from "../../planner/planning";
import { useConfirm } from "../../../components/Confirm";
import { Popover } from "../../../components/Popover";
import { Select } from "../../../components/Select";

const GROUPS = [
  ["personal", "Yours"],
  ["team", "Your teams'"],
  ["starter", "Starters"],
] as const;

/** What a template holds, in a few words, for its card. */
function summary(t: PageTemplate) {
  const todos = templateTodos(t.content);
  return [
    todos ? `${todos} to-do${todos === 1 ? "" : "s"}` : "",
    t.folder_name ? `Files in ${t.folder_name}` : "",
    t.tags.length ? t.tags.map((g) => `#${g.name}`).join(" ") : "",
    t.team_name ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One time of an event: a repeating one is the same event many times. */
const eventKey = (e: CalendarEntry) => `${e.item_id}|${e.start_at}`;

/** An event as a picker shows it: "Thu 24 Sept, 10:00 · Design sync". */
const eventLabel = (e: CalendarEntry) =>
  `${new Date(e.start_at).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}${
    e.all_day
      ? ""
      : `, ${new Date(e.start_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`
  } · ${e.title}`;

/** Which space a page goes in: "" for your own, or a team's id. */
type Space = string;

/**
 * Where a page from `t` goes to begin with: a team template's team, else
 * the team of the folder being looked at, else your own pages — only ever
 * a space you can write in.
 */
function startingSpace(
  t: PageTemplate,
  here: Folder | undefined,
  writable: Team[],
): Space {
  const can = (id: string | null | undefined) =>
    !!id && writable.some((team) => team.id === id);
  if (can(t.team_id)) return t.team_id!;
  if (can(here?.team_id)) return here!.team_id!;
  return "";
}

/**
 * Choose a template: pick one, name the page, and say where it goes.
 * Blanks ({date}, {title}, {project}, {event}) fill themselves in; a
 * template's to-do lines can become tasks in the project chosen. Any
 * template can start a page in your own space or a team's you can write in.
 */
export function PageTemplatesDialog({
  folders,
  folderId,
  onClose,
  onCreated,
}: {
  folders: Folder[];
  /** The folder being looked at, which a page goes in unless its template says. */
  folderId: string | null;
  onClose: () => void;
  /** The page made, what to say about it, and how many tasks it made. */
  onCreated: (doc: Doc, note: string, tasks: number) => void;
}) {
  const { ask } = useConfirm();
  const mutation = useRef(false);
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  const [picked, setPicked] = useState<PageTemplate | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<CalendarEntry[]>([]);
  const [title, setTitle] = useState("");
  /** Whether the title was typed, so choosing a project stops renaming it. */
  const [named, setNamed] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [eventId, setEventId] = useState("");
  const [folder, setFolder] = useState<string>("");
  const [makeTasks, setMakeTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Teams whose pages you can write: the other places a page can go. */
  const [teams, setTeams] = useState<Team[]>([]);
  const [space, setSpace] = useState<Space>("");
  /** The notes the listed events have, which open instead of a new page. */
  const [notes, setNotes] = useState<EventNoteRef[]>([]);
  const [menu, setMenu] = useState<DOMRect | null>(null);

  const request = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = async () => {
    const epoch = ++request.current;
    setLoadFailed(false);
    setError("");
    const today = localDateKey(new Date(), deviceTimeZone());
    try {
      const [nextTemplates, nextProjects, nextTeams, view] = await Promise.all([
        client.listPageTemplates(),
        client.listProjects(),
        client.listTeams(),
        client.calendar(
          new Date(`${addDays(today, -7)}T00:00:00`).toISOString(),
          new Date(`${addDays(today, 15)}T00:00:00`).toISOString(),
        ),
      ]);
      const listed = view.entries
        .filter((event) => event.kind === "event")
        .sort((a, b) => a.start_at.localeCompare(b.start_at));
      const nextNotes = listed.length
        ? await client.eventNotes(listed.map((event) => event.item_id))
        : [];
      if (epoch !== request.current) return;
      setTemplates(nextTemplates);
      setProjects(
        nextProjects.filter((project) => project.status === "active"),
      );
      setTeams(
        nextTeams.filter((team) => hasTeamPermission(team.role, "items:write")),
      );
      setEvents(listed);
      setNotes(nextNotes);
      setLoaded(true);
    } catch (reason) {
      if (epoch === request.current) {
        setLoadFailed(true);
        setError(errorText(reason));
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, []);

  const team = space || null;
  const inSpace = (x: { team_id?: string | null }) =>
    (x.team_id ?? null) === team;
  const event = events.find((e) => eventKey(e) === eventId && inSpace(e));
  /** Whether an event (this class of it) has a note, which opens instead. */
  const noted = (e: CalendarEntry) => !!eventNoteFor(notes, e);
  /** The note the chosen event already has: choosing it opens that note. */
  const opens = event ? eventNoteFor(notes, event) : undefined;
  /**
   * On one class of a repeating event, the note the whole series keeps
   * (a running note, or one written before classes had their own): the
   * class gets a page of its own, and this says the series' is still there.
   */
  const seriesNote = event && !opens ? seriesNoteFor(notes, event) : undefined;
  const project = projects.find((p) => p.id === projectId && inSpace(p));
  const usesEvent = picked ? blanksIn(picked).includes("event") : false;
  const todos = picked ? templateTodos(picked.content) : 0;
  const suggested = useMemo(
    () =>
      picked
        ? fillTitle(
            picked.title,
            {
              date: blankDate(
                event ? new Date(event.start_at) : new Date(),
                deviceTimeZone(),
              ),
              project: project?.name ?? "",
              event: event?.title ?? "",
            },
            picked.name,
          ) || picked.name
        : "",
    [picked, event, project],
  );
  useEffect(() => {
    if (!named) setTitle(suggested);
  }, [suggested, named]);

  /**
   * The folder a page starts in, in `to`: the template's own when it's
   * there, else the folder being looked at when it's there, else none.
   */
  const startingFolder = (t: PageTemplate, to: Space) => {
    const fits = (id: string | null | undefined) =>
      !!id && folders.some((f) => f.id === id && (f.team_id ?? "") === to);
    if (fits(t.folder_id)) return t.folder_id!;
    if (fits(folderId)) return folderId!;
    return "";
  };

  const choose = (t: PageTemplate) => {
    const to = startingSpace(
      t,
      folders.find((f) => f.id === folderId),
      teams,
    );
    setPicked(t);
    setNamed(false);
    setProjectId("");
    setEventId("");
    setMakeTasks(false);
    setSpace(to);
    setFolder(startingFolder(t, to));
    setError("");
  };

  /** Move the page to another space; choices from the old one go. */
  const moveTo = (to: Space) => {
    if (!picked) return;
    setSpace(to);
    setProjectId("");
    setEventId("");
    setMakeTasks(false);
    setFolder(startingFolder(picked, to));
  };

  const create = async () => {
    if (!picked || !loaded || loadFailed || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const { doc, tasks_created, existing } = await client.usePageTemplate(
        picked.id,
        {
          title: title.trim() || undefined,
          team_id: team,
          project_id: project?.id ?? null,
          event_id: event ? event.item_id : null,
          ...(event ? { event_at: event.start_at } : {}),
          ...(event?.occurrence ? { occurrence: event.occurrence } : {}),
          folder_id: folder || null,
          make_tasks: makeTasks,
        },
      );
      onCreated(
        doc,
        existing
          ? `“${event?.title ?? doc.title}” already has a note, so it's open.`
          : tasks_created
            ? `Made from ${picked.name}. ${tasks_created} to-do${tasks_created === 1 ? " is" : "s are"} now ${tasks_created === 1 ? "a task" : "tasks"}${project ? ` in ${project.name}` : ""}.`
            : `Made from ${picked.name}.`,
        tasks_created,
      );
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const remove = async (t: PageTemplate) => {
    if (mutation.current || !t.can_edit) return;
    mutation.current = true;
    setMenu(null);
    if (
      !(await ask({
        title: `Delete the template “${t.name}”?`,
        body: "Pages made from it stay as they are.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    ) {
      mutation.current = false;
      return;
    }
    setBusy(true);
    try {
      await client.deletePageTemplate(t.id);
      setPicked(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const sections = picked
    ? picked.content.flatMap((b) =>
        b.type === "heading" && b.text.trim() ? [b.text.trim()] : [],
      )
    : [];

  return (
    <TemplateDialog
      busy={busy}
      onClose={onClose}
      className="page-templates"
      labelledBy="page-templates-title"
    >
      <div className="section-heading">
        {picked && (
          <button
            className="icon-button"
            disabled={busy}
            aria-label="All templates"
            onClick={() => setPicked(null)}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <h2 id="page-templates-title">
          {picked ? picked.name : "Choose a template"}
        </h2>
        {picked?.can_edit && (
          <button
            className="icon-button"
            aria-label="Template options"
            title="Template options"
            aria-haspopup="menu"
            aria-expanded={!!menu}
            disabled={busy}
            onClick={(e) =>
              setMenu(menu ? null : e.currentTarget.getBoundingClientRect())
            }
          >
            <MoreHorizontal size={18} />
          </button>
        )}
        <button
          className="icon-button"
          disabled={busy}
          aria-label="Close"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {menu && picked && (
        <Popover
          anchor={menu}
          label="Template options"
          onClose={() => setMenu(null)}
          width={220}
        >
          <div className="doc-menu" role="menu">
            <button
              className="doc-menu-item is-danger"
              role="menuitem"
              onClick={() => void remove(picked)}
            >
              <Trash2 size={15} aria-hidden="true" /> Delete template
            </button>
          </div>
        </Popover>
      )}
      <div className="page-templates-body">
        {error && (
          <div className="error" role="alert">
            {error}
            {loadFailed && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void load()}
              >
                Retry
              </button>
            )}
          </div>
        )}
        {!picked && loaded && templates?.length === 0 && (
          <p className="muted">No templates yet.</p>
        )}
        {!picked ? (
          templates === null ? (
            !loadFailed && (
              <p className="muted" role="status">
                Loading templates…
              </p>
            )
          ) : (
            GROUPS.map(([source, label]) => {
              const list = templates.filter((t) => t.source === source);
              if (!list.length) return null;
              return (
                <section key={source} className="page-templates-group">
                  <h3>{label}</h3>
                  <ul className="page-templates-list">
                    {list.map((t) => (
                      <li key={t.id}>
                        <button
                          className="page-template-card"
                          onClick={() => choose(t)}
                        >
                          <LayoutTemplate size={16} aria-hidden="true" />
                          <span>
                            <strong>{t.name}</strong>
                            {t.description && <small>{t.description}</small>}
                            {summary(t) && (
                              <small className="page-template-meta">
                                {summary(t)}
                              </small>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )
        ) : (
          <form
            className="page-template-form"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <fieldset
              disabled={busy || !loaded || loadFailed}
              className="page-template-fields"
            >
              {sections.length > 0 && !opens && (
                <p className="muted page-template-sections">
                  {sections.join(" · ")}
                </p>
              )}
              {!opens && (
                <label>
                  Title
                  <input
                    value={title}
                    maxLength={200}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setNamed(true);
                    }}
                  />
                </label>
              )}
              {teams.length > 0 && (
                <label>
                  Where
                  <Select
                    value={space}
                    onChange={(e) => moveTo(e.target.value)}
                  >
                    <option value="">Your pages</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {!opens && (
                <label>
                  Project
                  <Select
                    value={project?.id ?? ""}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      if (!e.target.value) setMakeTasks(false);
                    }}
                  >
                    <option value="">None</option>
                    {projects.filter(inSpace).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {usesEvent && (
                <label>
                  Event
                  <Select
                    value={event ? eventKey(event) : ""}
                    onChange={(e) => setEventId(e.target.value)}
                  >
                    <option value="">None</option>
                    {events.filter(inSpace).map((e) => (
                      <option key={eventKey(e)} value={eventKey(e)}>
                        {eventLabel(e)}
                        {noted(e) ? " · has a note" : ""}
                      </option>
                    ))}
                  </Select>
                  {opens && (
                    <small className="field-hint page-template-noted">
                      <FileText size={13} aria-hidden="true" /> This event
                      already has a note
                      {event?.occurrence ? " for this day" : ""}, “
                      {opens.title || "Untitled"}”. It opens instead of a new
                      page.
                    </small>
                  )}
                  {seriesNote && (
                    <small className="field-hint page-template-noted">
                      <FileText size={13} aria-hidden="true" /> The series has a
                      note of its own too, “{seriesNote.title || "Untitled"}”.
                      This page is for this day.
                    </small>
                  )}
                </label>
              )}
              {!opens && (
                <label>
                  Folder
                  <Select
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                  >
                    <option value="">Unfiled</option>
                    {folders
                      .filter((f) => (f.team_id ?? "") === space)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </Select>
                </label>
              )}
              {todos > 0 && !opens && (
                <label className="switch-line">
                  <input
                    type="checkbox"
                    role="switch"
                    className="ai-switch"
                    checked={makeTasks}
                    onChange={(e) => setMakeTasks(e.target.checked)}
                  />
                  <span>
                    Create {todos} task{todos === 1 ? "" : "s"}
                    <small>
                      {project
                        ? `In ${project.name}. Ticking one on the page ticks the task.`
                        : `In your tasks. Choose a project to put ${todos === 1 ? "it" : "them"} there.`}
                    </small>
                  </span>
                </label>
              )}
              {picked.tags.length > 0 && !opens && (
                <p className="muted page-template-sections">
                  Tagged {picked.tags.map((g) => `#${g.name}`).join(" ")}
                </p>
              )}
              <div className="confirm-actions">
                {opens ? (
                  <button type="submit" className="primary" disabled={busy}>
                    <FileText size={15} aria-hidden="true" /> Open note
                  </button>
                ) : (
                  <button type="submit" className="primary" disabled={busy}>
                    <Plus size={15} aria-hidden="true" /> Create page
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        )}
      </div>
    </TemplateDialog>
  );
}

/**
 * Save the open page as a template. It's kept where the page lives — a team
 * page makes a template for the team — with its folder and tags, and every
 * box unticked. Blanks typed into the page fill in when it's used. Someone
 * who can only read a team's pages keeps a template of their own.
 */
export function SaveTemplateDialog({
  doc,
  canShare,
  onClose,
  onSaved,
}: {
  doc: Pick<Doc, "id" | "title" | "team_id" | "team_name">;
  /** Whether a team page's template may be the team's (you can write there). */
  canShare: boolean;
  onClose: () => void;
  onSaved: (t: PageTemplate) => void;
}) {
  const mutation = useRef(false);
  const [name, setName] = useState(doc.title || "");
  const [personal, setPersonal] = useState(!canShare);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await client.savePageAsTemplate(doc.id, {
          name: name.trim() || undefined,
          personal,
        }),
      );
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  return (
    <TemplateDialog
      busy={busy}
      onClose={onClose}
      labelledBy="save-template-title"
    >
      <div className="section-heading">
        <h2 id="save-template-title">Save as template</h2>
        <button
          className="icon-button"
          disabled={busy}
          aria-label="Close"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <form
        className="save-template-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="page-template-fields">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <label>
            Name
            <input
              autoFocus
              value={name}
              maxLength={120}
              placeholder="Untitled"
              onChange={(e) => setName(e.target.value)}
            />
            <details>
              <summary>Template placeholders</summary>
              <p className="field-hint">
                Use {"{date}"}, {"{title}"}, {"{project}"} or {"{event}"} for
                values filled when creating a page.
              </p>
            </details>
          </label>
          {doc.team_id && canShare && (
            <label className="switch-line">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={!personal}
                onChange={(e) => setPersonal(!e.target.checked)}
              />
              <span>
                Share with {doc.team_name ?? "the team"}
                <small>Everyone on the team can start pages from it.</small>
              </span>
            </label>
          )}
          {doc.team_id && !canShare && (
            <p className="muted page-template-sections">
              Saved to your templates. You have read-only access to{" "}
              {doc.team_name ?? "this team"}.
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              Save template
            </button>
          </div>
        </fieldset>
      </form>
    </TemplateDialog>
  );
}

function TemplateDialog({
  busy,
  onClose,
  className = "",
  labelledBy,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  className?: string;
  labelledBy: string;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      data-modal-owner={focus.id}
      className={`modal ${className}`}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}

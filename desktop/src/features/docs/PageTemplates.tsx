import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LayoutTemplate, Plus, Trash2, X } from "lucide-react";
import {
  addDays,
  blankDate,
  blanksIn,
  fillTitle,
  localDateKey,
  templateTodos,
  type CalendarEntry,
  type Doc,
  type Folder,
  type PageTemplate,
  type Project,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { deviceTimeZone, errorText } from "../../lib/planning";
import { useConfirm } from "../../components/Confirm";
import { Select } from "../../components/Select";

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

/**
 * New page from a template: pick one, name the page, and say where it goes.
 * Blanks ({date}, {title}, {project}, {event}) fill themselves in; a
 * template's to-do lines can become tasks in the project chosen.
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
  const root = useRef<HTMLDivElement>(null);
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

  const load = () =>
    client.listPageTemplates().then(setTemplates, (e) => {
      setTemplates([]);
      setError(errorText(e));
    });
  useEffect(() => {
    void load();
    client.listProjects().then(
      (all) => setProjects(all.filter((p) => p.status === "active")),
      () => setProjects([]),
    );
    const tz = deviceTimeZone();
    const today = localDateKey(new Date(), tz);
    client
      .calendar(
        new Date(`${addDays(today, -7)}T00:00:00`).toISOString(),
        new Date(`${addDays(today, 15)}T00:00:00`).toISOString(),
      )
      .then(
        (view) =>
          setEvents(
            view.entries
              .filter((e) => e.kind === "event")
              .sort((a, b) => a.start_at.localeCompare(b.start_at)),
          ),
        () => setEvents([]),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A template's pages live where it does: yours, or its team's.
  const space = picked?.team_id ?? null;
  const event = events.find(
    (e) => eventKey(e) === eventId && e.team_id === space,
  );
  const project = projects.find((p) => p.id === projectId);
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

  const choose = (t: PageTemplate) => {
    setPicked(t);
    setNamed(false);
    setProjectId("");
    setEventId("");
    setMakeTasks(false);
    const here = folders.find((f) => f.id === folderId);
    setFolder(
      t.folder_id ??
        (here && (here.team_id ?? null) === (t.team_id ?? null) ? here.id : ""),
    );
    setError("");
  };

  const create = async () => {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const { doc, tasks_created } = await client.usePageTemplate(picked.id, {
        title: title.trim() || undefined,
        project_id: projectId || null,
        event_id: event ? event.item_id : null,
        ...(event ? { event_at: event.start_at } : {}),
        folder_id: folder || null,
        make_tasks: makeTasks,
      });
      onCreated(
        doc,
        tasks_created
          ? `Made from ${picked.name}. ${tasks_created} to-do${tasks_created === 1 ? " is" : "s are"} now ${tasks_created === 1 ? "a task" : "tasks"}${project ? ` in ${project.name}` : ""}.`
          : `Made from ${picked.name}.`,
        tasks_created,
      );
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: PageTemplate) => {
    if (
      !(await ask({
        title: `Delete the template “${t.name}”?`,
        body: "Pages made from it stay as they are.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await client.deletePageTemplate(t.id);
      setPicked(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sections = picked
    ? picked.content.flatMap((b) =>
        b.type === "heading" && b.text.trim() ? [b.text.trim()] : [],
      )
    : [];

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={root}
        className="modal page-templates"
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-templates-title"
      >
        <div className="section-heading">
          {picked && (
            <button
              className="icon-button"
              aria-label="All templates"
              onClick={() => setPicked(null)}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h2 id="page-templates-title">
            {picked ? picked.name : "New page from a template"}
          </h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="page-templates-body">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {!picked ? (
            templates === null ? (
              <p className="muted">Loading…</p>
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
              {sections.length > 0 && (
                <p className="muted page-template-sections">
                  {sections.join(" · ")}
                </p>
              )}
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
              <label>
                Project
                <Select
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    if (!e.target.value) setMakeTasks(false);
                  }}
                >
                  <option value="">None</option>
                  {projects
                    .filter((p) => (p.team_id ?? null) === space)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              </label>
              {usesEvent && (
                <label>
                  Event
                  <Select
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                  >
                    <option value="">None</option>
                    {events
                      .filter((e) => e.team_id === space)
                      .map((e) => (
                        <option key={eventKey(e)} value={eventKey(e)}>
                          {eventLabel(e)}
                        </option>
                      ))}
                  </Select>
                </label>
              )}
              <label>
                Folder
                <Select
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                >
                  <option value="">Unfiled</option>
                  {folders
                    .filter((f) => (f.team_id ?? null) === space)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </Select>
              </label>
              {todos > 0 && (
                <label className="switch-line">
                  <input
                    type="checkbox"
                    role="switch"
                    className="ai-switch"
                    checked={makeTasks}
                    onChange={(e) => setMakeTasks(e.target.checked)}
                  />
                  <span>
                    Make its {todos} to-do{todos === 1 ? "" : "s"}{" "}
                    {todos === 1 ? "a task" : "tasks"}
                    <small>
                      {project
                        ? `In ${project.name}. Ticking one on the page ticks the task.`
                        : `In your tasks. Choose a project to put ${todos === 1 ? "it" : "them"} there.`}
                    </small>
                  </span>
                </label>
              )}
              {picked.tags.length > 0 && (
                <p className="muted page-template-sections">
                  Tagged {picked.tags.map((g) => `#${g.name}`).join(" ")}
                </p>
              )}
              <div className="confirm-actions">
                {picked.can_edit && (
                  <button
                    type="button"
                    className="text-button page-template-delete"
                    disabled={busy}
                    onClick={() => void remove(picked)}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Delete template
                  </button>
                )}
                <button type="submit" className="primary" disabled={busy}>
                  <Plus size={15} aria-hidden="true" /> Create page
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Save the open page as a template. It's kept where the page lives — a team
 * page makes a template for the team — with its folder and tags, and every
 * box unticked. Blanks typed into the page fill in when it's used.
 */
export function SaveTemplateDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: Pick<Doc, "id" | "title" | "team_id" | "team_name">;
  onClose: () => void;
  onSaved: (t: PageTemplate) => void;
}) {
  const [name, setName] = useState(doc.title || "");
  const [personal, setPersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
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
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
      >
        <div className="section-heading">
          <h2 id="save-template-title">Save as template</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
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
            <small className="field-hint">
              Blanks like {"{date}"}, {"{title}"}, {"{project}"} and {"{event}"}{" "}
              in the page fill themselves in each time it's used.
            </small>
          </label>
          {doc.team_id && (
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
          <div className="confirm-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              Save template
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

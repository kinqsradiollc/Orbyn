import { PageCommandScope, preparePageLeave } from "../../app/page-commands";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useContext, useEffect, useRef, useState } from "react";
import { onLive } from "../../lib/live";
import { Boxes, LayoutTemplate, Plus, Search } from "lucide-react";
import {
  projectProgress,
  isClosed,
  statusLabels,
  dateLabel,
  searchProjects,
  hasTeamPermission,
  type Item,
  type Project,
  type Plan,
  type Team,
} from "@orbyn/core";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { ProjectDetail } from "./ProjectDetail";
import { PromiseTracker } from "./PromiseTracker";
import { TemplatesDialog } from "./TemplatesDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { newTabClick, openInNewTab } from "../../app/tabs";
import "./projects.css";

const dueLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
    : "No deadline";

export function ProjectsView({
  items,
  teams = [],
  openTemplate = null,
  initialProjectId = null,
  initialSection = null,
  initialSourceId = null,
  onInitialProjectShown,
  onTemplateOpened,
  openProject = null,
  onProjectOpened,
  report,
  onRefresh,
  onOpenItem,
  onOpenNote,
  onOpenPlan,
  onAskProject,
  userId,
  startNew,
  onShown,
}: {
  items: Item[];
  /** For starting a template's project in a team. */
  teams?: Team[];
  /** Open Templates on this one (from a "ready to start" notice). */
  openTemplate?: string | null;
  /** Open this project directly from a task or page. */
  initialProjectId?: string | null;
  initialSection?: "decisions" | "history" | null;
  initialSourceId?: string | null;
  onInitialProjectShown?: () => void;
  onTemplateOpened?: () => void;
  /** Open this project straight away (from a link, /app/project/<id>). */
  openProject?: string | null;
  onProjectOpened?: () => void;
  report: (e: unknown) => void;
  onRefresh: () => void;
  onOpenItem: (item: Item) => void;
  /** Opens one of a project's notes in the documents view. */
  onOpenNote?: (docId: string, blockId?: string | null) => void;
  onOpenPlan: (plan: Plan) => void;
  onAskProject?: (project: Project, question?: string, chatId?: string) => void;
  userId: string;
  /** Changes to start a new project (from ⌘K). */
  startNew?: number;
  /** The project open now (null: the list), for the app's tabs. */
  onShown?: (project: Project | null) => void;
}) {
  const { ref: paneRef, width: paneWidth } = useElementWidth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const commandScope = useContext(PageCommandScope);
  const departing = useRef(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const visibleProjects = searchProjects(projects ?? [], libraryQuery);
  const [open, setOpen] = useState<Project | null>(null);
  const [openSection, setOpenSection] = useState<
    "home" | "decisions" | "history"
  >("home");
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  // Say which project is open whenever it (or its name) changes; the list
  // showing first, before anything opened, is not news.
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current && !open) return;
    shown.current = true;
    onShown?.(open);
  }, [open?.id, open?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [openingError, setOpeningError] = useState("");
  const mounted = useRef(false);
  const owner = useRef(session.get());
  const readSequence = useRef(0);
  const openSequence = useRef(0);
  const current = () => mounted.current && owner.current === session.get();
  const openById = async (id: string) => {
    if (!current()) return;
    const request = ++openSequence.current;
    setBusy(true);
    setOpeningError("");
    try {
      const project = await client.getProject(id);
      if (!current() || request !== openSequence.current) return;
      setOpen(project);
    } catch (e) {
      if (current() && request === openSequence.current) {
        setOpeningError(errorText(e));
        // Recoverable reads belong to this surface; authentication still ends the session.
        if ((e as { status?: number }).status === 401) report(e);
      }
    } finally {
      if (current() && request === openSequence.current) setBusy(false);
    }
  };
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState(!!openTemplate);
  const [initialTemplate] = useState(openTemplate);
  useEffect(() => {
    if (!openTemplate) return;
    setTemplates(true);
    onTemplateOpened?.();
  }, [openTemplate, onTemplateOpened]);

  useEffect(() => {
    if (startNew) {
      setOpen(null);
      setCreating(true);
    }
  }, [startNew]);

  const load = async () => {
    const request = ++readSequence.current;
    setLoadError("");
    try {
      const next = await client.listProjects();
      if (current() && request === readSequence.current) setProjects(next);
    } catch (e) {
      if (current() && request === readSequence.current) {
        setLoadError(errorText(e));
        if ((e as { status?: number }).status === 401) report(e);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    // Projects changed elsewhere (another device, a teammate, or a
    // connected agent): read them again, once for a burst of changes.
    let soon: ReturnType<typeof setTimeout> | undefined;
    const stop = onLive((news) => {
      if (
        news.kind !== "changed" ||
        (news.area &&
          news.area !== "projects" &&
          news.area !== "templates" &&
          news.area !== "records")
      )
        return;
      clearTimeout(soon);
      soon = setTimeout(() => void load(), 400);
    });
    return () => {
      mounted.current = false;
      clearTimeout(soon);
      stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!initialProjectId) return;
    setOpenSection(initialSection ?? "home");
    setOpenSourceId(initialSourceId);
    void openById(initialProjectId).then(() => {
      if (current()) onInitialProjectShown?.();
    });
  }, [initialProjectId, initialSection, initialSourceId]);

  useEffect(() => {
    if (!openProject) return;
    void openById(openProject).then(() => {
      if (current()) onProjectOpened?.();
    });
  }, [openProject]);

  if (open)
    return (
      <ProjectDetail
        project={open}
        initialSection={openSection}
        initialSourceId={openSourceId}
        userId={userId}
        canWrite={
          !open.team_id ||
          hasTeamPermission(
            teams.find((team) => team.id === open.team_id)?.role,
            "items:write",
          )
        }
        canManageAi={
          open.team_id
            ? ["owner", "admin"].includes(
                teams.find((team) => team.id === open.team_id)?.role ?? "",
              )
            : open.user_id === userId
        }
        items={items}
        report={report}
        onOpenItem={onOpenItem}
        onOpenNote={onOpenNote}
        onOpenPlan={onOpenPlan}
        onAskProject={onAskProject}
        onBack={() => {
          if (departing.current || !current()) return;
          const target = open.id;
          departing.current = true;
          void (async () => {
            try {
              if (!(await preparePageLeave(commandScope)) || !current()) return;
              setOpen((page) => (page?.id === target ? null : page));
              void load();
            } finally {
              departing.current = false;
            }
          })();
        }}
        onChanged={(p) => {
          setOpen(p);
          void load();
        }}
        onDeleted={() => {
          setOpen(null);
          void load();
        }}
        onItemsChanged={() => {
          onRefresh();
          void load();
        }}
      />
    );

  return (
    <div
      ref={paneRef}
      className={
        "projects-view" +
        (paneWidth > 0 && paneWidth < 600 ? " is-compact" : "")
      }
    >
      <div className="projects-head">
        <span className="muted projects-count">
          {projects === null
            ? ""
            : libraryQuery.trim()
              ? `${visibleProjects.length} of ${projects.length} projects`
              : projects.length === 1
                ? "1 project"
                : `${projects.length} projects`}
        </span>
        <span className="projects-actions">
          <button className="secondary" onClick={() => setTemplates(true)}>
            <LayoutTemplate size={15} /> Templates
          </button>
          <button
            className="primary"
            onClick={() => setCreating(true)}
            disabled={busy}
          >
            <Plus size={15} /> New project
          </button>
        </span>
      </div>
      {creating && (
        <NewProjectDialog
          teams={teams}
          items={items}
          report={report}
          onClose={() => setCreating(false)}
          onTemplates={() => {
            setCreating(false);
            setTemplates(true);
          }}
          onCreated={(project) => {
            void load();
            onRefresh();
            if (project) {
              setCreating(false);
              setOpenSection("home");
              setOpenSourceId(null);
              setOpen(project);
            }
          }}
        />
      )}
      {templates && (
        <TemplatesDialog
          teams={teams}
          initialId={openTemplate ?? initialTemplate}
          onClose={() => setTemplates(false)}
          onStarted={() => {
            onRefresh();
            void load();
          }}
        />
      )}

      <PromiseTracker
        userId={userId}
        teams={teams}
        report={report}
        onProject={(id) => void openById(id)}
      />

      {!!projects?.length && (
        <label className="projects-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search projects</span>
          <input
            type="search"
            placeholder="Search projects"
            maxLength={200}
            value={libraryQuery}
            onChange={(event) => setLibraryQuery(event.target.value)}
          />
        </label>
      )}
      {openingError && <p role="alert">{openingError}</p>}
      {busy && (
        <p role="status" className="muted">
          Opening project…
        </p>
      )}
      {loadError && (
        <div role="alert">
          <p>{loadError}</p>
          <button className="secondary" onClick={() => void load()}>
            Retry projects
          </button>
        </div>
      )}
      {projects === null ? (
        !loadError && <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No projects yet"
          body="Add a project to organize related tasks."
        >
          <button
            className="primary"
            onClick={() => setCreating(true)}
            disabled={busy}
          >
            <Plus size={15} /> New project
          </button>
        </EmptyState>
      ) : visibleProjects.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching projects"
          body="Try a different name, alias or workspace."
        />
      ) : (
        <ul className="project-grid">
          {visibleProjects.map((p) => {
            const percent = projectProgress(p);
            const work = items.filter(
              (item) =>
                item.project_id === p.id &&
                item.kind === "task" &&
                !isClosed(item.status),
            );
            const next = [...work].sort(
              (a, b) =>
                Number(b.status === "blocked") -
                  Number(a.status === "blocked") ||
                Number(b.status === "in_progress") -
                  Number(a.status === "in_progress") ||
                (a.due_at ? Date.parse(a.due_at) : Infinity) -
                  (b.due_at ? Date.parse(b.due_at) : Infinity) ||
                a.title.localeCompare(b.title),
            )[0];
            const nearest = work
              .filter((item) => item.due_at)
              .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))[0];
            return (
              <li key={p.id} className="project-card">
                <div className="project-card-main">
                  <button
                    className="project-open"
                    {...newTabClick(
                      () => void openById(p.id),
                      () =>
                        openInNewTab({
                          kind: "project",
                          id: p.id,
                          title: p.name,
                        }),
                    )}
                  >
                    <strong>{p.name}</strong>
                  </button>
                  <small className="project-workspace">
                    {p.team_name ||
                      (p.team_id
                        ? teams.find((team) => team.id === p.team_id)?.name ||
                          "Shared"
                        : "Personal")}
                    {p.status !== "active"
                      ? ` · ${p.status === "done" ? "Completed" : "Archived"}`
                      : ""}
                  </small>
                  {p.summary && (
                    <details className="project-brief">
                      <summary>Project brief</summary>
                      <p>{p.summary}</p>
                    </details>
                  )}
                </div>
                <div className="project-next-action">
                  <small className="muted">
                    {next?.status === "blocked"
                      ? "Needs a decision"
                      : "Next action"}
                  </small>
                  {next ? (
                    <button
                      className="project-task-link"
                      onClick={() => onOpenItem(next)}
                    >
                      {next.title}
                    </button>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() => void openById(p.id)}
                    >
                      {p.task_count > p.done_count
                        ? "Choose the next task"
                        : "Open project"}
                    </button>
                  )}
                  {next && (
                    <small
                      className={
                        next.status === "blocked" ? "project-blocker" : "muted"
                      }
                    >
                      {statusLabels[next.status]}
                    </small>
                  )}
                </div>
                <div className="project-card-status">
                  <span className="project-deadline">
                    {p.deadline
                      ? `Project due ${dueLabel(p.deadline)}`
                      : nearest?.due_at
                        ? `Task due ${dateLabel(nearest.due_at)}`
                        : "No deadline"}
                  </span>
                  <span className="project-card-foot">
                    <span>
                      {p.done_count} of {p.task_count} tasks done
                    </span>
                  </span>
                  {p.task_count > 0 && (
                    <span
                      className="project-bar"
                      aria-label={`${Math.round(percent)}% of tasks completed`}
                    >
                      <i style={{ width: `${percent}%` }} />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import {
  dateLabel,
  isClosed,
  projectProgress,
  searchProjects,
  statusLabels,
  type Item,
  type Project,
} from "@orbyn/core";
import { LayoutTemplate, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "../../app/account";
import { useResource } from "../../lib/resource";
import { navigate, useSearch, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, Empty, ErrorNotice, Loading } from "../../ui/kit";
import { onNews } from "../calendar/useWorkspace";
import { tasks, useItems, usePlanning } from "../shared-task";
import { NewProject } from "./NewProject";
import { Promises } from "./Promises";
import { shortDate } from "./shared";
import { Templates } from "./Templates";

const open = (id: string) => navigate(`/app/project/${id}`);

function PortfolioRow({
  project: p,
  items,
  teamName,
}: {
  project: Project;
  items: Item[];
  teamName: string;
}) {
  const percent = projectProgress(p);
  const work = items.filter(
    (i) => i.project_id === p.id && i.kind === "task" && !isClosed(i.status),
  );
  const next = [...work].sort(
    (a, b) =>
      Number(b.status === "blocked") - Number(a.status === "blocked") ||
      Number(b.status === "in_progress") - Number(a.status === "in_progress") ||
      (a.due_at ? Date.parse(a.due_at) : Infinity) -
        (b.due_at ? Date.parse(b.due_at) : Infinity) ||
      a.title.localeCompare(b.title),
  )[0];
  const nearest = work
    .filter((i) => i.due_at)
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))[0];
  return (
    <li className="pj-row" role="row">
      <div className="pj-cell-name" role="cell">
        <a
          className="pj-name"
          dir="auto"
          href={`/app/project/${p.id}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault();
              tasks.peek({ kind: "project", id: p.id });
              return;
            }
            if (event.shiftKey) return;
            event.preventDefault();
            open(p.id);
          }}
        >
          {p.name}
        </a>
        <small>
          {teamName}
          {p.status !== "active"
            ? ` · ${p.status === "done" ? "Completed" : "Archived"}`
            : ""}
        </small>
        {p.summary && (
          <details>
            <summary>Project brief</summary>
            <p dir="auto">{p.summary}</p>
          </details>
        )}
      </div>
      <div className="pj-cell-next" role="cell">
        <small className={next?.status === "blocked" ? "pj-late" : undefined}>
          {next?.status === "blocked" ? "Needs a decision" : "Next action"}
        </small>
        {next ? (
          <button
            className="pj-link"
            dir="auto"
            onClick={() => tasks.open(next)}
          >
            {next.title}
          </button>
        ) : (
          <button className="pj-link is-quiet" onClick={() => open(p.id)}>
            {p.task_count > p.done_count
              ? "Choose the next task"
              : "Open project"}
          </button>
        )}
        {next && next.status !== "todo" && (
          <small>{statusLabels[next.status]}</small>
        )}
      </div>
      <div className="pj-cell-when" role="cell">
        <span>
          {p.deadline
            ? `Project due ${shortDate(p.deadline)}`
            : nearest?.due_at
              ? `Task due ${dateLabel(nearest.due_at)}`
              : "No deadline"}
        </span>
      </div>
      <div className="pj-cell-done" role="cell">
        <span>
          {p.done_count} of {p.task_count} tasks done
        </span>
        {p.task_count > 0 && (
          <span
            className="pj-meter"
            role="img"
            aria-label={`${Math.round(percent)}% of tasks completed`}
          >
            <i style={{ width: `${percent}%` }} />
          </span>
        )}
      </div>
    </li>
  );
}

/** Every project, aligned for comparison, leading with what to do next. */
export function Portfolio() {
  useTitle("Projects");
  const { user } = useAccount();
  const items = useItems();
  const { teams } = usePlanning();
  const search = useSearch();
  const projects = useResource(() => client.listProjects(), [user?.id]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<{ id: string | null } | null>(
    null,
  );
  const asked = useRef("");
  useEffect(() => {
    if (asked.current === search) return;
    asked.current = search;
    const params = new URLSearchParams(search);
    const template = params.get("template");
    if (template) setTemplates({ id: template });
    if (params.has("new")) setCreating(true);
    if (template || params.has("new")) navigate("/app/projects", true);
  }, [search]);
  const reload = useRef(projects.reload);
  reload.current = projects.reload;
  useEffect(() => {
    let soon: ReturnType<typeof setTimeout> | undefined;
    const stop = onNews((news) => {
      if (news.kind !== "changed") return;
      if (
        news.area &&
        !["projects", "templates", "records"].includes(news.area)
      )
        return;
      clearTimeout(soon);
      soon = setTimeout(() => void reload.current(), 400);
    });
    return () => {
      clearTimeout(soon);
      stop();
    };
  }, []);
  const list = useMemo(() => projects.data ?? [], [projects.data]);
  const visible = searchProjects(list, query);
  const teamName = (p: Project) =>
    p.team_name ||
    (p.team_id
      ? teams.find((t) => t.id === p.team_id)?.name || "Shared"
      : "Personal");
  return (
    <div className="pj">
      <header className="pj-head">
        <h1>Projects</h1>
        <span className="muted small pj-count">
          {!projects.data
            ? ""
            : query.trim()
              ? `${visible.length} of ${list.length} projects`
              : list.length === 1
                ? "1 project"
                : `${list.length} projects`}
        </span>
        {list.length > 0 && (
          <label className="pj-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Search projects</span>
            <input
              type="search"
              placeholder="Search projects"
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        <span className="pj-head-gap" />
        <Button onClick={() => setTemplates({ id: null })}>
          <LayoutTemplate aria-hidden="true" /> Templates
        </Button>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" /> New project
        </Button>
      </header>
      {user && <Promises userId={user.id} teams={teams} />}
      {projects.error && (
        <ErrorNotice
          message={projects.error}
          onRetry={() => void projects.reload()}
        />
      )}
      {projects.loading && !projects.data && (
        <Loading label="Loading projects" />
      )}
      {projects.data && !list.length && (
        <Empty title="No projects yet">
          <span>Add a project to organize related tasks.</span>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> New project
          </Button>
        </Empty>
      )}
      {list.length > 0 && !visible.length && (
        <Empty title="No matching projects">
          <span>Try a different name, alias or workspace.</span>
        </Empty>
      )}
      {visible.length > 0 && (
        <div role="table" aria-label="Projects">
          <div className="pj-row pj-row-head" role="row">
            <span role="columnheader">Project</span>
            <span role="columnheader">Next</span>
            <span role="columnheader">Date</span>
            <span role="columnheader">Done</span>
          </div>
          <ul className="pj-rows" role="rowgroup">
            {visible.map((project) => (
              <PortfolioRow
                key={project.id}
                project={project}
                items={items}
                teamName={teamName(project)}
              />
            ))}
          </ul>
        </div>
      )}
      {creating && (
        <NewProject
          onClose={() => setCreating(false)}
          onTemplates={(id) => {
            setCreating(false);
            setTemplates({ id: id ?? null });
          }}
          onCreated={(project) => {
            void projects.reload();
            if (project) {
              setCreating(false);
              open(project.id);
            }
          }}
        />
      )}
      {templates && (
        <Templates
          initialId={templates.id}
          onClose={() => setTemplates(null)}
          onStarted={() => void projects.reload()}
        />
      )}
    </div>
  );
}

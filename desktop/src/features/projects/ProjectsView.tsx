import { useEffect, useState } from "react";
import { Boxes, Plus } from "lucide-react";
import {
  projectAtRisk,
  projectProgress,
  type Item,
  type Project,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { ProjectDetail } from "./ProjectDetail";
import "./projects.css";

const dueLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
    : "No deadline";

export function ProjectsView({
  items,
  report,
  onRefresh,
  onOpenItem,
}: {
  items: Item[];
  report: (e: unknown) => void;
  onRefresh: () => void;
  onOpenItem: (item: Item) => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    client.listProjects().then(setProjects, (e) => {
      setProjects([]);
      report(e);
    });

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => {
    const name = prompt("What is this project called?")?.trim();
    if (!name) return;
    setBusy(true);
    client
      .createProject({ name })
      .then((p) => {
        setOpen(p);
        void load();
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  if (open)
    return (
      <ProjectDetail
        project={open}
        items={items}
        report={report}
        onOpenItem={onOpenItem}
        onBack={() => {
          setOpen(null);
          void load();
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
    <div className="projects-view">
      <div className="projects-head">
        <span className="muted projects-count">
          {projects === null
            ? ""
            : projects.length === 1
              ? "1 project"
              : `${projects.length} projects`}
        </span>
        <button className="primary" onClick={create} disabled={busy}>
          <Plus size={15} /> New project
        </button>
      </div>

      {projects === null ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No projects yet"
          body="Group related tasks into stages so you can see a piece of work end to end, not just today's list."
        >
          <button className="primary" onClick={create} disabled={busy}>
            <Plus size={15} /> New project
          </button>
        </EmptyState>
      ) : (
        <ul className="project-grid">
          {projects.map((p) => {
            const percent = projectProgress(p);
            const risk = projectAtRisk(p);
            return (
              <li key={p.id}>
                <button
                  className="project-card"
                  onClick={() =>
                    client.getProject(p.id).then(setOpen).catch(report)
                  }
                >
                  <span className="project-card-top">
                    <strong>{p.name}</strong>
                    {risk && <span className="chip chip-warn">At risk</span>}
                  </span>
                  {p.summary && <small className="muted">{p.summary}</small>}
                  <span className="project-bar" aria-hidden="true">
                    <i style={{ width: `${percent}%` }} />
                  </span>
                  <span className="project-card-foot">
                    <span>
                      {p.done_count} of {p.task_count} done
                    </span>
                    <span>{dueLabel(p.deadline)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

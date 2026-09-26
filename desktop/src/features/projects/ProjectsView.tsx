import { useEffect, useState } from "react";
import { Boxes, LayoutTemplate, Plus } from "lucide-react";
import {
  projectAtRisk,
  projectProgress,
  hasTeamPermission,
  type Item,
  type Project,
  type Plan,
  type Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { ProjectDetail } from "./ProjectDetail";
import { PromiseTracker } from "./PromiseTracker";
import { TemplatesDialog } from "./TemplatesDialog";
import { NewProjectDialog } from "./NewProjectDialog";
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
  report,
  onRefresh,
  onOpenItem,
  onOpenNote,
  onOpenPlan,
  onAskProject,
  userId,
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
  report: (e: unknown) => void;
  onRefresh: () => void;
  onOpenItem: (item: Item) => void;
  /** Opens one of a project's notes in the documents view. */
  onOpenNote?: (docId: string, blockId?: string | null) => void;
  onOpenPlan: (plan: Plan) => void;
  onAskProject?: (project: Project, question?: string) => void;
  userId: string;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState<Project | null>(null);
  const [openSection, setOpenSection] = useState<
    "home" | "decisions" | "history"
  >("home");
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState(!!openTemplate);
  const [initialTemplate] = useState(openTemplate);
  useEffect(() => {
    if (!openTemplate) return;
    setTemplates(true);
    onTemplateOpened?.();
  }, [openTemplate, onTemplateOpened]);

  const load = () =>
    client.listProjects().then(setProjects, (e) => {
      setProjects([]);
      report(e);
    });

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!initialProjectId) return;
    void client.getProject(initialProjectId).then((project) => {
      setOpenSection(initialSection ?? "home");
      setOpenSourceId(initialSourceId);
      setOpen(project);
      onInitialProjectShown?.();
    }, report);
  }, [initialProjectId, initialSection, initialSourceId, report]);

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
        items={items}
        report={report}
        onOpenItem={onOpenItem}
        onOpenNote={onOpenNote}
        onOpenPlan={onOpenPlan}
        onAskProject={onAskProject}
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
        onProject={(id) =>
          void client.getProject(id).then(setOpen).catch(report)
        }
      />

      {projects === null ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No projects yet"
          body="Group related tasks into stages so you can see a piece of work end to end, not just today's list."
        >
          <button
            className="primary"
            onClick={() => setCreating(true)}
            disabled={busy}
          >
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

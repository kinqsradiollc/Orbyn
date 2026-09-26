import { useEffect, useState } from "react";
import { ArrowUpRight, Boxes, FileText, GraduationCap } from "lucide-react";
import {
  projectProgress,
  type Doc,
  type DocSummary,
  type Project,
  type StudyOverview,
} from "@orbyn/core";
import { client } from "../../lib/api";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * The rest of the workspace, on the page people land on: the projects that are
 * moving and the documents they touched last. It stays out of the way until
 * there is something to show, so a planner-only workspace looks unchanged.
 */
export function WorkspaceStrip({
  onOpenDoc,
  onOpenProject,
  onNavigate,
}: {
  onOpenDoc: (doc: Doc) => void;
  onOpenProject: (id: string) => void;
  onNavigate: (view: "Projects" | "Docs" | "Study") => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [study, setStudy] = useState<StudyOverview | null>(null);

  useEffect(() => {
    void client.listProjects().then(
      (all) =>
        setProjects(all.filter((p) => p.status === "active").slice(0, 3)),
      () => setProjects([]),
    );
    void client.listDocs().then(
      (all) => setDocs(all.filter((d) => d.kind !== "agenda").slice(0, 4)),
      () => setDocs([]),
    );
    void client.study().then(setStudy, () => setStudy(null));
  }, []);

  const studying = !!study?.decks.length;
  if (!projects.length && !docs.length && !studying) return null;

  return (
    <div className="workspace-strip">
      {projects.length > 0 && (
        <section className="card">
          <h2>
            <Boxes size={17} aria-hidden="true" /> Projects
            <button
              className="text-button strip-more"
              onClick={() => onNavigate("Projects")}
            >
              All projects <ArrowUpRight size={13} />
            </button>
          </h2>
          <ul className="strip-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  className="strip-row"
                  onClick={() => onOpenProject(p.id)}
                >
                  <span className="strip-main">
                    <strong>{p.name}</strong>
                    <small>
                      {p.done_count} of {p.task_count} done
                    </small>
                  </span>
                  <span className="project-bar strip-bar" aria-hidden="true">
                    <i style={{ width: `${projectProgress(p)}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {studying && study && (
        <section className="card">
          <h2>
            <GraduationCap size={17} aria-hidden="true" /> Study
            <button
              className="text-button strip-more"
              onClick={() => onNavigate("Study")}
            >
              Open Study <ArrowUpRight size={13} />
            </button>
          </h2>
          <ul className="strip-list">
            <li>
              <button className="strip-row" onClick={() => onNavigate("Study")}>
                <span className="strip-main">
                  <strong>
                    {study.due_today + study.new_cards
                      ? `${study.due_today + study.new_cards} card${study.due_today + study.new_cards === 1 ? "" : "s"} to review`
                      : "All caught up"}
                  </strong>
                  <small>
                    {study.streak
                      ? `${study.streak}-day streak`
                      : "Review a few today to start a streak"}
                  </small>
                </span>
              </button>
            </li>
            {study.exams.slice(0, 2).map((e) => (
              <li key={e.key}>
                <button
                  className="strip-row"
                  onClick={() => onNavigate("Study")}
                >
                  <span className="strip-main">
                    <strong>{e.title}</strong>
                    <small>
                      in {e.days_left} day{e.days_left === 1 ? "" : "s"}
                      {e.readiness != null
                        ? ` · ${Math.round(e.readiness * 100)}% known well`
                        : ""}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {docs.length > 0 && (
        <section className="card">
          <h2>
            <FileText size={17} aria-hidden="true" /> Documents
            <button
              className="text-button strip-more"
              onClick={() => onNavigate("Docs")}
            >
              All documents <ArrowUpRight size={13} />
            </button>
          </h2>
          <ul className="strip-list">
            {docs.map((d) => (
              <li key={d.id}>
                <button
                  className="strip-row"
                  onClick={() =>
                    void client
                      .getDoc(d.id)
                      .then(onOpenDoc)
                      .catch(() => onNavigate("Docs"))
                  }
                >
                  <span className="strip-main">
                    <strong>{d.title || "Untitled"}</strong>
                    <small>{d.preview || "Empty document"}</small>
                  </span>
                  <span className="strip-when">{when(d.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

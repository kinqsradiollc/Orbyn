import { Select } from "../../components/Select";
import { ProjectNotes } from "./ProjectNotes";
import { ProjectRecords } from "./ProjectRecords";
import { ProjectTimeMachine } from "./ProjectTimeMachine";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarRange,
  Columns3,
  History,
  List,
  Plus,
  Ellipsis,
  Trash2,
  Sparkles,
  X,
} from "lucide-react";
import {
  activityOriginLabel,
  changeProjectDeadline,
  projectDeadlineParts,
  projectPlanStatus,
  projectProgress,
  projectTimeline,
  projectReentry,
  deadlineOf,
  shortMinutes,
  snippetRuns,
  type Item,
  type ProjectActivity,
  type Project,
  type ProjectLink,
  type ProjectPlanning,
  type ProjectStage,
  type Plan,
  type ProjectSession,
  type DocSummary,
  type WorkRecord,
  type SearchHit,
  type Look,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Timeline } from "./Timeline";
import { ProjectMilestones } from "./ProjectMilestones";
import { DateField } from "../../components/DateField";
import { ShareLinkButton } from "../../components/ShareButton";
import { useToast } from "../../components/Toast";
import { copyLink } from "../../lib/links";
import { deviceTimeZone } from "../../lib/planning";
import { ImportButton, useImports } from "../docs/Uploads";
import { FieldsPanel } from "../views/FieldsPanel";
import { ConnectionsMap } from "../connections/ConnectionsMap";
import { StarButton } from "../../components/StarButton";
import { LinkedHere } from "../docs/DocLinks";
import { AliasesField } from "../docs/AliasesField";
import { Cover, LookDialog, LookIcon } from "../../components/Look";

/** "Fri 16 Oct", or "Fri 16 Oct, 5 pm" with the time. */
function dayLabel(iso: string, withTime = false) {
  const at = new Date(iso);
  const day = at.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (!withTime) return day;
  const time = at
    .toLocaleTimeString([], {
      hour: "numeric",
      minute: at.getMinutes() ? "2-digit" : undefined,
    })
    .toLowerCase();
  return `${day}, ${time}`;
}

const HISTORY_FIELDS: Record<string, string> = {
  name: "Name",
  summary: "Summary",
  status: "Status",
  deadline: "Deadline",
  title: "Title",
  due_at: "Due date",
  progress: "Progress",
  stage_id: "Stage",
  version: "Document version",
  position: "Order",
  start_at: "Starts",
  due_on: "Date",
  done: "Done",
  assistant_off: "Assistant",
};

function historyValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (key === "progress") return `${value}%`;
  if (key === "assistant_off") return value ? "Kept out" : "Can read it";
  if (key === "done") return value ? "Yes" : "No";
  if (key === "due_on")
    return new Date(`${String(value)}T12:00:00`).toLocaleDateString([], {
      dateStyle: "medium",
    });
  if (key === "deadline" || key === "due_at" || key === "start_at") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime()))
      return date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });
  }
  if (key === "stage_id") return "Stage changed";
  return String(value);
}

function historyDiff(event: ProjectActivity) {
  const before = event.before_state ?? {};
  const after = event.after_state ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) =>
        HISTORY_FIELDS[key] &&
        !(before[key] == null && after[key] == null) &&
        before[key] !== after[key],
    )
    .map((key) => ({
      label: HISTORY_FIELDS[key],
      from: historyValue(key, before[key]),
      to: historyValue(key, after[key]),
    }));
}

/** Tasks that sit in this project, grouped by stage with the unfiled last. */
function group(items: Item[], project: Project) {
  const mine = items.filter((i) => i.project_id === project.id);
  const byStage = new Map<string | null, Item[]>();
  for (const stage of project.stages) byStage.set(stage.id, []);
  byStage.set(null, []);
  for (const item of mine) {
    const key =
      item.stage_id && byStage.has(item.stage_id) ? item.stage_id : null;
    byStage.get(key)!.push(item);
  }
  return byStage;
}

export function ProjectDetail({
  project,
  initialSection = "home",
  initialSourceId = null,
  items,
  report,
  onBack,
  onChanged,
  onDeleted,
  onItemsChanged,
  onOpenItem,
  onOpenNote,
  onOpenPlan,
  onAskProject,
  userId,
  canWrite,
  canManageAi = false,
}: {
  project: Project;
  initialSection?: "home" | "decisions" | "history";
  initialSourceId?: string | null;
  items: Item[];
  report: (e: unknown) => void;
  onBack: () => void;
  onChanged: (p: Project) => void;
  onDeleted: () => void;
  onItemsChanged: () => void;
  onOpenItem: (item: Item) => void;
  /** Opens a note of this project's in the documents view. */
  onOpenNote?: (docId: string, blockId?: string | null) => void;
  onOpenPlan: (plan: Plan) => void;
  onAskProject?: (project: Project, question?: string) => void;
  userId: string;
  canWrite: boolean;
  /** Owners and admins (the owner, for a personal project): keep it out of the assistant. */
  canManageAi?: boolean;
}) {
  const { ask, tell } = useConfirm();
  const toast = useToast();
  // Opened: it leads the quick switcher's recent list, on every device.
  useEffect(() => {
    void client.recordRecent("project", project.id).catch(() => {});
  }, [project.id]);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The ⋯ menu's Cover and icon dialog (W6). */
  const [lookOpen, setLookOpen] = useState(false);
  const saveLook = async (look: Look) => {
    const before: Look = {
      cover_file_id: project.cover_file_id ?? null,
      icon: project.icon ?? null,
    };
    onChanged(await client.updateProject(project.id, look));
    toast({
      text: "Cover and icon saved",
      action: {
        label: "Undo",
        run: () =>
          void client.updateProject(project.id, before).then(onChanged, report),
      },
    });
  };
  /** Unassigned team tasks ticked to claim with "Plan this project". */
  const [claiming, setClaiming] = useState<string[]>([]);
  /** The ⋯ menu's Rename or Summary & brief dialog, with what's typed. */
  const [editing, setEditing] = useState<{
    kind: "rename" | "summary";
    text: string;
  } | null>(null);
  const [mode, setMode] = useState<
    "home" | "list" | "board" | "timeline" | "notes" | "decisions" | "history"
  >(initialSection);
  const [activity, setActivity] = useState<ProjectActivity[] | null>(null);
  useEffect(() => {
    if (initialSection === "history")
      client.projectActivity(project.id).then(setActivity).catch(report);
  }, [initialSection, project.id, report]);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [reentry, setReentry] = useState<ReturnType<
    typeof projectReentry
  > | null>(null);
  // "Explain what changed" needs the assistant; "Draft an update" also
  // needs a provider that can use tools (drafting a page is one).
  const [assistant, setAssistant] = useState({ enabled: false, tools: false });
  useEffect(() => {
    let live = true;
    client.aiCapabilities().then(
      (capabilities) => {
        if (live) setAssistant(capabilities);
      },
      () => {
        if (live) setAssistant({ enabled: false, tools: false });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const [planning, setPlanning] = useState<ProjectPlanning | null>(null);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [homeNotes, setHomeNotes] = useState<DocSummary[]>([]);
  const [homeRecords, setHomeRecords] = useState<WorkRecord[]>([]);
  const [homeLinks, setHomeLinks] = useState<ProjectLink[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchRecords, setSearchRecords] = useState<SearchHit[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  useEffect(() => {
    setSearchQuery("");
    setSearchHits([]);
    setSearchRecords([]);
  }, [project.id]);
  const imports = useImports(
    report,
    () =>
      void client
        .listDocs({ project: project.id })
        .then(setHomeNotes)
        .catch(report),
    project.id,
    project.team_id,
  );
  /** The task being dragged across the board, if any. */
  const [dragging, setDragging] = useState<string | null>(null);
  const grouped = useMemo(() => group(items, project), [items, project]);
  const homeTasks = items
    .filter(
      (item) =>
        item.project_id === project.id &&
        item.kind === "task" &&
        item.status !== "done" &&
        item.status !== "cancelled",
    )
    .sort(
      (a, b) =>
        Date.parse(deadlineOf(a) ?? project.deadline ?? "9999-12-31") -
        Date.parse(deadlineOf(b) ?? project.deadline ?? "9999-12-31"),
    )
    .slice(0, 5);
  const homeSessions = sessions
    .filter(
      (session) =>
        Date.parse(session.start_at) >= Date.now() &&
        Date.parse(session.start_at) < Date.now() + 7 * 86_400_000,
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 7);
  const openQuestions = homeRecords.filter(
    (record) =>
      record.status === "open" &&
      ((record.kind === "decision" && !record.linked_item_id) ||
        (record.kind === "promise" &&
          record.due_at &&
          Date.parse(record.due_at) < Date.now() + 7 * 86_400_000)),
  );
  const unassigned = items.filter(
    (item) =>
      item.project_id === project.id &&
      item.team_id === project.team_id &&
      item.kind === "task" &&
      item.status !== "done" &&
      item.status !== "cancelled" &&
      !item.assignee_id,
  );
  const percent = projectProgress(project);
  // Only tasks in the project's own space can be filed into it.
  const unfiledPool = items.filter(
    (i) =>
      !i.project_id &&
      i.kind === "task" &&
      (i.team_id ?? null) === (project.team_id ?? null),
  );

  useEffect(() => {
    let active = true;
    setLastSeen(null);
    setReentry(null);
    Promise.all([
      client.visitProject(project.id),
      client.projectActivity(project.id),
    ])
      .then(([visit, rows]) => {
        if (!active) return;
        setLastSeen(visit.since_at);
        setReentry(
          visit.since_at
            ? projectReentry(
                rows.filter((row) => row.created_at > visit.since_at!),
              )
            : null,
        );
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setPlanning(null);
    client.projectPlanning(project.id).then(
      (summary) => {
        if (active) setPlanning(summary);
      },
      (error) => {
        if (active) report(error);
      },
    );
    return () => {
      active = false;
    };
  }, [project.id, project.deadline, items]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== "timeline" && mode !== "home") return;
    let active = true;
    client.projectSessions(project.id).then(
      (rows) => {
        if (active) setSessions(rows);
      },
      (error) => {
        if (active) report(error);
      },
    );
    return () => {
      active = false;
    };
  }, [mode, project.id, items]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== "home") return;
    let active = true;
    setHomeNotes([]);
    setHomeRecords([]);
    setHomeLinks([]);
    Promise.all([
      client.listDocs({ project: project.id }),
      client.listWorkRecords({ project_id: project.id }),
      client.listProjectLinks(project.id),
    ]).then(
      ([notes, records, links]) => {
        if (active) {
          setHomeNotes(notes);
          setHomeRecords(records);
          setHomeLinks(links);
        }
      },
      (error) => {
        if (active) report(error);
      },
    );
    return () => {
      active = false;
    };
  }, [mode, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchRecords([]);
      return;
    }
    setSearchHits([]);
    setSearchRecords([]);
    setSearchIndex(0);
    let active = true;
    const timer = setTimeout(() => {
      // One server search: pages, tasks and the project's decisions.
      client.search(q, { project: project.id, limit: 30 }).then(
        (hits) => {
          if (!active) return;
          setSearchHits(hits.filter((hit) => hit.type !== "record"));
          setSearchRecords(
            hits.filter(
              (hit) => hit.type === "record" && hit.kind === "decision",
            ),
          );
          setSearchIndex(0);
        },
        (error) => {
          if (active) report(error);
        },
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSearchHit = (hit: SearchHit) => {
    if (hit.type === "doc") onOpenNote?.(hit.id, hit.block_id);
    else if (hit.type === "record") setMode("decisions");
    else {
      const item = items.find((task) => task.id === hit.id);
      if (item) onOpenItem(item);
    }
  };
  const searchTasks = searchHits.filter((hit) => hit.type === "task");
  const searchPages = searchHits.filter((hit) => hit.type === "doc");
  const searchResults: SearchHit[] = [
    ...searchTasks,
    ...searchPages,
    ...searchRecords,
  ];
  const markQuery = (value: string) => {
    const q = searchQuery.trim();
    const at = value.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
    if (!q || at < 0) return value;
    return (
      <>
        {value.slice(0, at)}
        <mark>{value.slice(at, at + q.length)}</mark>
        {value.slice(at + q.length)}
      </>
    );
  };
  const renderSearchResult = (hit: SearchHit, index: number) => (
    <li key={hit.id}>
      <button
        className={index === searchIndex ? "is-selected" : ""}
        onMouseEnter={() => setSearchIndex(index)}
        onClick={() => openSearchHit(hit)}
      >
        <strong>{markQuery(hit.title)}</strong>
        <span className="muted">
          {snippetRuns(hit.snippet ?? "").map((run, part) =>
            run.hit ? (
              <mark key={part}>{run.text}</mark>
            ) : (
              <span key={part}>{run.text}</span>
            ),
          )}
        </span>
      </button>
    </li>
  );

  const openHistory = () => {
    setMode("history");
    client.projectActivity(project.id).then(setActivity).catch(report);
  };

  const save = (patch: Parameters<typeof client.updateProject>[1]) => {
    setBusy(true);
    client
      .updateProject(project.id, patch)
      .then(onChanged)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const createProjectPage = async (asBrief: boolean) => {
    if (!canWrite || !onOpenNote || busy) return;
    setBusy(true);
    try {
      const doc = await client.createDoc({
        title: asBrief ? `${project.name} brief` : "",
        kind: "note",
        project_id: project.id,
        team_id: project.team_id,
        content: [{ type: "paragraph", text: "" }],
      });
      if (asBrief)
        onChanged(await client.updateProject(project.id, { doc_id: doc.id }));
      else setHomeNotes(await client.listDocs({ project: project.id }));
      onOpenNote(doc.id);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async () => {
    if (!canWrite || !linkUrl.trim() || busy) return;
    setBusy(true);
    try {
      await client.addProjectLink(project.id, {
        url: linkUrl.trim(),
        title: linkTitle.trim(),
      });
      setHomeLinks(await client.listProjectLinks(project.id));
      setLinkUrl("");
      setLinkTitle("");
      setAddingLink(false);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };

  const removeLink = async (linkId: string) => {
    if (!canWrite || busy) return;
    setBusy(true);
    try {
      await client.removeProjectLink(project.id, linkId);
      setHomeLinks((links) => links.filter((link) => link.id !== linkId));
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };

  const addProjectFiles = async (files: File[]) => {
    if (!canWrite || !files.length) return;
    if (
      project.team_id &&
      !(await ask({
        title: `Add ${files.length === 1 ? "this file" : "these files"} to ${project.name}?`,
        body: `Everyone in ${project.team_name ?? "this team"} will be able to read the pages made from them.`,
        confirmLabel: "Add files",
      }))
    )
      return;
    await imports.importFiles(files);
  };

  /** Plans your tasks, and the unassigned ones ticked (they become yours). */
  const planProject = () => {
    if (!canWrite) return;
    setBusy(true);
    const claimed = claiming.filter((id) =>
      unassigned.some((item) => item.id === id),
    );
    client
      .planProject(project.id, deviceTimeZone(), claimed)
      .then((plan) => {
        setClaiming([]);
        if (claimed.length) onItemsChanged();
        onOpenPlan(plan);
      }, report)
      .finally(() => setBusy(false));
  };

  const addStage = () => {
    const name = prompt("Name the new stage")?.trim();
    if (!name) return;
    save({
      stages: [
        ...project.stages.map((s) => ({ id: s.id, name: s.name })),
        { name },
      ],
    });
  };

  const renameStage = (stage: ProjectStage) => {
    const name = prompt("Rename this stage", stage.name)?.trim();
    if (!name || name === stage.name) return;
    save({
      stages: project.stages.map((s) => ({
        id: s.id,
        name: s.id === stage.id ? name : s.name,
      })),
    });
  };

  const removeStage = async (stage: ProjectStage) => {
    if (
      !(await ask({
        title: `Remove the “${stage.name}” stage? Its tasks stay in the project.`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    save({
      stages: project.stages
        .filter((s) => s.id !== stage.id)
        .map((s) => ({ id: s.id, name: s.name })),
    });
  };

  const moveTo = (item: Item, stageId: string | null) => {
    setBusy(true);
    client
      .setItemProject(item.id, { project_id: project.id, stage_id: stageId })
      .then(onItemsChanged)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const addExisting = async (stageId: string | null) => {
    if (!unfiledPool.length) {
      await tell({ title: "Every task is already in a project." });
      return;
    }
    const list = unfiledPool
      .slice(0, 20)
      .map((t, n) => `${n + 1}. ${t.title}`)
      .join("\n");
    const pick = prompt(`Which task should join this stage?\n\n${list}`);
    const index = Number(pick) - 1;
    const chosen = unfiledPool[index];
    if (!chosen) return;
    moveTo(chosen, stageId);
  };

  const unfile = (item: Item) => {
    setBusy(true);
    client
      .setItemProject(item.id, { project_id: null })
      .then(onItemsChanged)
      .catch(report)
      .finally(() => setBusy(false));
  };

  /** Keep the project out of the assistant, or let it back in. */
  const keepOut = async (off: boolean) => {
    if (
      off &&
      !(await ask({
        title: `Keep “${project.name}” out of the assistant?`,
        body: "No AI will read this project or anything in it: not the assistant, Study, the morning agenda, search by meaning or connected agents. Everyone in it keeps working as before.",
        confirmLabel: "Keep it out",
      }))
    )
      return;
    try {
      onChanged(await client.setProjectAssistant(project.id, off));
    } catch (e) {
      report(e);
    }
  };

  const remove = async () => {
    if (
      !(await ask({
        title: `Delete “${project.name}”? Its tasks stay, unfiled.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    client.deleteProject(project.id).then(onDeleted).catch(report);
  };

  // The deadline's day and time where the viewer is, never the UTC date.
  const zone = deviceTimeZone();
  const deadline = project.deadline
    ? projectDeadlineParts(project.deadline, zone)
    : null;
  const setDeadline = (change: { day?: string | null; clock?: string }) =>
    save({
      deadline: changeProjectDeadline(project.deadline, change, zone),
    });

  return (
    <div className="project-detail">
      <div className="project-bar-top">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> All projects
        </button>
        <div
          className="pboard-toggle"
          role="group"
          aria-label="How to show the work"
        >
          <button
            className={mode === "home" ? "is-on" : ""}
            aria-pressed={mode === "home"}
            onClick={() => setMode("home")}
          >
            Home
          </button>
          <button
            className={mode === "list" ? "is-on" : ""}
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            <List size={14} /> List
          </button>
          <button
            className={mode === "board" ? "is-on" : ""}
            aria-pressed={mode === "board"}
            onClick={() => setMode("board")}
          >
            <Columns3 size={14} /> Board
          </button>
          <button
            className={mode === "timeline" ? "is-on" : ""}
            aria-pressed={mode === "timeline"}
            onClick={() => setMode("timeline")}
          >
            <CalendarRange size={14} /> Timeline
          </button>
          <button
            className={mode === "notes" ? "is-on" : ""}
            aria-pressed={mode === "notes"}
            onClick={() => setMode("notes")}
          >
            Pages & files
          </button>
          <button
            className={mode === "decisions" ? "is-on" : ""}
            aria-pressed={mode === "decisions"}
            onClick={() => setMode("decisions")}
          >
            Decisions
          </button>
          <button
            className={mode === "history" ? "is-on" : ""}
            aria-pressed={mode === "history"}
            onClick={openHistory}
          >
            <History size={14} /> History
          </button>
        </div>
        <ShareLinkButton
          target={{ kind: "project", id: project.id }}
          title={project.name}
          onError={report}
        />
        {onAskProject && !project.assistant_off && (
          <button className="text-button" onClick={() => onAskProject(project)}>
            <Sparkles size={15} aria-hidden="true" /> Ask
          </button>
        )}
        {project.assistant_off && (
          <span
            className="plan-chip project-ai-off"
            title="No AI reads this project: not the assistant, Study, the agenda, search by meaning or connected agents."
          >
            Kept out of the assistant
          </span>
        )}
        <div className="project-manage">
          <StarButton kind="project" id={project.id} name={project.name} />
          <button
            className="icon-button"
            aria-label="Project options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Ellipsis size={18} />
          </button>
          {menuOpen && (
            <div className="project-manage-menu">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void copyLink({ kind: "project", id: project.id }).then(
                    (ok) =>
                      toast({
                        text: ok ? "Link copied" : "Couldn't copy the link",
                      }),
                  );
                }}
              >
                Copy link
              </button>
              {canWrite && (
                <>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setEditing({ kind: "rename", text: project.name });
                    }}
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setEditing({ kind: "summary", text: project.summary });
                    }}
                  >
                    Summary & brief
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setLookOpen(true);
                    }}
                  >
                    Cover and icon
                  </button>
                  {(["active", "done", "archived"] as const).map((status) => (
                    <button
                      key={status}
                      disabled={status === project.status}
                      onClick={() => {
                        setMenuOpen(false);
                        save({ status });
                      }}
                    >
                      Mark {status}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      void client
                        .templateFromProject(project.id)
                        .then((template) =>
                          tell({
                            title: `Saved “${template.name}” as a template.`,
                            body: "Start a project from it with Templates, on the projects page.",
                          }),
                        )
                        .catch(report);
                    }}
                  >
                    Save as template
                  </button>
                </>
              )}
              {canManageAi && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void keepOut(!project.assistant_off);
                  }}
                >
                  {project.assistant_off
                    ? "Let the assistant read it"
                    : "Keep out of the assistant"}
                </button>
              )}
              {canWrite && (
                <button
                  className="is-destructive"
                  onClick={() => {
                    setMenuOpen(false);
                    void remove();
                  }}
                >
                  Delete project
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {lookOpen && (
        <LookDialog
          title="Project cover and icon"
          look={{
            cover_file_id: project.cover_file_id ?? null,
            icon: project.icon ?? null,
          }}
          uploadTo={project.doc_id}
          report={report}
          onSave={saveLook}
          onClose={() => setLookOpen(false)}
        />
      )}
      {editing && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditing(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(null);
          }}
        >
          <form
            className="modal modal-small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-edit-title"
            onSubmit={(event) => {
              event.preventDefault();
              const text = editing.text.trim();
              setEditing(null);
              if (editing.kind === "rename") {
                if (text && text !== project.name) save({ name: text });
              } else if (text !== project.summary) save({ summary: text });
            }}
          >
            <div className="section-heading">
              <h2 id="project-edit-title">
                {editing.kind === "rename"
                  ? "Rename project"
                  : "Summary & brief"}
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Cancel"
                onClick={() => setEditing(null)}
              >
                <X size={20} />
              </button>
            </div>
            <label>
              {editing.kind === "rename" ? "Name" : "Summary"}
              {editing.kind === "rename" ? (
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={editing.text}
                  onChange={(event) =>
                    setEditing({ ...editing, text: event.target.value })
                  }
                />
              ) : (
                <textarea
                  autoFocus
                  rows={3}
                  maxLength={2000}
                  placeholder="One or two lines on what this project is for"
                  value={editing.text}
                  onChange={(event) =>
                    setEditing({ ...editing, text: event.target.value })
                  }
                />
              )}
            </label>
            {editing.kind === "summary" && onOpenNote && (
              <p className="muted modal-lead">
                The brief is the project's page, for everything longer.{" "}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    if (project.doc_id) onOpenNote(project.doc_id);
                    else void createProjectPage(true);
                  }}
                >
                  {project.doc_id ? "Open the brief" : "Write a brief"}
                </button>
              </p>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="project-search">
        <input
          type="search"
          aria-label={`Search ${project.name}`}
          placeholder="Search this project"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSearchQuery("");
            if (event.key === "ArrowDown" && searchResults.length) {
              event.preventDefault();
              setSearchIndex((index) => (index + 1) % searchResults.length);
            }
            if (event.key === "ArrowUp" && searchResults.length) {
              event.preventDefault();
              setSearchIndex(
                (index) =>
                  (index - 1 + searchResults.length) % searchResults.length,
              );
            }
            if (event.key === "Enter" && searchResults.length) {
              event.preventDefault();
              openSearchHit(searchResults[searchIndex] ?? searchResults[0]);
            }
          }}
        />
        {searchQuery.trim().length >= 2 && (
          <div
            className="project-search-results"
            role="region"
            aria-label="Project search results"
          >
            {searchResults.length === 0 && (
              <p className="muted">No matches in this project.</p>
            )}
            {searchTasks.length > 0 && (
              <section>
                <h3>Tasks ({searchTasks.length})</h3>
                <ul>
                  {searchTasks.map((hit, index) =>
                    renderSearchResult(hit, index),
                  )}
                </ul>
              </section>
            )}
            {searchPages.length > 0 && (
              <section>
                <h3>Pages ({searchPages.length})</h3>
                <ul>
                  {searchPages.map((hit, index) =>
                    renderSearchResult(hit, searchTasks.length + index),
                  )}
                </ul>
              </section>
            )}
            {searchRecords.length > 0 && (
              <section>
                <h3>Decisions ({searchRecords.length})</h3>
                <ul>
                  {searchRecords.map((record, index) =>
                    renderSearchResult(
                      record,
                      searchTasks.length + searchPages.length + index,
                    ),
                  )}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {reentry && reentry.total > 0 && (
        <section className="project-reentry" aria-label="Since your last visit">
          <div>
            <strong>Since your last visit</strong>
            <p>
              {reentry.total} change{reentry.total === 1 ? "" : "s"}
              {reentry.completedTasks > 0 &&
                ` · ${reentry.completedTasks} task${reentry.completedTasks === 1 ? "" : "s"} completed`}
              {reentry.changedRecords > 0 &&
                ` · ${reentry.changedRecords} commitment update${reentry.changedRecords === 1 ? "" : "s"}`}
            </p>
            <ul>
              {reentry.recent.map((summary, index) => (
                <li key={`${summary}-${index}`}>{summary}</li>
              ))}
            </ul>
          </div>
          <button className="secondary" onClick={openHistory}>
            View history
          </button>
          {onAskProject && assistant.enabled && reentry.total >= 2 && (
            <div className="project-reentry-actions">
              <button
                className="secondary"
                onClick={() =>
                  onAskProject(
                    project,
                    "Explain what changed in this project since my last visit, with sources.",
                  )
                }
              >
                Explain what changed
              </button>
              {assistant.tools && (
                <button
                  className="secondary"
                  onClick={() =>
                    onAskProject(
                      project,
                      "Draft a project update page from the changes since my last visit. Show me the draft to edit and keep.",
                    )
                  }
                >
                  Draft an update
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <header
        className={
          "project-header" + (project.cover_file_id ? " has-cover" : "")
        }
      >
        <Cover fileId={project.cover_file_id} className="project-cover" />
        <div className="project-title-row">
          <h2>
            {project.icon && (
              <LookIcon
                icon={project.icon}
                size={22}
                className="project-look-icon"
              />
            )}
            {project.name}
          </h2>
        </div>
        <p className="muted">{project.summary || "No summary yet."}</p>
        <div className="project-meta">
          <span className="project-bar" aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </span>
          <span className="muted">
            {project.done_count} of {project.task_count} done · {percent}%
          </span>
          <div className="project-deadline">
            <label htmlFor="project-deadline">Deadline</label>
            <DateField
              id="project-deadline"
              type="date"
              value={deadline?.day ?? ""}
              disabled={busy}
              onChange={(e) => setDeadline({ day: e.target.value || null })}
            />
            {/* 5 pm unless another time is picked; clearing it goes back
                to 5 pm. */}
            {deadline && (
              <DateField
                type="time"
                value={deadline.clock}
                disabled={busy}
                aria-label="Deadline time"
                onChange={(e) => setDeadline({ clock: e.target.value })}
              />
            )}
          </div>
        </div>
      </header>

      {planning && project.task_count > 0 && project.status === "active" && (
        <section
          className="project-planning"
          aria-label="Project planning status"
        >
          {(() => {
            const chip = projectPlanStatus(planning);
            const late = planning.late_session_count;
            return (
              <>
                <div className="project-planning-head">
                  <p>
                    {project.deadline && (
                      <>
                        <strong>
                          Deadline {dayLabel(project.deadline, true)}
                        </strong>{" "}
                        ·{" "}
                      </>
                    )}
                    Your part: needs {shortMinutes(planning.needed_minutes)} ·{" "}
                    {shortMinutes(planning.planned_minutes)} planned
                    {project.deadline ? " before it" : ""} ·{" "}
                    {shortMinutes(planning.unplanned_minutes)} not planned
                    {planning.planned_finish_at &&
                      ` · Planned finish ${dayLabel(planning.planned_finish_at)}`}
                  </p>
                  {chip && (
                    <span
                      className={
                        "chip " +
                        (chip.status === "on_track" ? "is-ok" : "chip-warn")
                      }
                    >
                      {chip.label}
                    </span>
                  )}
                  {canWrite && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={planProject}
                    >
                      Plan this project
                    </button>
                  )}
                </div>
                {planning.needed_minutes > 0 && (
                  <span
                    className="project-plan-bar"
                    role="img"
                    aria-label={`${shortMinutes(planning.planned_minutes)} of ${shortMinutes(planning.needed_minutes)} planned`}
                  >
                    <i
                      style={{
                        width: `${Math.min(100, Math.round((planning.planned_minutes / planning.needed_minutes) * 100))}%`,
                      }}
                    />
                  </span>
                )}
                {late > 0 && (
                  <p className="project-planning-warn">
                    {late === 1
                      ? "1 session after its task's deadline"
                      : `${late} sessions after their tasks' deadlines`}
                  </p>
                )}
                {planning.unestimated_tasks.length > 0 && (
                  <p className="muted">
                    Needs an estimate:{" "}
                    {planning.unestimated_tasks
                      .map((task) => task.title)
                      .join(", ")}
                  </p>
                )}
                {project.team_id && (
                  <p className="muted">
                    {planning.team_planned_minutes !== undefined
                      ? `Team: ${shortMinutes(planning.team_planned_minutes)} planned by everyone`
                      : "Only your sessions are counted"}
                  </p>
                )}
                {canWrite && project.team_id && unassigned.length > 0 && (
                  <fieldset className="project-unassigned">
                    <legend className="muted">
                      Unassigned tasks: tick the ones you'll take on, and they
                      are yours and planned with Plan this project.
                    </legend>
                    {unassigned.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={claiming.includes(item.id)}
                          disabled={busy}
                          onChange={(event) =>
                            setClaiming((ids) =>
                              event.target.checked
                                ? [...ids, item.id]
                                : ids.filter((id) => id !== item.id),
                            )
                          }
                        />{" "}
                        {item.title}
                      </label>
                    ))}
                  </fieldset>
                )}
              </>
            );
          })()}
        </section>
      )}

      {mode === "home" ? (
        <div className="project-home">
          <ProjectMilestones
            projectId={project.id}
            items={items.filter((i) => i.project_id === project.id)}
            canWrite={canWrite}
            onChanged={onItemsChanged}
            report={report}
            refreshKey={sessions}
          />
          {homeTasks.length > 0 && (
            <section className="project-home-section">
              <h3>Coming due</h3>
              <ul>
                {homeTasks.map((item) => (
                  <li key={item.id}>
                    <button
                      className="text-button"
                      onClick={() => onOpenItem(item)}
                    >
                      {item.title}
                    </button>
                    <span className="muted">
                      {deadlineOf(item)
                        ? new Date(deadlineOf(item)!).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })
                        : project.deadline
                          ? `No deadline · project ends ${new Date(project.deadline).toLocaleDateString([], { month: "short", day: "numeric" })}`
                          : "No deadline"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {homeSessions.length > 0 && (
            <section className="project-home-section">
              <h3>Next 7 days</h3>
              <ul>
                {homeSessions.map((session) => {
                  const item = items.find(
                    (task) => task.id === session.item_id,
                  );
                  return (
                    <li key={session.id}>
                      <span>
                        {new Date(session.start_at).toLocaleString([], {
                          weekday: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      {item ? (
                        <button
                          className="text-button"
                          onClick={() => onOpenItem(item)}
                        >
                          {item.title}
                        </button>
                      ) : (
                        <span>Session</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {(project.summary || project.doc_id || (canWrite && onOpenNote)) && (
            <section className="project-home-section">
              <h3>Brief</h3>
              {project.summary && <p>{project.summary}</p>}
              {project.doc_id && onOpenNote && (
                <button
                  className="text-button"
                  onClick={() => onOpenNote(project.doc_id!)}
                >
                  Open brief
                </button>
              )}
              {!project.doc_id && canWrite && onOpenNote && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void createProjectPage(true)}
                >
                  Write a brief
                </button>
              )}
            </section>
          )}
          {(homeNotes.length > 0 || homeLinks.length > 0 || canWrite) && (
            <section className="project-home-section">
              <h3>Pages & files</h3>
              {homeLinks.length > 0 && (
                <ul>
                  {homeLinks.map((link) => (
                    <li key={link.id}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.title || link.url}
                      </a>
                      {canWrite && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void removeLink(link.id)}
                          aria-label={`Remove ${link.title || link.url}`}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {addingLink && canWrite && (
                <div className="project-home-actions">
                  <input
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    placeholder="https://…"
                    aria-label="Link URL"
                    maxLength={2000}
                  />
                  <input
                    value={linkTitle}
                    onChange={(event) => setLinkTitle(event.target.value)}
                    placeholder="Title (optional)"
                    aria-label="Link title"
                    maxLength={200}
                  />
                  <button
                    className="text-button"
                    disabled={busy || !linkUrl.trim()}
                    onClick={() => void saveLink()}
                  >
                    Save link
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setAddingLink(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {homeNotes.length > 0 && onOpenNote && (
                <ul>
                  {homeNotes.slice(0, 5).map((note) => (
                    <li key={note.id}>
                      <button
                        className="text-button"
                        onClick={() => onOpenNote(note.id)}
                      >
                        {note.title || "Untitled"}
                      </button>
                      <span className="muted">{note.preview}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="project-home-actions">
                {homeNotes.length > 0 && onOpenNote && (
                  <button
                    className="text-button"
                    onClick={() => setMode("notes")}
                  >
                    All pages & files
                  </button>
                )}
                {canWrite && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void createProjectPage(false)}
                  >
                    New page
                  </button>
                )}
                {canWrite && homeLinks.length < 20 && !addingLink && (
                  <button
                    className="text-button"
                    onClick={() => setAddingLink(true)}
                  >
                    Add link
                  </button>
                )}
                {canWrite && (
                  <ImportButton
                    label="Add a file"
                    onFiles={(files) => void addProjectFiles(files)}
                    busy={busy || imports.busy}
                  />
                )}
              </div>
            </section>
          )}
          {openQuestions.length > 0 && (
            <section className="project-home-section">
              <h3>Open questions</h3>
              <ul>
                {openQuestions.slice(0, 5).map((record) => (
                  <li key={record.id}>
                    <span>{record.title}</span>
                    <span className="muted">
                      {record.kind === "decision"
                        ? "Decision"
                        : "Promise due soon"}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                className="text-button"
                onClick={() => setMode("decisions")}
              >
                All decisions
              </button>
            </section>
          )}
          {/* Other names, such as a course code (LNK-03). */}
          {(canWrite || (project.aliases ?? []).length > 0) && (
            <section className="project-home-section">
              <h3>Also called</h3>
              <AliasesField
                aliases={project.aliases ?? []}
                canWrite={canWrite}
                placeholder="Add another name, like COMP3100"
                onSave={(aliases) =>
                  client.updateProject(project.id, { aliases }).then(
                    (next) => {
                      onChanged(next);
                      return next.aliases ?? aliases;
                    },
                    (e) => {
                      report(e);
                      return project.aliases ?? [];
                    },
                  )
                }
              />
            </section>
          )}
          {/* Your own fields on the project (ORG-02). */}
          <FieldsPanel
            target="project"
            targetId={project.id}
            revision={project.updated_at}
            report={report}
            className="project-home-section"
          />
          {/* Pages in the project and pages that link to it. */}
          <LinkedHere kind="project" id={project.id} report={report} compact />
          {/* What the project is linked to, one or two steps out (CNV-02). */}
          <ConnectionsMap
            kind="project"
            id={project.id}
            revision={project.updated_at}
            report={report}
            className="project-home-section"
          />
        </div>
      ) : mode === "notes" && onOpenNote ? (
        <ProjectNotes
          projectId={project.id}
          teamId={project.team_id}
          canWrite={canWrite && !busy}
          report={report}
          onOpen={onOpenNote}
        />
      ) : mode === "decisions" ? (
        <ProjectRecords
          focusId={initialSourceId}
          project={project}
          items={items}
          userId={userId}
          canWrite={canWrite}
          onOpenNote={onOpenNote}
          report={report}
        />
      ) : mode === "history" ? (
        <section
          className="project-history"
          aria-labelledby="project-history-title"
        >
          <div className="project-history-heading">
            <div>
              <h3 id="project-history-title">Project history</h3>
              <p className="muted">
                Changes to the project, its tasks, and its notes in one place.
              </p>
            </div>
            <button
              className="secondary"
              onClick={() =>
                client
                  .projectActivity(project.id)
                  .then(setActivity)
                  .catch(report)
              }
            >
              Refresh
            </button>
          </div>
          <ProjectTimeMachine projectId={project.id} report={report} />
          {activity === null ? (
            <p className="muted">Loading project history…</p>
          ) : activity.length === 0 ? (
            <p className="project-history-empty muted">
              Changes will appear here as work on this project evolves.
            </p>
          ) : (
            <>
              {lastSeen && (
                <p className="project-catchup" role="status">
                  <strong>
                    {
                      activity.filter((event) => event.created_at > lastSeen)
                        .length
                    }
                  </strong>{" "}
                  {activity.filter((event) => event.created_at > lastSeen)
                    .length === 1
                    ? "change since your last visit"
                    : "changes since your last visit"}
                </p>
              )}
              <ol className="project-history-list">
                {activity.map((event) => {
                  const changes = historyDiff(event);
                  const relatedItem =
                    event.entity_type === "task" ||
                    event.entity_type === "session"
                      ? items.find((item) => item.id === event.entity_id)
                      : undefined;
                  const origin = activityOriginLabel(event);
                  return (
                    <li
                      key={event.id}
                      className={
                        event.id === initialSourceId
                          ? "project-source-focus"
                          : undefined
                      }
                      ref={
                        event.id === initialSourceId
                          ? (element) =>
                              element?.scrollIntoView({ block: "center" })
                          : undefined
                      }
                    >
                      <span
                        className="project-history-dot"
                        aria-hidden="true"
                      />
                      <div className="project-history-entry">
                        <div className="project-history-title">
                          <strong>{event.summary}</strong>
                          <time dateTime={event.created_at}>
                            {new Date(event.created_at).toLocaleString([], {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        </div>
                        <small className="muted">
                          {event.actor_name ?? "Workspace activity"}
                          {origin ? ` · ${origin}` : ""}
                          {event.entity_type === "session"
                            ? " · only you see your sessions"
                            : ""}
                        </small>
                        {!!changes.length && (
                          <ul className="project-history-diff">
                            {changes.map((change) => (
                              <li key={change.label}>
                                <span>{change.label}</span>
                                <span>{change.from}</span>
                                <span aria-hidden="true">→</span>
                                <strong>{change.to}</strong>
                              </li>
                            ))}
                          </ul>
                        )}
                        {relatedItem && (
                          <button
                            className="text-button"
                            onClick={() => onOpenItem(relatedItem)}
                          >
                            Open task
                          </button>
                        )}
                        {event.entity_type === "note" &&
                          event.entity_id &&
                          onOpenNote && (
                            <button
                              className="text-button"
                              onClick={() => onOpenNote(event.entity_id!)}
                            >
                              Open note
                            </button>
                          )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
      ) : mode === "timeline" ? (
        <Timeline
          project={project}
          items={items}
          sessions={sessions}
          onOpenItem={onOpenItem}
        />
      ) : mode === "board" ? (
        <div className="pboard" aria-label="Stages as columns">
          {[
            ...project.stages.map((st) => ({ id: st.id, name: st.name })),
            {
              id: null as string | null,
              name: "No stage",
            },
          ].map((column) => {
            const rows = grouped.get(column.id) ?? [];
            return (
              <section
                key={column.id ?? "none"}
                className={"pboard-column" + (dragging ? " is-target" : "")}
                onDragOver={(e) => {
                  // Allowing the drop is what makes the column a target.
                  if (dragging) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragging;
                  const item = items.find((i) => i.id === id);
                  setDragging(null);
                  if (item && item.stage_id !== column.id)
                    moveTo(item, column.id);
                }}
              >
                <div className="pboard-head">
                  <strong>{column.name}</strong>
                  <span className="muted stage-count">{rows.length}</span>
                </div>
                <div className="pboard-cards">
                  {rows.map((item) => (
                    <button
                      key={item.id}
                      className={
                        "pboard-card" +
                        (dragging === item.id ? " is-dragging" : "")
                      }
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", item.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(item.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => onOpenItem(item)}
                    >
                      <span
                        className={
                          "stage-dot" +
                          (item.status === "done" ? " is-done" : "")
                        }
                        aria-hidden="true"
                      />
                      <span
                        className={
                          item.status === "done" ? "stage-task-done" : ""
                        }
                      >
                        {item.title}
                      </span>
                    </button>
                  ))}
                  {rows.length === 0 && (
                    <p className="pboard-empty muted">Drop a task here.</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="stage-list">
          {project.stages.map((stage) => {
            const rows = grouped.get(stage.id) ?? [];
            return (
              <section key={stage.id} className="stage">
                <div className="stage-head">
                  <button
                    className="stage-name"
                    onClick={() => renameStage(stage)}
                    title="Rename this stage"
                  >
                    {stage.name}
                  </button>
                  <span className="muted stage-count">{rows.length}</span>
                  <button
                    className="text-button"
                    onClick={() => addExisting(stage.id)}
                    disabled={busy}
                  >
                    <Plus size={13} /> Add task
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => removeStage(stage)}
                    aria-label={`Remove the ${stage.name} stage`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {rows.length === 0 ? (
                  <p className="stage-empty muted">Nothing here yet.</p>
                ) : (
                  <ul className="stage-tasks">
                    {rows.map((item) => (
                      <li key={item.id}>
                        <button
                          className="stage-task"
                          onClick={() => onOpenItem(item)}
                        >
                          <span
                            className={
                              "stage-dot" +
                              (item.status === "done" ? " is-done" : "")
                            }
                            aria-hidden="true"
                          />
                          <span
                            className={
                              item.status === "done" ? "stage-task-done" : ""
                            }
                          >
                            {item.title}
                          </span>
                        </button>
                        <Select
                          id={`stage-for-${item.id}`}
                          className="stage-move"
                          value={item.stage_id ?? ""}
                          disabled={busy}
                          aria-label={`Stage for ${item.title}`}
                          onChange={(e) =>
                            e.target.value === "__remove"
                              ? unfile(item)
                              : moveTo(item, e.target.value || null)
                          }
                        >
                          {project.stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                          <option value="">No stage</option>
                          <option value="__remove">Remove from project</option>
                        </Select>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <section className="stage">
            <div className="stage-head">
              <span className="stage-name is-static">No stage</span>
              <span className="muted stage-count">
                {(grouped.get(null) ?? []).length}
              </span>
              <button
                className="text-button"
                onClick={() => addExisting(null)}
                disabled={busy}
              >
                <Plus size={13} /> Add task
              </button>
            </div>
            {(grouped.get(null) ?? []).length === 0 ? (
              <p className="stage-empty muted">Everything is filed.</p>
            ) : (
              <ul className="stage-tasks">
                {(grouped.get(null) ?? []).map((item) => (
                  <li key={item.id}>
                    <button
                      className="stage-task"
                      onClick={() => onOpenItem(item)}
                    >
                      <span
                        className={
                          "stage-dot" +
                          (item.status === "done" ? " is-done" : "")
                        }
                        aria-hidden="true"
                      />
                      <span>{item.title}</span>
                    </button>
                    <Select
                      id={`stage-for-${item.id}`}
                      className="stage-move"
                      value=""
                      disabled={busy}
                      aria-label={`Stage for ${item.title}`}
                      onChange={(e) =>
                        e.target.value === "__remove"
                          ? unfile(item)
                          : moveTo(item, e.target.value || null)
                      }
                    >
                      <option value="">No stage</option>
                      {project.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value="__remove">Remove from project</option>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button className="add-stage" onClick={addStage} disabled={busy}>
            <Plus size={14} /> Add a stage
          </button>
        </div>
      )}
    </div>
  );
}

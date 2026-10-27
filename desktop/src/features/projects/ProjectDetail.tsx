import { usePaneLeaveGuard } from "../../app/page-commands";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { Select } from "../../components/Select";
import { ProjectNotes } from "./ProjectNotes";
import { ProjectChats } from "./ProjectChats";
import { ProjectRecords } from "./ProjectRecords";
import { ProjectTimeMachine } from "./ProjectTimeMachine";
import { useConfirm } from "../../components/Confirm";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
import { session as appearanceSession } from "../../lib/session";
import { Timeline } from "./Timeline";
import { ProjectMilestones } from "./ProjectMilestones";
import { DateField } from "../../components/DateField";
import { ShareLinkButton } from "../../components/ShareButton";
import { useToast } from "../../components/Toast";
import { copyLink } from "../../lib/links";
import { deviceTimeZone } from "../planner/planning";
import { ImportButton, useImports } from "../documents/library/Uploads";
import { FieldsPanel } from "../views/FieldsPanel";
import { ConnectionsMap } from "../connections/ConnectionsMap";
import { StarButton } from "../../components/StarButton";
import { LinkedHere } from "../documents/editor/DocLinks";
import { AliasesField } from "../documents/metadata/AliasesField";
import { canOpenTabs, openInNewTab } from "../../app/tabs";
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

export function ProjectDetail(props: Parameters<typeof ProjectDetailBody>[0]) {
  return (
    <ProjectDetailBody key={`${props.project.id}:${props.userId}`} {...props} />
  );
}
function ProjectDetailBody({
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
  onAskProject?: (project: Project, question?: string, chatId?: string) => void;
  userId: string;
  canWrite: boolean;
  /** Owners and admins (the owner, for a personal project): keep it out of the assistant. */
  canManageAi?: boolean;
}) {
  const { ask } = useConfirm();
  const toast = useToast();
  // Opened: it leads the quick switcher's recent list, on every device.
  useEffect(() => {
    void client.recordRecent("project", project.id).catch(() => {});
  }, [project.id]);
  const [busy, setBusy] = useState(false);
  const [placementRetry, setPlacementRetry] = useState<{
    projectId: string;
    itemId: string;
    title: string;
    version: number;
    stageId: string | null;
    unfile: boolean;
  } | null>(null);
  const retryItem =
    placementRetry?.projectId === project.id
      ? items.find((item) => item.id === placementRetry.itemId)
      : null;
  const mutation = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const menu = useRef<HTMLDivElement>(null);
  const historyRequest = useRef(0);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [homeFailed, setHomeFailed] = useState(false);
  const [homeLoading, setHomeLoading] = useState(true);
  const [planningFailed, setPlanningFailed] = useState(false);
  const [sessionsFailed, setSessionsFailed] = useState(false);
  const [stageDraft, setStageDraft] = useState<{
    id: string | null;
    name: string;
  } | null>(null);
  const [taskPicker, setTaskPicker] = useState<{
    stageId: string | null;
    itemId: string;
  } | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  /** The ⋯ menu's Cover and icon dialog (W6). */
  const [lookOpen, setLookOpen] = useState(false);
  const saveLook = async (look: Look) => {
    if (!canWrite) throw new Error("This project is view only.");
    if (mutation.current)
      throw new Error("Wait for the pending project change.");
    const account = appearanceSession.get();
    const owns = () => mounted.current && appearanceSession.get() === account;
    mutation.current = true;
    setBusy(true);
    try {
      const before: Look = {
        cover_file_id: project.cover_file_id ?? null,
        icon: project.icon ?? null,
      };
      const saved = await client.updateProject(project.id, look);
      if (!owns()) return;
      onChanged(saved);
      toast({
        text: "Cover and icon saved",
        action: {
          label: "Undo",
          run: () =>
            void client
              .updateProject(project.id, before)
              .then(onChanged, report),
        },
      });
    } finally {
      mutation.current = false;
      if (owns()) setBusy(false);
    }
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
  const departure = useRef(false);
  const projectDrafts = useRef({
    editing,
    stageDraft,
    linkUrl,
    linkTitle,
    addingLink,
  });
  projectDrafts.current = {
    editing,
    stageDraft,
    linkUrl,
    linkTitle,
    addingLink,
  };
  usePaneLeaveGuard(async () => {
    if (mutation.current || departure.current || lookOpen) return false;
    const snapshot = projectDrafts.current;
    if (
      !snapshot.editing &&
      !snapshot.stageDraft &&
      !snapshot.linkUrl.trim() &&
      !snapshot.linkTitle.trim()
    )
      return true;
    const account = appearanceSession.get();
    departure.current = true;
    try {
      if (
        !(await ask({
          title: "Discard project changes?",
          body: "Your unsaved project edits will be lost.",
          confirmLabel: "Discard changes",
          cancelLabel: "Keep editing",
        }))
      )
        return false;
      const now = projectDrafts.current;
      if (
        !mounted.current ||
        appearanceSession.get() !== account ||
        mutation.current ||
        now.editing !== snapshot.editing ||
        now.stageDraft !== snapshot.stageDraft ||
        now.linkUrl !== snapshot.linkUrl ||
        now.linkTitle !== snapshot.linkTitle
      )
        return false;
      setEditing(null);
      setStageDraft(null);
      setAddingLink(false);
      setLinkUrl("");
      setLinkTitle("");
      return true;
    } finally {
      departure.current = false;
    }
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchRecords, setSearchRecords] = useState<SearchHit[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
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
        .then((value) => {
          if (mounted.current) setHomeNotes(value);
        })
        .catch((error) => {
          if (mounted.current) report(error);
        }),
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
      .catch((error) => {
        if (active) report(error);
      });
    return () => {
      active = false;
    };
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setPlanningFailed(false);
    client.projectPlanning(project.id).then(
      (summary) => {
        if (active) setPlanning(summary);
      },
      (error) => {
        if (active) {
          setPlanningFailed(true);
          report(error);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [project.id, project.deadline, items, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== "timeline" && mode !== "home") return;
    let active = true;
    setSessionsFailed(false);
    client.projectSessions(project.id).then(
      (rows) => {
        if (active) setSessions(rows);
      },
      (error) => {
        if (active) {
          setSessionsFailed(true);
          report(error);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [mode, project.id, items, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== "home") return;
    let active = true;
    setHomeFailed(false);
    setHomeLoading(true);
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
          setHomeLoading(false);
        }
      },
      (error) => {
        if (active) {
          setHomeFailed(true);
          setHomeLoading(false);
          report(error);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [mode, project.id, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearching(false);
      setSearchFailed(false);
      setSearchHits([]);
      setSearchRecords([]);
      return;
    }
    setSearchHits([]);
    setSearchRecords([]);
    setSearchIndex(0);
    setSearching(true);
    setSearchFailed(false);
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
          setSearching(false);
        },
        (error) => {
          if (active) {
            setSearching(false);
            setSearchFailed(true);
            report(error);
          }
        },
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, project.id, retry]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const loadHistory = async () => {
    const epoch = ++historyRequest.current;
    setHistoryFailed(false);
    try {
      const rows = await client.projectActivity(project.id);
      if (epoch === historyRequest.current) setActivity(rows);
    } catch (e) {
      if (epoch === historyRequest.current) {
        setHistoryFailed(true);
        report(e);
      }
    }
  };
  useEffect(() => {
    if (mode === "history") void loadHistory();
    return () => {
      historyRequest.current++;
    };
  }, [mode, project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menu.current
          ?.querySelector<HTMLButtonElement>("button[aria-expanded]")
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  const openHistory = () => setMode("history");

  const save = async (patch: Parameters<typeof client.updateProject>[1]) => {
    if (!canWrite || mutation.current) return false;
    mutation.current = true;
    setBusy(true);
    try {
      onChanged(await client.updateProject(project.id, patch));
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const createProjectPage = async (asBrief: boolean) => {
    if (!canWrite || !onOpenNote || mutation.current) return;
    mutation.current = true;
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
      mutation.current = false;
      setBusy(false);
    }
  };

  const saveLink = async () => {
    if (!canWrite || !linkUrl.trim() || mutation.current) return;
    mutation.current = true;
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
      mutation.current = false;
      setBusy(false);
    }
  };

  const removeLink = async (linkId: string) => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await client.removeProjectLink(project.id, linkId);
      setHomeLinks((links) => links.filter((link) => link.id !== linkId));
    } catch (error) {
      report(error);
    } finally {
      mutation.current = false;
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
    if (!canWrite || mutation.current) return;
    mutation.current = true;
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
      .finally(() => {
        mutation.current = false;
        setBusy(false);
      });
  };

  const addStage = () => {
    if (canWrite && !busy) setStageDraft({ id: null, name: "" });
  };
  const renameStage = (stage: ProjectStage) => {
    if (canWrite && !busy) setStageDraft({ id: stage.id, name: stage.name });
  };
  const saveStage = async () => {
    if (!stageDraft?.name.trim()) return;
    const stages = stageDraft.id
      ? project.stages.map((stage) => ({
          id: stage.id,
          name:
            stage.id === stageDraft.id ? stageDraft.name.trim() : stage.name,
        }))
      : [
          ...project.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
          })),
          { name: stageDraft.name.trim() },
        ];
    if (await save({ stages })) setStageDraft(null);
  };

  const removeStage = async (stage: ProjectStage) => {
    if (!canWrite || mutation.current) return;
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

  const moveTo = async (item: Item, stageId: string | null) => {
    if (
      !canWrite ||
      mutation.current ||
      (item.project_id !== project.id &&
        !unfiledPool.some((candidate) => candidate.id === item.id))
    )
      return false;
    mutation.current = true;
    setBusy(true);
    try {
      await client.setItemProject(item.id, {
        version: item.version,
        project_id: project.id,
        stage_id: stageId,
      });
      setPlacementRetry(null);
      onItemsChanged();
      return true;
    } catch (e) {
      if ((e as { status?: number }).status === 409 && mounted.current) {
        setPlacementRetry({
          projectId: project.id,
          itemId: item.id,
          title: item.title,
          version: item.version,
          stageId,
          unfile: false,
        });
        onItemsChanged();
      }
      report(e);
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const addExisting = (stageId: string | null) => {
    if (!canWrite || busy) return;
    setTaskPicker({ stageId, itemId: "" });
  };

  const unfile = (item: Item) => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    client
      .setItemProject(item.id, { project_id: null, version: item.version })
      .then(() => {
        setPlacementRetry(null);
        onItemsChanged();
      })
      .catch((error) => {
        if ((error as { status?: number }).status === 409 && mounted.current) {
          setPlacementRetry({
            projectId: project.id,
            itemId: item.id,
            title: item.title,
            version: item.version,
            stageId: null,
            unfile: true,
          });
          onItemsChanged();
        }
        report(error);
      })
      .finally(() => {
        mutation.current = false;
        setBusy(false);
      });
  };

  /** Keep the project out of the assistant, or let it back in. */
  const keepOut = async (off: boolean) => {
    if (!canManageAi || mutation.current) return;
    if (
      off &&
      !(await ask({
        title: `Keep “${project.name}” out of the assistant?`,
        body: "No AI will read this project or anything in it: not the assistant, Study, the morning agenda, search by meaning or connected agents. Everyone in it keeps working as before.",
        confirmLabel: "Keep it out",
      }))
    )
      return;
    mutation.current = true;
    setBusy(true);
    try {
      onChanged(await client.setProjectAssistant(project.id, off));
    } catch (e) {
      report(e);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!canWrite || mutation.current) return;
    if (
      !(await ask({
        title: `Delete “${project.name}”? Its tasks stay, unfiled.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    mutation.current = true;
    setBusy(true);
    client
      .deleteProject(project.id)
      .then(onDeleted)
      .catch(report)
      .finally(() => {
        mutation.current = false;
        setBusy(false);
      });
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
      {placementRetry?.projectId === project.id && (
        <div role="status">
          <p>
            “{placementRetry.title}” changed. Review its current placement
            before retrying your saved choice:{" "}
            {placementRetry.unfile
              ? "No project"
              : `${project.name} / ${project.stages.find((stage) => stage.id === placementRetry.stageId)?.name ?? "No stage"}`}
            .
          </p>
          {retryItem && (
            <p>
              Current placement:{" "}
              {retryItem.project_id === project.id
                ? `${project.name} / ${project.stages.find((stage) => stage.id === retryItem.stage_id)?.name ?? "No stage"}`
                : retryItem.project_id
                  ? "Another project"
                  : "No project"}
              .
            </p>
          )}
          <button
            type="button"
            disabled={
              busy ||
              !canWrite ||
              !retryItem ||
              retryItem.version <= placementRetry.version ||
              (!placementRetry.unfile &&
                !!retryItem.project_id &&
                retryItem.project_id !== project.id)
            }
            onClick={() => {
              if (!retryItem || retryItem.version <= placementRetry.version)
                return;
              if (placementRetry.unfile) unfile(retryItem);
              else void moveTo(retryItem, placementRetry.stageId);
            }}
          >
            Retry saved move
          </button>
          {retryItem && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenItem(retryItem)}
            >
              Open task
            </button>
          )}
          <button type="button" disabled={busy} onClick={onItemsChanged}>
            Refresh tasks
          </button>
          <button type="button" onClick={() => setPlacementRetry(null)}>
            Dismiss
          </button>
        </div>
      )}
      {chatsOpen && onAskProject && (
        <ProjectEditorDialog
          title="Project chats"
          busy={false}
          onClose={() => setChatsOpen(false)}
        >
          <ProjectChats
            key={project.id}
            projectId={project.id}
            onOpen={(id) => {
              setChatsOpen(false);
              onAskProject(project, undefined, id);
            }}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => setChatsOpen(false)}
          >
            Close
          </button>
        </ProjectEditorDialog>
      )}
      <div className="project-bar-top">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> All projects
        </button>
        <Select
          className="project-mode-picker"
          aria-label="Project view"
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          {(
            [
              ["home", "Home"],
              ["list", "List"],
              ["board", "Board"],
              ["timeline", "Timeline"],
              ["notes", "Pages & files"],
              ["decisions", "Decisions"],
              ["history", "History"],
            ] as const
          ).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
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
          <>
            <button
              className="text-button"
              onClick={() => onAskProject(project)}
            >
              <Sparkles size={15} aria-hidden="true" /> New chat
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setChatsOpen(true)}
            >
              <History size={15} aria-hidden="true" /> Chats
            </button>
          </>
        )}
        {project.assistant_off && (
          <span
            className="plan-chip project-ai-off"
            title="No AI reads this project: not the assistant, Study, the agenda, search by meaning or connected agents."
          >
            AI excluded
          </span>
        )}
        <div className="project-manage" ref={menu}>
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
              {canOpenTabs() && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    openInNewTab({
                      kind: "project",
                      id: project.id,
                      title: project.name,
                    });
                  }}
                >
                  Open in new tab
                </button>
              )}
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
                      disabled={busy || status === project.status}
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
                      if (mutation.current || !canWrite) return;
                      mutation.current = true;
                      setBusy(true);
                      void client
                        .templateFromProject(project.id)
                        .then(() => toast({ text: "Template saved" }))
                        .catch(report)
                        .finally(() => {
                          mutation.current = false;
                          setBusy(false);
                        });
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
          scope={project.id}
          title={project.name}
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
        <ProjectEditorDialog
          title={
            editing.kind === "rename" ? "Rename project" : "Summary & brief"
          }
          busy={busy}
          onClose={() => setEditing(null)}
        >
          <form
            className="project-record-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const text = editing.text.trim();
              if (editing.kind === "rename" && !text) return;
              if (
                await save(
                  editing.kind === "rename"
                    ? { name: text }
                    : { summary: text },
                )
              )
                setEditing(null);
            }}
          >
            <fieldset
              disabled={busy || !canWrite}
              className="project-record-fields"
            >
              <div className="section-heading">
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
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || !canWrite}
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
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !canWrite}
                >
                  Save
                </button>
              </div>
            </fieldset>
          </form>
        </ProjectEditorDialog>
      )}

      {stageDraft && (
        <ProjectEditorDialog
          title={stageDraft.id ? "Rename stage" : "New stage"}
          busy={busy}
          onClose={() => setStageDraft(null)}
        >
          <form
            className="project-record-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStage();
            }}
          >
            <label>
              Name
              <input
                autoFocus
                required
                maxLength={120}
                disabled={busy}
                value={stageDraft.name}
                onChange={(event) =>
                  setStageDraft({ ...stageDraft, name: event.target.value })
                }
              />
            </label>
            <div className="confirm-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setStageDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !stageDraft.name.trim()}
              >
                Save
              </button>
            </div>
          </form>
        </ProjectEditorDialog>
      )}
      {taskPicker && (
        <ProjectEditorDialog
          title="Add task to stage"
          busy={busy}
          onClose={() => setTaskPicker(null)}
        >
          <form
            className="project-record-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const item = unfiledPool.find(
                (item) => item.id === taskPicker.itemId,
              );
              if (item && (await moveTo(item, taskPicker.stageId)))
                setTaskPicker(null);
            }}
          >
            {!unfiledPool.length ? (
              <p className="muted">Every task is already in a project.</p>
            ) : (
              <label>
                Task
                <Select
                  disabled={busy}
                  value={taskPicker.itemId}
                  onChange={(event) =>
                    setTaskPicker({ ...taskPicker, itemId: event.target.value })
                  }
                >
                  <option value="">Choose a task</option>
                  {unfiledPool.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setTaskPicker(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy || !taskPicker.itemId}>
                Add task
              </button>
            </div>
          </form>
        </ProjectEditorDialog>
      )}
      {(homeFailed || planningFailed || sessionsFailed) && (
        <p role="status">
          Some project details are unavailable.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {imports.loadError && (
        <p role="status">
          Files unavailable.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void imports.refresh()}
          >
            Retry
          </button>
        </p>
      )}
      {mode === "home" && homeLoading && (
        <p className="muted" role="status">
          Loading project details…
        </p>
      )}

      <div className="project-search">
        <input
          type="search"
          aria-label={`Search ${project.name}`}
          placeholder="Search this project"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
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
            {searching && (
              <p className="muted" role="status">
                Searching…
              </p>
            )}
            {searchFailed && (
              <p role="status">
                Search unavailable.{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Retry
                </button>
              </p>
            )}
            {!searching && !searchFailed && searchResults.length === 0 && (
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
              disabled={busy || !canWrite}
              onChange={(e) => setDeadline({ day: e.target.value || null })}
            />
            {/* 5 pm unless another time is picked; clearing it goes back
                to 5 pm. */}
            {deadline && (
              <DateField
                type="time"
                value={deadline.clock}
                disabled={busy || !canWrite}
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
                      disabled={busy || !canWrite}
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
                      Choose tasks to claim and include in Plan this project.
                    </legend>
                    {unassigned.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={claiming.includes(item.id)}
                          disabled={busy || !canWrite}
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
                  disabled={busy || !canWrite}
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
                          disabled={busy || !canWrite}
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
                    disabled={busy}
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    placeholder="https://…"
                    aria-label="Link URL"
                    maxLength={2000}
                  />
                  <input
                    disabled={busy}
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
                    disabled={busy}
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
                    disabled={busy || !canWrite}
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
                      throw e;
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
            <button className="secondary" onClick={() => void loadHistory()}>
              Refresh
            </button>
          </div>
          <ProjectTimeMachine projectId={project.id} report={report} />
          {historyFailed && (
            <p role="status">
              History unavailable.{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => void loadHistory()}
              >
                Retry
              </button>
            </p>
          )}
          {activity === null ? (
            <p className="muted">
              {historyFailed ? "" : "Loading project history…"}
            </p>
          ) : activity.length === 0 ? (
            <p className="project-history-empty muted">No changes yet.</p>
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
                  if (canWrite && !busy && dragging) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragging;
                  const item = items.find((i) => i.id === id);
                  setDragging(null);
                  if (canWrite && item && item.stage_id !== column.id)
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
                      draggable={canWrite && !busy}
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
                    disabled={busy || !canWrite}
                    title="Rename this stage"
                  >
                    {stage.name}
                  </button>
                  <span className="muted stage-count">{rows.length}</span>
                  <button
                    className="text-button"
                    onClick={() => addExisting(stage.id)}
                    disabled={busy || !canWrite}
                  >
                    <Plus size={13} /> Add task
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => removeStage(stage)}
                    disabled={busy || !canWrite}
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
                          disabled={busy || !canWrite}
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
                disabled={busy || !canWrite}
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
                      disabled={busy || !canWrite}
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

          <button
            className="add-stage"
            onClick={addStage}
            disabled={busy || !canWrite}
          >
            <Plus size={14} /> Add a stage
          </button>
        </div>
      )}
    </div>
  );
}

function ProjectEditorDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
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
      ref={focus.ref as RefObject<HTMLDialogElement>}
      className="project-record-dialog"
      aria-label={title}
      data-modal-owner={focus.id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>,
    document.body,
  );
}

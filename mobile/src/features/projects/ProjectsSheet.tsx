import React, { useEffect, useRef, useState } from "react";
import { ProjectChats } from "./ProjectChats";
import { onLive } from "../../lib/live";
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "../../motion";
import {
  activityOriginLabel,
  changeProjectDeadline,
  projectDeadlineAt,
  projectDeadlineParts,
  projectPlanStatus,
  projectProgress,
  searchProjects,
  projectReentry,
  deadlineOf,
  shortMinutes,
  snippetRuns,
  type Item,
  type Project,
  type ProjectLink,
  type ProjectPlanning,
  type ProjectSession,
  type Plan,
  type ProjectActivity,
  type Proposal,
  type Team,
  type DocSummary,
  type WorkRecord,
  type SearchHit,
} from "@orbyn/core";
import { Segmented } from "../../components/Segmented";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { Pill } from "../../components/Pill";
import { ClockField, DateField } from "../../components/Field";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ActionSheet, MoreMenu } from "../../components/MoreMenu";
import { showToast } from "../../components/Toast";
import { ProjectMilestones } from "./ProjectMilestones";
import { copyLink, shareLink } from "../../lib/share";
import { SmallAction } from "../../components/SmallAction";
import { InlineDetails } from "../../components/InlineDetails";
import { Icon } from "../../components/Icon";
import { ProposalReview } from "../review/ProposalReview";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import * as Crypto from "expo-crypto";
import { session } from "../../lib/session";
import { ChoicePicker } from "../../components/ChoicePicker";
import { useRun } from "../../hooks/useRun";
import { ProjectNotes } from "./ProjectNotes";
import { TemplatesPanel } from "./TemplatesPanel";
import { ProjectTimeline } from "./ProjectTimeline";
import { ProjectRecords } from "./ProjectRecords";
import { ProjectTimeMachine } from "./ProjectTimeMachine";
import { useImports } from "../documents/library/Uploads";
import { PromiseTracker } from "./PromiseTracker";
import { colors, fonts, inputFontSize, radii, themed } from "../../theme";
import { errorText } from "../../lib/errors";
import { tap } from "../../lib/haptics";
import { LinkedHere } from "../documents/editor/links";
import { ConnectionsMap } from "../documents/editor/ConnectionsMap";
import { FieldsSection } from "../views/FieldsSection";
import { AliasesField } from "../documents/metadata/AliasesField";
import { LookEditor } from "../../components/LookEditor";
import { CoverImage, LookIconView } from "../../components/Look";
import { deviceTimeZone } from "../planner/planning";

/** "Fri 16 Oct, 5 pm", or just the day. */
const deadlineDay = (iso: string, withTime = true) => {
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
};

const dueLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
    : "No deadline";

/**
 * Projects on the phone: the list, then one project's stages with the tasks
 * in each. Moving a task between stages stays on the desktop, where there is
 * room for a board.
 */
export function ProjectsSheet(
  props: React.ComponentProps<typeof ProjectsBody>,
) {
  return (
    <ProjectsBody key={`${session.token}:${props.userId ?? ""}`} {...props} />
  );
}
/** Related resources follow the content owner, even before effects settle. */
function useProjectState<T>(id: string | undefined, initial: T) {
  const empty = useRef(initial).current;
  const latest = useRef(id);
  latest.current = id;
  const [receipt, setReceipt] = useState({ id, value: empty });
  const value = receipt.id === id ? receipt.value : empty;
  const setValue: React.Dispatch<React.SetStateAction<T>> = (next) => {
    if (latest.current !== id) return;
    setReceipt((previous) => ({
      id,
      value:
        typeof next === "function"
          ? (next as (value: T) => T)(
              previous.id === id ? previous.value : empty,
            )
          : next,
    }));
  };
  return [value, setValue] as const;
}
function ProjectsBody({
  visible,
  items,
  teams = [],
  openTemplate = null,
  initialProjectId = null,
  initialSection = null,
  initialSourceId = null,
  onInitialProjectShown,
  canWriteIn,
  userId,
  onClose,
  onDismiss,
  beforeLeave,
  onOpenItem: openItem,
  onOpenNote: openNote,
  onOpenPlanner: openPlanner,
  onAskProject: askProject,
  onItemsChanged,
  startNew = false,
  openProject = null,
  onStarted,
}: {
  visible: boolean;
  /** Open on a new project's name (the + sheet's New project). */
  startNew?: boolean;
  /** Open on this project (a link to it). */
  openProject?: string | null;
  /** The sheet has taken up `startNew` or `openProject`. */
  onStarted?: () => void;
  items: Item[];
  /** For starting a template's project in a team. */
  teams?: Team[];
  /** Open on this template (from a "ready to start" notice). */
  openTemplate?: string | null;
  initialProjectId?: string | null;
  initialSection?: "decisions" | "history" | null;
  initialSourceId?: string | null;
  onInitialProjectShown?: () => void;
  canWriteIn: (teamId: string | null) => boolean;
  userId?: string;
  onClose: () => void;
  beforeLeave?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  onDismiss?: () => void;
  onOpenItem?: (item: Item) => void;
  /** Opens one of a project's notes, in the page editor. */
  onOpenNote?: (docId: string, blockId?: string | null) => void;
  onOpenPlanner: (plan: Plan, title: string) => void;
  onAskProject?: (project: Project, question?: string, chatId?: string) => void;
  /** Called when a task moved, so the planner's lists catch up. */
  onItemsChanged?: () => void;
}) {
  const sheet = sheetStyles;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const visibleProjects = searchProjects(projects ?? [], libraryQuery);
  const [open, setOpen] = useState<Project | null>(null);
  const [chatsOpen, setChatsOpen] = useState(false);
  useEffect(() => setChatsOpen(false), [open?.id, visible]);
  /** A project card held down: its menu (MOB-07). */
  const [heldProject, setHeldProject] = useState<Project | null>(null);
  // Opened: it leads the search's recent list, and ⌘K's on the web.
  useEffect(() => {
    if (open?.id) void client.recordRecent("project", open.id).catch(() => {});
  }, [open?.id]);
  const [newSummary, setNewSummary] = useState("");
  const [newTeam, setNewTeam] = useState<string | null>(null);
  const [newDue, setNewDue] = useState<string | null>(null);
  const [section, setSection] = useState<
    "home" | "tasks" | "notes" | "timeline" | "decisions" | "history"
  >("home");
  const [focusSourceId, setFocusSourceId] = useState<string | null>(null);
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
  const [planning, setPlanning] = useProjectState<ProjectPlanning | null>(
    open?.id,
    null,
  );
  type Resource = "planning" | "sessions" | "home" | "history";
  type Phase = "idle" | "loading" | "ready" | "failed";
  const [readPhase, setReadPhase] = useProjectState<Record<Resource, Phase>>(
    open?.id,
    { planning: "idle", sessions: "idle", home: "idle", history: "idle" },
  );
  const [readRetry, setReadRetry] = useProjectState<Record<Resource, number>>(
    open?.id,
    { planning: 0, sessions: 0, home: 0, history: 0 },
  );
  const markRead = (kind: Resource, phase: Phase) =>
    setReadPhase((previous) => ({ ...previous, [kind]: phase }));
  const resourceState = (kind: Resource) => {
    const label = {
      planning: "project planning",
      sessions: "sessions",
      home: "pages, files and links",
      history: "project history",
    }[kind];
    if (readPhase[kind] === "ready") return null;
    if (readPhase[kind] === "failed")
      return (
        <View>
          <Text accessibilityRole="alert" style={styles.meta}>
            Couldn’t load {label}.
          </Text>
          <Button
            title={`Retry ${label}`}
            secondary
            disabled={busy}
            onPress={() =>
              setReadRetry((previous) => ({
                ...previous,
                [kind]: previous[kind] + 1,
              }))
            }
          />
        </View>
      );
    return <Text style={styles.meta}>Loading {label}…</Text>;
  };
  const [sessions, setSessions] = useProjectState<ProjectSession[]>(
    open?.id,
    [],
  );
  const [homeNotes, setHomeNotes] = useProjectState<DocSummary[]>(open?.id, []);
  const [homeRecords, setHomeRecords] = useProjectState<WorkRecord[]>(
    open?.id,
    [],
  );
  const [homeLinks, setHomeLinks] = useProjectState<ProjectLink[]>(
    open?.id,
    [],
  );
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchRecords, setSearchRecords] = useState<SearchHit[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [searchRetry, setSearchRetry] = useState(0);
  useEffect(() => {
    setSearchQuery("");
    setSearchHits([]);
    setSearchRecords([]);
  }, [open?.id]);
  /** A name being typed, for a new project or a rename. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Unassigned team tasks ticked to claim with "Plan this project". */
  const [claiming, setClaiming] = useState<string[]>([]);
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null);
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const appearanceProjectId = useRef(open?.id);
  appearanceProjectId.current = open?.id;
  const [lookOpen, setLookOpen] = useState(false);
  useEffect(() => setLookOpen(false), [open?.id]);
  const [templatesOpen, setTemplatesOpen] = useState(!!openTemplate);
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(null);
  useEffect(() => {
    if (openTemplate && visible) {
      setOpen(null);
      setAiDraftOpen(false);
      setSavedTemplateId(null);
      setTemplatesOpen(true);
    }
  }, [openTemplate, visible]);
  useEffect(() => {
    if (!visible || !initialProjectId) return;
    const request = ++navigationRead.current;
    let live = true;
    void client.getProject(initialProjectId).then(
      (project) => {
        if (!live || !owns() || request !== navigationRead.current) return;
        setSection(initialSection ?? "home");
        setFocusSourceId(initialSourceId);
        setOpen(project);
        onInitialProjectShown?.();
      },
      (e) => {
        if (live && owns() && request === navigationRead.current)
          setError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [visible, initialProjectId, initialSection, initialSourceId]);
  const [projectPrompt, setProjectPrompt] = useState("");
  const [projectProposal, setProjectProposal] = useState<Proposal | null>(null);
  const [proposalState, setProposalState] = useState<"pending" | "applied">(
    "pending",
  );
  const { busy, error, setError, run: execute } = useRun();
  const mounted = useRef(false);
  const owner = useRef(session.token);
  const shown = useRef(visible);
  shown.current = visible;
  const activeProject = useRef(open?.id);
  activeProject.current = open?.id;
  const lock = useRef(false);
  const fieldState = useRef<{
    id: string | undefined;
    dirty: boolean;
    pending: boolean;
  }>({ id: undefined, dirty: false, pending: false });
  const [fieldStateShown, setFieldStateShown] = useState(fieldState.current);
  const [fieldDiscard, setFieldDiscard] = useState(0);
  const fieldsPending =
    fieldStateShown.id === open?.id && fieldStateShown.pending;
  const fieldsDirty = () =>
    fieldState.current.id === open?.id && fieldState.current.dirty;
  const checkFields = () => {
    if (fieldState.current.id === open?.id && fieldState.current.pending) {
      setError("Finish or cancel the field edit before leaving.");
      return false;
    }
    return true;
  };
  const navigationRead = useRef(0);
  const projectRead = useRef(0);
  const requests = useRef(new Map<string, string>());
  const briefReceipts = useRef(
    new Map<string, Awaited<ReturnType<typeof client.createDoc>>>(),
  );
  const owns = () =>
    mounted.current && shown.current && owner.current === session.token;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      navigationRead.current++;
      projectRead.current++;
    };
  }, []);
  const run = async <T,>(
    operation: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (lock.current || !owns()) return undefined;
    lock.current = true;
    navigationRead.current++;
    try {
      return await execute(operation);
    } finally {
      lock.current = false;
    }
  };
  const [projectConfirm, setProjectConfirm] = useState<{
    projectId: string | undefined;
    title: string;
    message: string;
    label: string;
    destructive: boolean;
    action: () => void;
  } | null>(null);
  const confirmAction = (
    title: string,
    message: string,
    label: string,
    action: () => void,
    destructive = true,
  ) => {
    if (owns() && !lock.current)
      setProjectConfirm({
        projectId: open?.id,
        title,
        message,
        label,
        destructive,
        action,
      });
  };
  const departureWait = useRef<((allowed: boolean) => void) | null>(null);
  const [leave, setLeave] = useState<{
    projectId: string | undefined;
    next: () => void;
    fieldsOnly?: boolean;
  } | null>(null);
  const hasDraft = () =>
    fieldsDirty() ||
    (draft !== null && draft !== (open?.name ?? "")) ||
    !!newSummary.trim() ||
    !!newDue ||
    !!newTeam ||
    (summaryDraft !== null && summaryDraft !== open?.summary) ||
    !!stageDraft?.name.trim() ||
    !!linkUrl.trim() ||
    !!linkTitle.trim() ||
    (aiDraftOpen &&
      proposalState !== "applied" &&
      (!!projectPrompt.trim() || !!projectProposal));
  const depart = (next: () => void) => {
    if (lock.current || !owns() || !checkFields() || departureWait.current)
      return;
    if (hasDraft()) setLeave({ projectId: open?.id, next });
    else next();
  };
  const prepareDeparture = useRef<() => Promise<boolean>>(async () => false);
  prepareDeparture.current = async () => {
    if (
      lock.current ||
      !owns() ||
      !checkFields() ||
      leave ||
      departureWait.current
    )
      return false;
    if (!hasDraft()) return true;
    return new Promise<boolean>((resolve) => {
      departureWait.current = resolve;
      setLeave({
        projectId: open?.id,
        next: () => {
          departureWait.current = null;
          resolve(true);
        },
      });
    });
  };
  useEffect(() => {
    if (!beforeLeave || !visible) return;
    const projectId = open?.id;
    const guard = () =>
      activeProject.current === projectId
        ? prepareDeparture.current()
        : Promise.resolve(false);
    beforeLeave.current = guard;
    return () => {
      if (beforeLeave.current === guard) beforeLeave.current = null;
      departureWait.current?.(false);
      departureWait.current = null;
    };
  }, [beforeLeave, visible, open?.id]);
  const changeSection = (next: typeof section) => {
    if (
      section === next ||
      lock.current ||
      !owns() ||
      !checkFields() ||
      departureWait.current
    )
      return;
    if (fieldsDirty())
      setLeave({
        projectId: open?.id,
        fieldsOnly: true,
        next: () => setSection(next),
      });
    else setSection(next);
  };
  const onOpenItem = openItem
    ? (item: Item) => {
        if (owns() && !lock.current) depart(() => openItem(item));
      }
    : undefined;
  const onOpenNote = openNote
    ? (id: string, blockId?: string | null, confirmed = false) => {
        if (!owns() || (lock.current && !confirmed)) return;
        if (confirmed) {
          if (!checkFields() || fieldsDirty()) {
            setError("Save or discard field changes before opening the page.");
            return;
          }
          openNote(id, blockId);
        } else depart(() => openNote(id, blockId));
      }
    : undefined;
  const onOpenPlanner = (plan: Plan, title: string, confirmed = false) => {
    if (!owns() || (lock.current && !confirmed)) return;
    if (confirmed) {
      if (!checkFields() || fieldsDirty()) {
        setError("Save or discard field changes before opening the planner.");
        return;
      }
      openPlanner(plan, title);
    } else depart(() => openPlanner(plan, title));
  };
  const onAskProject = askProject
    ? (project: Project, question?: string, chatId?: string) => {
        if (owns() && !lock.current)
          depart(() => askProject(project, question, chatId));
      }
    : undefined;
  const projectImports = useImports(
    setError,
    () => {
      if (open)
        void client
          .listDocs({ project: open.id })
          .then(setHomeNotes)
          .catch((e) => setError(errorText(e)));
    },
    open?.id,
    open?.team_id,
  );

  useEffect(() => {
    if (!visible || !open || section !== "history") return;
    let active = true;
    setActivity(null);
    markRead("history", "loading");
    void client
      .projectActivity(open.id)
      .then((rows) => {
        if (active && owns()) {
          setActivity(rows);
          markRead("history", "ready");
        }
      })
      .catch((e: Error) => {
        if (active && owns()) {
          markRead("history", "failed");
          setError(errorText(e));
        }
      });
    return () => {
      active = false;
    };
  }, [visible, open?.id, section, readRetry.history, setError]);

  useEffect(() => {
    if (!visible || !open) return;
    let active = true;
    setLastSeen(null);
    setReentry(null);
    void Promise.all([
      client.visitProject(open.id),
      client.projectActivity(open.id),
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
      .catch((reason: Error) => {
        if (active)
          setError(reason.message || "Could not load project changes.");
      });
    return () => {
      active = false;
    };
  }, [visible, open?.id, setError]);

  useEffect(() => {
    if (!visible || !open) return;
    let active = true;
    setPlanning(null);
    markRead("planning", "loading");
    void client.projectPlanning(open.id).then(
      (summary) => {
        if (active && owns()) {
          setPlanning(summary);
          markRead("planning", "ready");
        }
      },
      (reason: Error) => {
        if (active && owns()) {
          markRead("planning", "failed");
          setError(errorText(reason));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [visible, open?.id, open?.deadline, items, readRetry.planning, setError]);

  useEffect(() => {
    if (!visible || !open || (section !== "timeline" && section !== "home"))
      return;
    let active = true;
    markRead("sessions", "loading");
    void client.projectSessions(open.id).then(
      (rows) => {
        if (active && owns()) {
          setSessions(rows);
          markRead("sessions", "ready");
        }
      },
      (reason: Error) => {
        if (active && owns()) {
          markRead("sessions", "failed");
          setError(errorText(reason));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [visible, open?.id, section, items, readRetry.sessions, setError]);

  useEffect(() => {
    if (!visible || !open || section !== "home") return;
    let active = true;
    markRead("home", "loading");
    setHomeNotes([]);
    setHomeRecords([]);
    setHomeLinks([]);
    void Promise.all([
      client.listDocs({ project: open.id }),
      client.listWorkRecords({ project_id: open.id }),
      client.listProjectLinks(open.id),
    ]).then(
      ([notes, records, links]) => {
        if (active && owns()) {
          markRead("home", "ready");
          setHomeNotes(notes);
          setHomeRecords(records);
          setHomeLinks(links);
        }
      },
      (reason: Error) => {
        if (active && owns()) {
          markRead("home", "failed");
          setError(errorText(reason));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [visible, open?.id, section, readRetry.home, setError]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!visible || !open || q.length < 2) {
      setSearchHits([]);
      setSearchRecords([]);
      setSearchState("idle");
      return;
    }
    setSearchHits([]);
    setSearchRecords([]);
    setSearchState("loading");
    let active = true;
    const timer = setTimeout(() => {
      // One server search: pages, tasks and the project's decisions.
      void client.search(q, { project: open.id, limit: 30 }).then(
        (hits) => {
          if (!active || !owns()) return;
          setSearchState("ready");
          setSearchHits(hits.filter((hit) => hit.type !== "record"));
          setSearchRecords(
            hits.filter(
              (hit) => hit.type === "record" && hit.kind === "decision",
            ),
          );
        },
        (reason: Error) => {
          if (active && owns()) {
            setSearchState("failed");
            setError(errorText(reason));
          }
        },
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [visible, open?.id, searchQuery, searchRetry, setError]);

  /** True when the list could not be read, which is not the same as empty. */
  const [failed, setFailed] = useState(false);
  /** The task whose stage is being chosen, if any. */
  const [moving, setMoving] = useState<string | null>(null);
  const [placementRetry, setPlacementRetry] = useProjectState<{
    itemId: string;
    title: string;
    version: number;
    stageId: string | null;
    unfile: boolean;
  } | null>(open?.id, null);
  const retryItem = placementRetry
    ? items.find((item) => item.id === placementRetry.itemId)
    : null;
  /**
   * A stage being named. `id` null means a new one. The desktop asks with
   * `prompt`, which a phone has not got, so the name is typed in place.
   */
  const [stageDraft, setStageDraft] = useState<{
    id: string | null;
    name: string;
  } | null>(null);
  /** The stage an existing task is being picked for, if any. */
  const [filling, setFilling] = useState<string | null | undefined>(undefined);

  /** Save a patch to the open project and keep the list in step. */
  const save = (patch: Parameters<typeof client.updateProject>[1]) =>
    run(async () => {
      if (!open || !canWriteIn(open.team_id)) return;
      const projectId = open.id;
      const saved = await client.updateProject(projectId, patch);
      if (!owns() || activeProject.current !== projectId) return;
      setOpen(saved);
      await reload();
      return saved;
    });

  const createProjectPage = (asBrief: boolean) =>
    void run(async () => {
      if (!open || !onOpenNote || !canWriteIn(open.team_id)) return;
      const input = {
        title: asBrief ? `${open.name} brief` : "",
        kind: "note" as const,
        project_id: open.id,
        team_id: open.team_id,
        content: [{ type: "paragraph" as const, text: "" }],
      };
      const requestKey = JSON.stringify(["project-page", input]);
      let requestId = requests.current.get(requestKey);
      if (!requestId) {
        requestId = Crypto.randomUUID();
        requests.current.set(requestKey, requestId);
      }
      const doc =
        (asBrief ? briefReceipts.current.get(open.id) : null) ??
        (await client.once(requestId, () => client.createDoc(input)));
      if (asBrief) briefReceipts.current.set(open.id, doc);
      else requests.current.delete(requestKey);
      if (!owns() || activeProject.current !== open.id) return;
      const summary: DocSummary = { ...doc, preview: "" };
      setHomeNotes((rows) => [
        summary,
        ...rows.filter((row) => row.id !== doc.id),
      ]);
      if (asBrief) {
        const saved = await client.updateProject(open.id, { doc_id: doc.id });
        if (!owns() || activeProject.current !== open.id) return;
        setOpen(saved);
        briefReceipts.current.delete(open.id);
        requests.current.delete(requestKey);
        await reload();
      } else {
        setHomeNotes(await client.listDocs({ project: open.id }));
      }
      if (owns()) onOpenNote(doc.id, null, true);
    });

  const saveProjectLink = () =>
    void run(async () => {
      if (!open || !canWriteIn(open.team_id) || !linkUrl.trim()) return;
      const projectId = open.id;
      const url = linkUrl,
        title = linkTitle;
      const input = { url: url.trim(), title: title.trim() };
      const key = JSON.stringify([projectId, input]);
      let requestId = requests.current.get(key);
      if (!requestId) {
        requestId = Crypto.randomUUID();
        requests.current.set(key, requestId);
      }
      const saved = await client.once(requestId, () =>
        client.addProjectLink(projectId, input),
      );
      if (!owns() || activeProject.current !== projectId) return;
      setHomeLinks((rows) => [
        ...rows.filter((row) => row.id !== saved.id),
        saved,
      ]);
      setLinkUrl((value) => (value === url ? "" : value));
      setLinkTitle((value) => (value === title ? "" : value));
      setAddingLink(false);
      try {
        const rows = await client.listProjectLinks(projectId);
        if (owns() && activeProject.current === projectId) setHomeLinks(rows);
      } catch {
        if (owns()) setError("Link saved. Couldn’t refresh project links.");
      }
    });

  const removeProjectLink = (linkId: string) =>
    void run(async () => {
      if (!open || !canWriteIn(open.team_id)) return;
      await client.removeProjectLink(open.id, linkId);
      setHomeLinks((links) => links.filter((link) => link.id !== linkId));
    });

  const addProjectFile = () => {
    if (!open || !canWriteIn(open.team_id)) return;
    const choose = () =>
      void projectImports
        .pickAndImport()
        .catch((reason) => setError(errorText(reason)));
    if (open.team_id) {
      confirmAction(
        `Add a file to ${open.name}?`,
        `Everyone in ${open.team_name ?? "this team"} will be able to read the page made from it.`,
        "Choose file",
        choose,
        false,
      );
    } else choose();
  };

  /** The open project's deadline as the day and time it is here. */
  const openDeadline = open?.deadline
    ? projectDeadlineParts(open.deadline, deviceTimeZone())
    : null;
  const homeTasks = open
    ? items
        .filter(
          (item) =>
            item.project_id === open.id &&
            item.kind === "task" &&
            item.status !== "done" &&
            item.status !== "cancelled",
        )
        .sort(
          (a, b) =>
            Date.parse(deadlineOf(a) ?? open.deadline ?? "9999-12-31") -
            Date.parse(deadlineOf(b) ?? open.deadline ?? "9999-12-31"),
        )
        .slice(0, 5)
    : [];
  const now = Date.now();
  const homeSessions = sessions
    .filter(
      (session) =>
        Date.parse(session.start_at) >= now &&
        Date.parse(session.start_at) < now + 7 * 86_400_000,
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 7);
  const openQuestions = homeRecords.filter(
    (record) =>
      record.status === "open" &&
      ((record.kind === "decision" && !record.linked_item_id) ||
        (record.kind === "promise" &&
          record.due_at &&
          Date.parse(record.due_at) < now + 7 * 86_400_000)),
  );
  const searchTasks = searchHits.filter((hit) => hit.type === "task");
  const searchPages = searchHits.filter((hit) => hit.type === "doc");
  const searchResults: SearchHit[] = [
    ...searchTasks,
    ...searchPages,
    ...searchRecords,
  ];
  const openSearchHit = (hit: SearchHit) => {
    if (hit.type === "doc") onOpenNote?.(hit.id, hit.block_id);
    else if (hit.type === "record") changeSection("decisions");
    else {
      const item = items.find((task) => task.id === hit.id);
      if (item) onOpenItem?.(item);
    }
  };
  const markedSearch = (value: string) => {
    const q = searchQuery.trim();
    const at = value.toLowerCase().indexOf(q.toLowerCase());
    if (!q || at < 0) return value;
    return (
      <>
        {value.slice(0, at)}
        <Text style={styles.searchMark}>{value.slice(at, at + q.length)}</Text>
        {value.slice(at + q.length)}
      </>
    );
  };
  const renderSearchHit = (hit: SearchHit) => (
    <Pressable
      key={hit.id}
      style={styles.searchHit}
      onPress={() => openSearchHit(hit)}
      accessibilityRole="button"
    >
      <Text style={styles.stageName}>{markedSearch(hit.title)}</Text>
      <Text style={styles.meta} numberOfLines={2}>
        {snippetRuns(hit.snippet ?? "").map((run, index) => (
          <Text key={index} style={run.hit ? styles.searchMark : undefined}>
            {run.text}
          </Text>
        ))}
      </Text>
    </Pressable>
  );

  /** The stages as the API wants them back: every one, named. */
  const stagesOf = (project: Project) =>
    project.stages.map((st) => ({ id: st.id, name: st.name }));

  /** Add a stage, or rename the one being edited. */
  const saveStage = () => {
    const name = (stageDraft?.name ?? "").trim();
    if (!open || !stageDraft) return;
    if (!name) return setError("Give the stage a name.");
    const id = stageDraft?.id ?? null;
    void save({
      stages:
        id === null
          ? [...stagesOf(open), { name }]
          : stagesOf(open).map((st) => (st.id === id ? { ...st, name } : st)),
    }).then((saved) => {
      if (saved && owns())
        setStageDraft((value) =>
          value?.id === id && value.name.trim() === name ? null : value,
        );
    });
  };

  const removeStage = (stage: { id: string; name: string }) => {
    if (!open) return;
    confirmAction(
      `Remove the “${stage.name}” stage?`,
      "Its tasks stay in the project, without a stage.",
      "Remove",
      () => save({ stages: stagesOf(open).filter((st) => st.id !== stage.id) }),
    );
  };

  /** Take a task out of the project altogether; it stays in the planner. */
  const unfile = (item: Item) =>
    void run(async () => {
      if (!open || !canWriteIn(open.team_id)) return;
      try {
        await client.setItemProject(item.id, {
          project_id: null,
          version: item.version,
        });
      } catch (error) {
        if (
          owns() &&
          activeProject.current === open.id &&
          (error as { status?: number }).status === 409
        ) {
          setPlacementRetry({
            itemId: item.id,
            title: item.title,
            version: item.version,
            stageId: null,
            unfile: true,
          });
          onItemsChanged?.();
        }
        throw error;
      }
      if (!owns() || activeProject.current !== open.id) return;
      setPlacementRetry(null);
      setMoving(null);
      onItemsChanged?.();
    });

  /**
   * Move a task to another stage. The desktop does this by dragging across a
   * board; a phone has no room for one, so the stages are offered as a list
   * under the task instead.
   */
  const moveTo = (item: Item, stageId: string | null) =>
    void run(async () => {
      if (!open || !canWriteIn(open.team_id)) return;
      try {
        await client.setItemProject(item.id, {
          version: item.version,
          project_id: open.id,
          stage_id: stageId,
        });
      } catch (error) {
        if (
          owns() &&
          activeProject.current === open.id &&
          (error as { status?: number }).status === 409
        ) {
          setPlacementRetry({
            itemId: item.id,
            title: item.title,
            version: item.version,
            stageId,
            unfile: false,
          });
          onItemsChanged?.();
        }
        throw error;
      }
      if (!owns() || activeProject.current !== open.id) return;
      setPlacementRetry(null);
      setMoving(null);
      onItemsChanged?.();
    });

  /**
   * Read the list of projects. A failure is not an empty workspace: saying
   * "no projects yet" when the network hiccuped tells someone their work
   * has gone.
   */
  const reload = async () => {
    const request = ++projectRead.current;
    try {
      const list = await client.listProjects();
      if (!owns() || request !== projectRead.current) return false;
      setProjects(list);
      setFailed(false);
      return true;
    } catch (e) {
      if (owns() && request === projectRead.current) {
        setFailed(true);
        setError(errorText(e));
      }
      return false;
    }
  };

  // Projects changed elsewhere (another device, a teammate, a connected
  // agent) while this is open: read them again, once for a burst.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!visible) return;
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
      soon = setTimeout(() => void reloadRef.current(), 400);
    });
    return () => {
      clearTimeout(soon);
      stop();
    };
  }, [visible]);

  const create = () => {
    const name = (draft ?? "").trim();
    if (!name) return;
    void run(async () => {
      if (newTeam && !canWriteIn(newTeam)) {
        setError("Choose a space you can edit.");
        return;
      }
      const input = {
        name,
        summary: newSummary.trim(),
        team_id: newTeam,
        // 5 pm on the day, where you are (the same rule as editing it).
        deadline: newDue
          ? projectDeadlineAt(newDue, null, deviceTimeZone())
          : null,
      };
      const key = JSON.stringify(input);
      let requestId = requests.current.get(key);
      if (!requestId) {
        requestId = Crypto.randomUUID();
        requests.current.set(key, requestId);
      }
      const made = await client.once(requestId, () =>
        client.createProject(input),
      );
      if (!owns()) return;
      setOpen(made);
      setSection("home");
      setDraft(null);
      setNewSummary("");
      setNewTeam(null);
      setNewDue(null);
      if (!(await reload()) && owns())
        setError("Project created. Couldn’t refresh projects.");
    });
  };

  // One form for a new project, in the empty state and above the list: the
  // name, what it's for, whose it is and when it's due, as on the desktop.
  const writableTeams = teams.filter((t) => canWriteIn(t.id));
  const newProjectForm = (
    <View style={styles.newForm}>
      <TextInput
        style={styles.nameInput}
        editable={!busy}
        value={draft ?? ""}
        autoFocus
        maxLength={120}
        placeholder="What is it called?"
        placeholderTextColor={colors.faint}
        accessibilityLabel="New project name"
        onChangeText={setDraft}
      />
      <TextInput
        style={[styles.nameInput, styles.summaryInput]}
        editable={!busy}
        value={newSummary}
        multiline
        maxLength={2000}
        placeholder="What it's for (optional)"
        placeholderTextColor={colors.faint}
        accessibilityLabel="What the project is for"
        onChangeText={setNewSummary}
      />
      <ChoicePicker
        label="Project space"
        value={newTeam ?? "personal"}
        disabled={busy}
        options={[
          { value: "personal", label: "Personal" },
          ...writableTeams.map((team) => ({
            value: team.id,
            label: team.name,
          })),
        ]}
        onChange={(value) => setNewTeam(value === "personal" ? null : value)}
      />
      <DateField
        label="Deadline"
        disabled={busy}
        value={newDue}
        clearable
        placeholder="No deadline (optional)"
        onChange={setNewDue}
      />
      <View style={styles.createMore}>
        <Button
          title="Cancel"
          secondary
          disabled={busy}
          style={styles.createHalf}
          onPress={() =>
            depart(() => {
              setDraft(null);
              setNewSummary("");
              setNewTeam(null);
              setNewDue(null);
            })
          }
        />
        <Button
          title="Create project"
          disabled={busy || !(draft ?? "").trim()}
          style={styles.createHalf}
          onPress={create}
        />
      </View>
    </View>
  );

  const startAiDraft = () => {
    setDraft(null);
    setProjectPrompt("");
    setProjectProposal(null);
    setProposalState("pending");
    setAiDraftOpen(true);
  };

  const draftWithAi = () => {
    const prompt = projectPrompt.trim();
    if (!prompt || busy) return;
    void run(async () => {
      const proposal = await client.draftProject(
        prompt,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        newTeam || null,
        { summary: prompt },
      );
      setProjectProposal(proposal);
      setProposalState("pending");
    });
  };

  const applyAiDraft = (giveTasksDeadlines = true) => {
    if (!projectProposal || proposalState === "applied" || busy) return;
    void run(async () => {
      const { project_id } = await client.applyProposal(projectProposal.id, {
        give_tasks_deadlines: giveTasksDeadlines,
      });
      if (!owns()) return;
      setProposalState("applied");
      await reload();
      onItemsChanged?.();
      // Open the project it made.
      const made = project_id
        ? await client.getProject(project_id).catch(() => null)
        : null;
      if (made && owns()) setOpen(made);
    });
  };

  const rename = () => {
    const name = (draft ?? "").trim();
    if (!open || !canWriteIn(open.team_id) || !name || name === open.name)
      return setDraft(null);
    void run(async () => {
      const saved = await client.updateProject(open.id, { name });
      if (!owns() || activeProject.current !== open.id) return;
      setOpen(saved);
      setDraft(null);
      await reload();
    });
  };

  /** Owners and admins (the owner, for a personal project) decide what AI may read. */
  const canManageAi = (p: Project) =>
    p.team_id
      ? ["owner", "admin"].includes(
          teams.find((t) => t.id === p.team_id)?.role ?? "",
        )
      : p.user_id === userId;

  const keepOut = (off: boolean) => {
    if (!open || !canManageAi(open)) return;
    const go = () =>
      void run(async () => {
        const saved = await client.setProjectAssistant(open.id, off);
        if (!owns() || activeProject.current !== open.id) return;
        setOpen(saved);
        await reload();
      });
    if (!off) return go();
    confirmAction(
      `Keep “${open.name}” out of the assistant?`,
      "No AI will read this project or anything in it: not the assistant, Study, the morning agenda, search by meaning or connected agents.",
      "Keep it out",
      go,
      false,
    );
  };

  const remove = () => {
    if (!open || !canWriteIn(open.team_id)) return;
    confirmAction(
      `Delete “${open.name}”?`,
      "Its tasks stay in your planner, unfiled.",
      "Delete",
      () =>
        void run(async () => {
          await client.deleteProject(open.id);
          if (!owns() || activeProject.current !== open.id) return;
          setOpen(null);
          await reload();
        }),
    );
  };

  useEffect(() => {
    if (!visible) return;
    void reload();
    if (startNew) {
      setOpen(null);
      setAiDraftOpen(false);
      setTemplatesOpen(false);
      setDraft("");
      onStarted?.();
    }
    if (openProject) {
      onStarted?.();
      void run(async () => {
        setAiDraftOpen(false);
        setTemplatesOpen(false);
        setOpen(await client.getProject(openProject));
        setSection("tasks");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** Tasks in no project at all, which any stage can take. */
  // Only tasks in the open project's own space can be filed into it.
  const unfiled = items.filter(
    (i) =>
      !i.project_id &&
      i.kind === "task" &&
      (i.team_id ?? null) === (open?.team_id ?? null),
  );

  const tasksIn = (project: Project, stageId: string | null) =>
    items.filter(
      (i) =>
        i.project_id === project.id &&
        (stageId === null
          ? !i.stage_id || !project.stages.some((s) => s.id === i.stage_id)
          : i.stage_id === stageId),
    );

  // One full-width way in, and the two quicker starts side by side: the
  // same on an empty list as above a full one.
  const createButtons = (
    <View style={styles.createMore}>
      <Button
        title="New project"
        icon="plus"
        disabled={busy}
        style={styles.createHalf}
        onPress={() => setDraft("")}
      />
      <MoreMenu
        label="New project options"
        disabled={busy}
        actions={[
          { label: "Draft with AI", icon: "sparkles", onPress: startAiDraft },
          {
            label: "Use a template",
            icon: "layoutGrid",
            onPress: () => setTemplatesOpen(true),
          },
        ]}
      />
    </View>
  );
  return (
    <Sheet
      visible={visible}
      title={
        open
          ? "Project"
          : draft !== null
            ? "New project"
            : aiDraftOpen
              ? "Draft a project"
              : templatesOpen
                ? "Templates"
                : "Projects"
      }
      guardedClose
      closeDisabled={busy || fieldsPending}
      onClose={() => depart(onClose)}
      onBack={
        open
          ? () =>
              depart(() => {
                setOpen(null);
                setDraft(null);
                setSummaryDraft(null);
                setStageDraft(null);
                setAddingLink(false);
                setLinkUrl("");
                setLinkTitle("");
              })
          : aiDraftOpen
            ? () => depart(() => setAiDraftOpen(false))
            : templatesOpen
              ? () => setTemplatesOpen(false)
              : undefined
      }
      onDismiss={onDismiss}
    >
      {chatsOpen && open && onAskProject && (
        <ProjectChats
          key={open.id}
          projectId={open.id}
          onClose={() => setChatsOpen(false)}
          onOpen={(id) => {
            setChatsOpen(false);
            onAskProject(open, undefined, id);
          }}
        />
      )}
      <ScrollView
        contentContainerStyle={sheet.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={sheet.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {placementRetry && open && (
            <View>
              <Text style={styles.meta}>
                “{placementRetry.title}” changed. Review its current placement
                before retrying your saved choice:{" "}
                {placementRetry.unfile
                  ? "No project"
                  : `${open.name} / ${open.stages.find((stage) => stage.id === placementRetry.stageId)?.name ?? "No stage"}`}
                .
              </Text>
              {retryItem && (
                <Text style={styles.meta}>
                  Current placement:{" "}
                  {retryItem.project_id === open.id
                    ? `${open.name} / ${open.stages.find((stage) => stage.id === retryItem.stage_id)?.name ?? "No stage"}`
                    : retryItem.project_id
                      ? "Another project"
                      : "No project"}
                  .
                </Text>
              )}
              <SmallAction
                label="Retry saved move"
                disabled={
                  busy ||
                  !canWriteIn(open.team_id) ||
                  !retryItem ||
                  retryItem.version <= placementRetry.version ||
                  (!placementRetry.unfile &&
                    !!retryItem.project_id &&
                    retryItem.project_id !== open.id)
                }
                onPress={() => {
                  if (!retryItem || retryItem.version <= placementRetry.version)
                    return;
                  if (placementRetry.unfile) unfile(retryItem);
                  else moveTo(retryItem, placementRetry.stageId);
                }}
              />
              {retryItem && onOpenItem && (
                <SmallAction
                  label="Open task"
                  disabled={busy}
                  onPress={() => onOpenItem(retryItem)}
                />
              )}
              <SmallAction
                label="Refresh tasks"
                disabled={busy}
                onPress={() => onItemsChanged?.()}
              />
              <SmallAction
                label="Dismiss saved move"
                disabled={busy}
                onPress={() => setPlacementRetry(null)}
              />
            </View>
          )}
          {failed && projects !== null && !open && draft === null && (
            <Button
              title="Retry projects"
              secondary
              disabled={busy}
              onPress={() => void reload()}
            />
          )}
          {!open && !aiDraftOpen && !templatesOpen && draft === null && (
            <PromiseTracker
              userId={userId}
              canWriteIn={canWriteIn}
              onError={setError}
              onProject={(id) =>
                void run(async () => {
                  setOpen(await client.getProject(id));
                  setSection("home");
                })
              }
            />
          )}

          {templatesOpen ? (
            <TemplatesPanel
              teams={teams}
              items={items}
              initialId={savedTemplateId ?? openTemplate}
              busy={busy}
              run={run}
              onStarted={() => {
                void reload();
                onItemsChanged?.();
              }}
            />
          ) : aiDraftOpen ? (
            <View style={styles.aiDraft}>
              <View style={styles.aiHeading}>
                <View style={styles.aiIcon}>
                  <Icon name="sparkles" size={19} color={colors.accent} />
                </View>
                <View style={styles.aiHeadingText}>
                  <Text style={styles.aiTitle}>Project brief</Text>
                  <Text style={styles.aiDescription}>
                    Review the draft before creating tasks.
                  </Text>
                </View>
              </View>
              {!projectProposal ? (
                <>
                  <TextInput
                    style={styles.promptInput}
                    editable={!busy}
                    value={projectPrompt}
                    onChangeText={setProjectPrompt}
                    multiline
                    autoFocus
                    maxLength={4000}
                    placeholder="Goal, deadline and requirements"
                    placeholderTextColor={colors.faint}
                    textAlignVertical="top"
                    accessibilityLabel="Describe your project"
                  />
                  <Button
                    title={busy ? "Drafting…" : "Draft project"}
                    icon="sparkles"
                    disabled={busy || !projectPrompt.trim()}
                    onPress={draftWithAi}
                  />
                </>
              ) : (
                <>
                  <ProposalReview
                    proposal={projectProposal}
                    items={items}
                    busy={busy}
                    state={proposalState}
                    onApprove={applyAiDraft}
                    onDiscard={() => {
                      if (!lock.current && owns()) setProjectProposal(null);
                    }}
                  />
                  {proposalState === "applied" && (
                    <Button
                      title="Back to projects"
                      secondary
                      onPress={() => setAiDraftOpen(false)}
                    />
                  )}
                </>
              )}
            </View>
          ) : open ? (
            <View style={styles.page}>
              {/* Its cover and icon (W6), shared across devices. */}
              <CoverImage
                fileId={open.cover_file_id}
                height={120}
                style={{ borderRadius: radii.input, marginBottom: 12 }}
              />
              {draft === null ? (
                <View style={styles.titleRow}>
                  <LookIconView icon={open.icon} size={24} />
                  <Text style={styles.title}>{open.name}</Text>
                  <MoreMenu
                    label="Project options"
                    title={open.name}
                    disabled={busy}
                    actions={[
                      {
                        label: "Copy link",
                        onPress: () =>
                          void copyLink(
                            { kind: "project", id: open.id },
                            open.name,
                          ),
                      },
                      {
                        label: "Share link…",
                        onPress: () =>
                          void shareLink(
                            { kind: "project", id: open.id },
                            open.name,
                          ),
                      },
                      ...(canManageAi(open)
                        ? [
                            {
                              label: open.assistant_off
                                ? "Let the assistant read it"
                                : "Keep out of the assistant",
                              onPress: () => keepOut(!open.assistant_off),
                            },
                          ]
                        : []),
                      ...(canWriteIn(open.team_id)
                        ? [
                            {
                              label: "Cover and icon",
                              onPress: () => setLookOpen(true),
                            },
                            {
                              label: "Rename",
                              onPress: () => setDraft(open.name),
                            },
                            {
                              label: "Edit summary & brief",
                              onPress: () => setSummaryDraft(open.summary),
                            },
                            {
                              label: "Mark active",
                              onPress: () => save({ status: "active" }),
                            },
                            {
                              label: "Mark done",
                              onPress: () => save({ status: "done" }),
                            },
                            {
                              label: "Archive",
                              onPress: () => save({ status: "archived" }),
                            },
                            ...(canManageAi(open)
                              ? [
                                  {
                                    label: "Save as template",
                                    onPress: () =>
                                      void run(async () => {
                                        const template =
                                          await client.templateFromProject(
                                            open.id,
                                          );
                                        setSavedTemplateId(template.id);
                                        setOpen(null);
                                        setAiDraftOpen(false);
                                        setTemplatesOpen(true);
                                        showToast({
                                          text: `Saved “${template.name}” as a template`,
                                        });
                                      }),
                                  },
                                ]
                              : []),
                            {
                              label: "Delete project",
                              destructive: true,
                              onPress: remove,
                            },
                          ]
                        : []),
                    ]}
                  />
                </View>
              ) : (
                <TextInput
                  style={styles.nameInput}
                  editable={!busy}
                  value={draft}
                  autoFocus
                  maxLength={120}
                  placeholder="Project name"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Project name"
                  onChangeText={setDraft}
                  onSubmitEditing={rename}
                />
              )}
              {draft !== null && (
                <View style={styles.actions}>
                  <SmallAction label="Save" disabled={busy} onPress={rename} />
                  <SmallAction
                    label="Cancel"
                    disabled={busy}
                    onPress={() => setDraft(null)}
                  />
                </View>
              )}

              {summaryDraft !== null && (
                <View style={styles.homeSection}>
                  <Text style={styles.reentryTitle}>Summary & brief</Text>
                  <TextInput
                    style={styles.summaryInput}
                    editable={!busy}
                    value={summaryDraft}
                    multiline
                    maxLength={2000}
                    placeholder="What is this project for?"
                    placeholderTextColor={colors.faint}
                    onChangeText={setSummaryDraft}
                  />
                  <View style={styles.actions}>
                    <SmallAction
                      label="Save"
                      disabled={busy}
                      onPress={() => {
                        const snapshot = summaryDraft;
                        void save({ summary: snapshot.trim() }).then(
                          (saved) => {
                            if (saved && owns())
                              setSummaryDraft((value) =>
                                value === snapshot ? null : value,
                              );
                          },
                        );
                      }}
                    />
                    <SmallAction
                      label="Cancel"
                      disabled={busy}
                      onPress={() => setSummaryDraft(null)}
                    />
                  </View>
                </View>
              )}
              <View style={styles.bar}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${projectProgress(open)}%` },
                  ]}
                />
              </View>
              <Text style={styles.meta}>
                {open.done_count} of {open.task_count} done ·{" "}
                {dueLabel(open.deadline)}
              </Text>
              {resourceState("planning")}
              {planning && open.task_count > 0 && open.status === "active" && (
                <View style={styles.planning}>
                  {(() => {
                    const chip = projectPlanStatus(planning);
                    const late = planning.late_session_count;
                    const writable = canWriteIn(open.team_id);
                    const unassigned = open.team_id
                      ? items.filter(
                          (item) =>
                            item.project_id === open.id &&
                            item.kind === "task" &&
                            item.status !== "done" &&
                            item.status !== "cancelled" &&
                            !item.assignee_id,
                        )
                      : [];
                    const claimed = claiming.filter((id) =>
                      unassigned.some((item) => item.id === id),
                    );
                    return (
                      <>
                        {!!open.deadline && (
                          <Text style={styles.reentryTitle}>
                            Deadline {deadlineDay(open.deadline)}
                          </Text>
                        )}
                        <Text style={styles.meta}>
                          Your part: {shortMinutes(planning.planned_minutes)} of{" "}
                          {shortMinutes(planning.needed_minutes)} planned
                          {open.deadline ? " before it" : ""}
                          {planning.planned_finish_at
                            ? ` · Planned finish ${deadlineDay(planning.planned_finish_at, false)}`
                            : ""}
                        </Text>
                        {!!chip && (
                          <View style={styles.planChip}>
                            <Pill
                              label={chip.label}
                              tone={
                                chip.status === "on_track"
                                  ? "accent"
                                  : "warning"
                              }
                            />
                          </View>
                        )}
                        {late > 0 && (
                          <Text style={[styles.meta, styles.planWarn]}>
                            {late === 1
                              ? "1 session after its task's deadline"
                              : `${late} sessions after their tasks' deadlines`}
                          </Text>
                        )}
                        {planning.unestimated_tasks.length > 0 && (
                          <Text style={styles.meta}>
                            Needs an estimate:{" "}
                            {planning.unestimated_tasks
                              .map((task) => task.title)
                              .join(", ")}
                          </Text>
                        )}
                        {!!open.team_id && (
                          <Text style={styles.meta}>
                            {planning.team_planned_minutes !== undefined
                              ? `Team: ${shortMinutes(planning.team_planned_minutes)} planned by everyone`
                              : "Only your sessions are counted"}
                          </Text>
                        )}
                        {writable && unassigned.length > 0 && (
                          <>
                            <Text style={styles.meta}>
                              Unassigned tasks: tick the ones you'll take on.
                              They become yours and are planned too.
                            </Text>
                            <ChipRow label="Unassigned tasks to claim" multi>
                              {unassigned.map((item) => (
                                <Chip
                                  key={item.id}
                                  multi
                                  compact
                                  label={item.title}
                                  selected={claiming.includes(item.id)}
                                  disabled={busy}
                                  onPress={() =>
                                    setClaiming((ids) =>
                                      ids.includes(item.id)
                                        ? ids.filter((id) => id !== item.id)
                                        : [...ids, item.id],
                                    )
                                  }
                                />
                              ))}
                            </ChipRow>
                          </>
                        )}
                        {writable && (
                          <Button
                            title="Plan this project"
                            secondary
                            disabled={busy}
                            onPress={() =>
                              void run(async () => {
                                const plan = await client.planProject(
                                  open.id,
                                  deviceTimeZone(),
                                  claimed,
                                );
                                if (
                                  !owns() ||
                                  activeProject.current !== open.id
                                )
                                  return;
                                setClaiming([]);
                                if (claimed.length) onItemsChanged?.();
                                onOpenPlanner(plan, `Plan ${open.name}`, true);
                              })
                            }
                          />
                        )}
                      </>
                    );
                  })()}
                </View>
              )}
              {reentry && reentry.total > 0 && (
                <View style={styles.reentry}>
                  <Text style={styles.reentryTitle}>Since your last visit</Text>
                  <Text style={styles.meta}>
                    {reentry.total} change{reentry.total === 1 ? "" : "s"}
                    {reentry.completedTasks > 0
                      ? ` · ${reentry.completedTasks} completed`
                      : ""}
                    {reentry.changedRecords > 0
                      ? ` · ${reentry.changedRecords} commitment updates`
                      : ""}
                  </Text>
                  {reentry.recent.map((summary, index) => (
                    <Text key={`${summary}-${index}`} style={styles.meta}>
                      • {summary}
                    </Text>
                  ))}
                  <SmallAction
                    label="View history"
                    disabled={busy}
                    onPress={() => changeSection("history")}
                  />
                  {onAskProject && assistant.enabled && reentry.total >= 2 && (
                    <View>
                      <SmallAction
                        label="Explain what changed"
                        disabled={busy}
                        onPress={() =>
                          onAskProject(
                            open,
                            "Explain what changed in this project since my last visit, with sources.",
                          )
                        }
                      />
                      {assistant.tools && (
                        <SmallAction
                          label="Draft an update"
                          disabled={busy}
                          onPress={() =>
                            onAskProject(
                              open,
                              "Draft a project update page from the changes since my last visit. Show me the draft to edit and keep.",
                            )
                          }
                        />
                      )}
                    </View>
                  )}
                </View>
              )}
              <InlineDetails title="Project details">
                <Text style={styles.meta}>
                  {open.deadline ? deadlineDay(open.deadline) : "No deadline"}
                </Text>
                <Text style={styles.meta}>
                  {open.team_name ||
                    (open.team_id
                      ? teams.find((team) => team.id === open.team_id)?.name ||
                        "Shared"
                      : "Personal")}
                </Text>
                {/* The desktop has a date field beside the progress bar; the
                  phone only ever said what the deadline was. */}
                {canWriteIn(open.team_id) && (
                  <>
                    <DateField
                      label="Deadline"
                      disabled={busy}
                      clearable
                      placeholder="No deadline"
                      value={openDeadline?.day ?? null}
                      onChange={(day) =>
                        save({
                          deadline: changeProjectDeadline(
                            open.deadline,
                            { day },
                            deviceTimeZone(),
                          ),
                        })
                      }
                    />
                    {/* 5 pm unless another time is picked. */}
                    {openDeadline && (
                      <ClockField
                        label="Deadline time"
                        value={openDeadline.clock}
                        disabled={busy}
                        onChange={(clock) =>
                          save({
                            deadline: changeProjectDeadline(
                              open.deadline,
                              { clock },
                              deviceTimeZone(),
                            ),
                          })
                        }
                      />
                    )}
                  </>
                )}
              </InlineDetails>
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                placeholder="Search this project"
                placeholderTextColor={colors.faint}
                accessibilityLabel={`Search ${open.name}`}
                returnKeyType="search"
                onChangeText={setSearchQuery}
                onSubmitEditing={() => {
                  if (searchResults[0]) openSearchHit(searchResults[0]);
                }}
              />
              {searchQuery.trim().length >= 2 && (
                <View style={styles.searchResults}>
                  {searchState === "loading" && (
                    <Text style={styles.meta}>Searching…</Text>
                  )}
                  {searchState === "failed" && (
                    <View>
                      <Text style={styles.meta}>
                        Couldn’t search this project.
                      </Text>
                      <Button
                        title="Retry search"
                        secondary
                        disabled={busy}
                        onPress={() => setSearchRetry((value) => value + 1)}
                      />
                    </View>
                  )}
                  {searchState === "ready" && searchResults.length === 0 && (
                    <Text style={styles.meta}>No matches in this project.</Text>
                  )}
                  {searchTasks.length > 0 && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>
                        Tasks ({searchTasks.length})
                      </Text>
                      {searchTasks.map(renderSearchHit)}
                    </View>
                  )}
                  {searchPages.length > 0 && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>
                        Pages ({searchPages.length})
                      </Text>
                      {searchPages.map(renderSearchHit)}
                    </View>
                  )}
                  {searchRecords.length > 0 && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>
                        Decisions ({searchRecords.length})
                      </Text>
                      {searchRecords.map(renderSearchHit)}
                    </View>
                  )}
                  <SmallAction
                    label="Clear search"
                    disabled={busy}
                    onPress={() => setSearchQuery("")}
                  />
                </View>
              )}

              <Segmented
                accessibilityLabel="Project section"
                wrap
                options={
                  onOpenNote
                    ? (["home", "tasks", "notes", "timeline", "more"] as const)
                    : (["home", "tasks", "timeline", "more"] as const)
                }
                labels={{ home: "Home", more: "More" }}
                value={
                  section === "decisions" || section === "history"
                    ? "more"
                    : section
                }
                onChange={(next) =>
                  changeSection(next === "more" ? "decisions" : next)
                }
              />
              {(section === "decisions" || section === "history") && (
                <ChipRow label="More of this project">
                  <Chip
                    compact
                    label="Decisions"
                    selected={section === "decisions"}
                    onPress={() => changeSection("decisions")}
                  />
                  <Chip
                    compact
                    label="History"
                    selected={section === "history"}
                    onPress={() => changeSection("history")}
                  />
                </ChipRow>
              )}
              {onAskProject && !open.assistant_off && (
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  <SmallAction
                    label="New chat"
                    disabled={busy}
                    onPress={() => onAskProject(open)}
                  />
                  <SmallAction
                    label="Chats"
                    disabled={busy}
                    onPress={() => setChatsOpen(true)}
                  />
                </View>
              )}
              {open.assistant_off && (
                <Text style={styles.meta}>
                  Kept out of the assistant: no AI reads this project.
                </Text>
              )}
              {section === "home" && (
                <View style={styles.home}>
                  {resourceState("home")}
                  {resourceState("sessions")}
                  <ProjectMilestones
                    projectId={open.id}
                    items={items.filter((i) => i.project_id === open.id)}
                    canWrite={canWriteIn(open.team_id)}
                    onChanged={onItemsChanged}
                    onError={(e) => setError(errorText(e))}
                  />
                  {homeTasks.length > 0 && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>Coming due</Text>
                      {homeTasks.map((item) => (
                        <Pressable
                          key={item.id}
                          onPress={() => onOpenItem?.(item)}
                        >
                          <Text style={styles.stageName}>{item.title}</Text>
                          <Text style={styles.meta}>
                            {dueLabel(deadlineOf(item) ?? open.deadline)}
                          </Text>
                        </Pressable>
                      ))}
                      <SmallAction
                        label="All tasks"
                        disabled={busy}
                        onPress={() => changeSection("tasks")}
                      />
                    </View>
                  )}
                  {homeSessions.length > 0 && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>Next 7 days</Text>
                      {homeSessions.map((session) => {
                        const item = items.find(
                          (task) => task.id === session.item_id,
                        );
                        return (
                          <Pressable
                            key={session.id}
                            onPress={() => item && onOpenItem?.(item)}
                          >
                            <Text style={styles.stageName}>
                              {item?.title ?? "Session"}
                            </Text>
                            <Text style={styles.meta}>
                              {new Date(session.start_at).toLocaleString([], {
                                weekday: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  {(open.summary ||
                    open.doc_id ||
                    (canWriteIn(open.team_id) && onOpenNote)) && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>Brief</Text>
                      {!!open.summary && (
                        <Text style={styles.summary}>{open.summary}</Text>
                      )}
                      {!!open.doc_id && !!onOpenNote && (
                        <SmallAction
                          label="Open brief"
                          disabled={busy}
                          onPress={() => onOpenNote(open.doc_id!)}
                        />
                      )}
                      {!open.doc_id &&
                        canWriteIn(open.team_id) &&
                        !!onOpenNote && (
                          <SmallAction
                            label="Write a brief"
                            disabled={busy}
                            onPress={() => createProjectPage(true)}
                          />
                        )}
                    </View>
                  )}
                  {(homeNotes.length > 0 ||
                    homeLinks.length > 0 ||
                    canWriteIn(open.team_id)) && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>Pages & files</Text>
                      {homeLinks.map((link) => (
                        <View key={link.id} style={styles.linkRow}>
                          <Pressable
                            style={styles.linkBody}
                            onPress={() =>
                              void Linking.openURL(link.url).catch((reason) =>
                                setError(errorText(reason)),
                              )
                            }
                          >
                            <Text style={styles.stageName}>
                              {link.title || link.url}
                            </Text>
                          </Pressable>
                          {canWriteIn(open.team_id) && (
                            <SmallAction
                              label="Remove"
                              disabled={busy}
                              onPress={() => removeProjectLink(link.id)}
                            />
                          )}
                        </View>
                      ))}
                      {addingLink && canWriteIn(open.team_id) && (
                        <View style={styles.homeSection}>
                          <TextInput
                            style={styles.nameInput}
                            editable={!busy}
                            value={linkUrl}
                            onChangeText={setLinkUrl}
                            placeholder="https://…"
                            placeholderTextColor={colors.faint}
                            autoCapitalize="none"
                            keyboardType="url"
                            maxLength={2000}
                            accessibilityLabel="Link URL"
                          />
                          <TextInput
                            style={styles.nameInput}
                            editable={!busy}
                            value={linkTitle}
                            onChangeText={setLinkTitle}
                            placeholder="Title (optional)"
                            placeholderTextColor={colors.faint}
                            maxLength={200}
                            accessibilityLabel="Link title"
                          />
                          <View style={styles.linkRow}>
                            <SmallAction
                              label="Save link"
                              disabled={busy || !linkUrl.trim()}
                              onPress={saveProjectLink}
                            />
                            <SmallAction
                              label="Cancel"
                              disabled={busy}
                              onPress={() => setAddingLink(false)}
                            />
                          </View>
                        </View>
                      )}
                      {homeNotes.slice(0, 5).map(
                        (note) =>
                          !!onOpenNote && (
                            <Pressable
                              key={note.id}
                              onPress={() => onOpenNote(note.id)}
                            >
                              <Text style={styles.stageName}>
                                {note.title || "Untitled"}
                              </Text>
                              {!!note.preview && (
                                <Text style={styles.meta}>{note.preview}</Text>
                              )}
                            </Pressable>
                          ),
                      )}
                      {homeNotes.length > 0 && !!onOpenNote && (
                        <SmallAction
                          label="All pages & files"
                          disabled={busy}
                          onPress={() => changeSection("notes")}
                        />
                      )}
                      {canWriteIn(open.team_id) && !!onOpenNote && (
                        <SmallAction
                          label="New page"
                          disabled={busy}
                          onPress={() => createProjectPage(false)}
                        />
                      )}
                      {canWriteIn(open.team_id) && (
                        <SmallAction
                          label={
                            projectImports.busy ? "Uploading…" : "Add a file"
                          }
                          disabled={busy || projectImports.busy}
                          onPress={addProjectFile}
                        />
                      )}
                      {canWriteIn(open.team_id) &&
                        homeLinks.length < 20 &&
                        !addingLink && (
                          <SmallAction
                            label="Add link"
                            disabled={busy}
                            onPress={() => setAddingLink(true)}
                          />
                        )}
                    </View>
                  )}
                  {openQuestions.length > 0 && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>Open questions</Text>
                      {openQuestions.slice(0, 5).map((record) => (
                        <Text key={record.id} style={styles.stageName}>
                          {record.title}
                        </Text>
                      ))}
                      <SmallAction
                        label="All decisions"
                        disabled={busy}
                        onPress={() => changeSection("decisions")}
                      />
                    </View>
                  )}
                  {/* Other names, such as a course code (LNK-03). */}
                  {(canWriteIn(open.team_id) ||
                    (open.aliases ?? []).length > 0) && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>Also called</Text>
                      <AliasesField
                        key={open.id}
                        aliases={open.aliases ?? []}
                        canWrite={canWriteIn(open.team_id) && !busy}
                        placeholder="Add another name, like COMP3100"
                        onSave={(aliases) =>
                          client
                            .updateProject(open.id, { aliases })
                            .then((next) => {
                              if (owns())
                                setOpen((current) =>
                                  current?.id === next.id ? next : current,
                                );
                              return next.aliases ?? aliases;
                            })
                        }
                      />
                    </View>
                  )}
                  {/* Your own fields on the project (ORG-02). */}
                  <FieldsSection
                    key={`${open.id}:${fieldDiscard}`}
                    onDraftState={(value) => {
                      if (!owns() || activeProject.current !== open.id) return;
                      const next = { id: open.id, ...value };
                      fieldState.current = next;
                      setFieldStateShown((previous) =>
                        previous.id === next.id &&
                        previous.dirty === next.dirty &&
                        previous.pending === next.pending
                          ? previous
                          : next,
                      );
                    }}
                    target="project"
                    targetId={open.id}
                    revision={open.updated_at}
                    report={(e) => setError(errorText(e as Error))}
                    frame={(content) => (
                      <View style={styles.homeSection}>
                        <Text style={styles.reentryTitle}>Fields</Text>
                        {content}
                      </View>
                    )}
                  />
                  {/* Pages in the project and pages that link to it. */}
                  <LinkedHere
                    kind="project"
                    id={open.id}
                    report={(e) => setError(errorText(e as Error))}
                  />
                  {/* What the project is linked to, one or two steps out. */}
                  <ConnectionsMap
                    kind="project"
                    id={open.id}
                    revision={open.updated_at}
                    report={(e) => setError(errorText(e as Error))}
                  />
                </View>
              )}
              {section === "timeline" && (
                <View>{resourceState("sessions")}</View>
              )}
              {section === "timeline" &&
                (readPhase.sessions === "ready" || sessions.length > 0) && (
                  <ProjectTimeline
                    project={open}
                    tasks={items.filter((i) => i.project_id === open.id)}
                    sessions={sessions}
                    onOpenItem={(item) => onOpenItem?.(item)}
                  />
                )}

              {section === "decisions" && (
                <ProjectRecords
                  focusId={focusSourceId}
                  project={open}
                  items={items}
                  userId={userId}
                  canWrite={canWriteIn(open.team_id)}
                  onOpenNote={onOpenNote}
                />
              )}

              {section === "history" && (
                <View style={styles.projectHistory}>
                  <Text style={styles.historyHeading}>Project history</Text>
                  <Text style={styles.historyDescription}>
                    Changes to the project, its tasks, and its notes.
                  </Text>
                  <ProjectTimeMachine projectId={open.id} />
                  {activity === null ? (
                    resourceState("history")
                  ) : activity.length === 0 ? (
                    <Text style={styles.meta}>
                      Changes will appear here as work on this project evolves.
                    </Text>
                  ) : (
                    <>
                      {lastSeen && (
                        <Text style={styles.historyCatchup}>
                          {
                            activity.filter(
                              (event) => event.created_at > lastSeen,
                            ).length
                          }{" "}
                          {activity.filter(
                            (event) => event.created_at > lastSeen,
                          ).length === 1
                            ? "change since your last visit"
                            : "changes since your last visit"}
                        </Text>
                      )}
                      {[...activity]
                        .sort(
                          (a, b) =>
                            Number(b.id === focusSourceId) -
                            Number(a.id === focusSourceId),
                        )
                        .map((event) => (
                          <View
                            key={event.id}
                            style={[
                              styles.historyEntry,
                              event.id === focusSourceId && styles.sourceFocus,
                            ]}
                          >
                            <Text style={styles.historySummary}>
                              {event.summary}
                            </Text>
                            <Text style={styles.historyMeta}>
                              {event.actor_name ?? "Workspace activity"}
                              {activityOriginLabel(event)
                                ? ` · ${activityOriginLabel(event)}`
                                : ""}{" "}
                              ·{" "}
                              {new Date(event.created_at).toLocaleString([], {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </Text>
                            {event.entity_type === "session" && (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                  const item = items.find(
                                    (i) => i.id === event.entity_id,
                                  );
                                  if (item) onOpenItem?.(item);
                                }}
                              >
                                <Text style={styles.historyMeta}>
                                  Only you see your sessions · Open task
                                </Text>
                              </Pressable>
                            )}
                          </View>
                        ))}
                    </>
                  )}
                </View>
              )}

              {section === "notes" && !!onOpenNote && (
                <ProjectNotes
                  projectId={open.id}
                  teamId={open.team_id}
                  canWrite={canWriteIn(open.team_id)}
                  busy={busy}
                  report={(e) => setError(errorText(e))}
                  onOpen={onOpenNote}
                />
              )}

              {section === "tasks" && (
                <>
                  {[...open.stages, { id: null, name: "No stage" }].map(
                    (stage) => {
                      const rows = tasksIn(open, stage.id as string | null);
                      return (
                        <View key={stage.id ?? "none"} style={styles.stage}>
                          {stageDraft?.id && stageDraft.id === stage.id ? (
                            <TextInput
                              style={styles.nameInput}
                              editable={!busy}
                              value={stageDraft.name}
                              autoFocus
                              maxLength={80}
                              placeholder="Stage name"
                              placeholderTextColor={colors.faint}
                              accessibilityLabel="Stage name"
                              onChangeText={(name) =>
                                setStageDraft({ id: stage.id, name })
                              }
                              onSubmitEditing={saveStage}
                              onBlur={saveStage}
                            />
                          ) : (
                            <View style={styles.stageHead}>
                              <Text style={styles.stageName}>{stage.name}</Text>
                              <Text style={styles.stageCount}>
                                {rows.length}
                              </Text>
                              {/* What you can do to a stage lives behind its
                              ⋯, so the list reads as tasks, not buttons.
                              "No stage" is not a stage: it can only be
                              filled. */}
                              {canWriteIn(open.team_id) && (
                                <MoreMenu
                                  label={`${stage.name} options`}
                                  disabled={busy}
                                  actions={[
                                    {
                                      label:
                                        filling === stage.id
                                          ? "Stop adding tasks"
                                          : "Add a task from your list",
                                      onPress: () =>
                                        setFilling(
                                          filling === stage.id
                                            ? undefined
                                            : stage.id,
                                        ),
                                    },
                                    ...(stage.id === null
                                      ? []
                                      : [
                                          {
                                            label: "Rename stage",
                                            onPress: () =>
                                              setStageDraft({
                                                id: stage.id as string,
                                                name: stage.name,
                                              }),
                                          },
                                          {
                                            label: "Remove stage",
                                            destructive: true,
                                            onPress: () =>
                                              removeStage({
                                                id: stage.id as string,
                                                name: stage.name,
                                              }),
                                          },
                                        ]),
                                  ]}
                                />
                              )}
                            </View>
                          )}
                          {filling === stage.id &&
                            (unfiled.length === 0 ? (
                              <Text style={styles.empty}>
                                Every task is already in a project.
                              </Text>
                            ) : (
                              <ChipRow label="Tasks with no project">
                                {unfiled.slice(0, 20).map((task) => (
                                  <Chip
                                    key={task.id}
                                    label={task.title}
                                    selected={false}
                                    onPress={() => {
                                      setFilling(undefined);
                                      moveTo(task, stage.id as string | null);
                                    }}
                                  />
                                ))}
                              </ChipRow>
                            ))}
                          {rows.length === 0 ? (
                            <Text style={styles.empty}>Nothing here yet.</Text>
                          ) : (
                            rows.map((item) => (
                              <View key={item.id}>
                                <Pressable
                                  style={({ pressed }) => [
                                    styles.task,
                                    pressed && styles.rowPressed,
                                  ]}
                                  onPress={() => onOpenItem?.(item)}
                                >
                                  <View
                                    style={[
                                      styles.dot,
                                      item.status === "done" && styles.dotDone,
                                    ]}
                                  />
                                  <Text
                                    style={[
                                      styles.taskText,
                                      item.status === "done" && styles.taskDone,
                                    ]}
                                    numberOfLines={2}
                                  >
                                    {item.title}
                                  </Text>
                                  {/* Outside the row's own press, or moving a task
                                would open it instead. */}
                                  {canWriteIn(open.team_id) && (
                                    <Pressable
                                      onPress={(event) => {
                                        event.stopPropagation();
                                        setMoving((m) =>
                                          m === item.id ? null : item.id,
                                        );
                                      }}
                                      hitSlop={8}
                                      accessibilityRole="button"
                                      accessibilityLabel={`Move ${item.title}`}
                                      style={styles.moveButton}
                                    >
                                      <Icon
                                        name={
                                          moving === item.id
                                            ? "chevronUp"
                                            : "chevronDown"
                                        }
                                        size={15}
                                        color={colors.faint}
                                      />
                                    </Pressable>
                                  )}
                                </Pressable>
                                {moving === item.id && (
                                  <ChipRow label="Move to">
                                    {[
                                      ...open.stages,
                                      {
                                        id: null as string | null,
                                        name: "No stage",
                                      },
                                    ].map((to) => (
                                      <Chip
                                        key={to.id ?? "none"}
                                        label={to.name}
                                        selected={to.id === stage.id}
                                        onPress={() => moveTo(item, to.id)}
                                      />
                                    ))}
                                    {/* The desktop can take a task out of the
                                  project from here; so can the phone. */}
                                    <Chip
                                      label="Out of this project"
                                      selected={false}
                                      onPress={() => unfile(item)}
                                    />
                                  </ChipRow>
                                )}
                              </View>
                            ))
                          )}
                        </View>
                      );
                    },
                  )}

                  {canWriteIn(open.team_id) &&
                    (stageDraft && stageDraft.id === null ? (
                      <TextInput
                        style={styles.nameInput}
                        editable={!busy}
                        value={stageDraft.name}
                        autoFocus
                        maxLength={80}
                        placeholder="Name the new stage"
                        placeholderTextColor={colors.faint}
                        accessibilityLabel="New stage name"
                        onChangeText={(name) =>
                          setStageDraft({ id: null, name })
                        }
                        onSubmitEditing={saveStage}
                        onBlur={saveStage}
                      />
                    ) : (
                      <View style={styles.stageAdd}>
                        <SmallAction
                          label="Add a stage"
                          disabled={busy}
                          onPress={() => setStageDraft({ id: null, name: "" })}
                        />
                      </View>
                    ))}
                </>
              )}
            </View>
          ) : draft !== null ? (
            newProjectForm
          ) : failed && projects === null ? (
            <View style={styles.list}>
              <Text style={styles.empty}>Couldn’t load projects.</Text>
              <Button
                title="Try again"
                secondary
                disabled={busy}
                onPress={() => void reload()}
              />
            </View>
          ) : projects === null ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : projects.length === 0 ? (
            <View style={styles.emptyProject}>
              <View style={styles.emptyIcon}>
                <Icon name="boxes" size={24} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>No projects yet</Text>
              <Text style={styles.emptyDescription}>
                Add a project to organize related tasks.
              </Text>
              {draft === null ? (
                <View style={styles.emptyActions}>{createButtons}</View>
              ) : (
                <View style={styles.emptyActions}>{newProjectForm}</View>
              )}
            </View>
          ) : (
            <View style={styles.list}>
              {draft === null ? createButtons : newProjectForm}
              <TextInput
                style={styles.searchInput}
                value={libraryQuery}
                onChangeText={setLibraryQuery}
                placeholder="Search projects"
                placeholderTextColor={colors.faint}
                accessibilityLabel="Search projects"
                maxLength={200}
                clearButtonMode="while-editing"
                autoCapitalize="none"
              />
              {!!libraryQuery.trim() && (
                <Text style={styles.meta} accessibilityLiveRegion="polite">
                  {visibleProjects.length} of {projects.length} projects
                </Text>
              )}
              {visibleProjects.length === 0 && (
                <Text style={styles.empty}>
                  No matching projects. Try a different name, alias or
                  workspace.
                </Text>
              )}
              {visibleProjects.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  disabled={busy}
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel={`Open project ${p.name}`}
                  style={({ pressed }) => [
                    styles.card,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() =>
                    void run(async () => {
                      setOpen(await client.getProject(p.id));
                      setSection("tasks");
                    })
                  }
                  delayLongPress={380}
                  onLongPress={() => {
                    tap();
                    setHeldProject(p);
                  }}
                  accessibilityHint="Touch and hold for more"
                  accessibilityActions={[
                    { name: "longpress", label: "More for this project" },
                  ]}
                  onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === "longpress")
                      setHeldProject(p);
                  }}
                >
                  <View style={styles.cardTop}>
                    <Icon name="boxes" size={16} color={colors.muted} />
                    <Text style={styles.cardName}>{p.name}</Text>
                  </View>
                  {!!p.summary && (
                    <Text style={styles.meta} numberOfLines={2}>
                      {p.summary}
                    </Text>
                  )}
                  <Text style={styles.meta}>
                    {p.team_name ||
                      (p.team_id
                        ? teams.find((team) => team.id === p.team_id)?.name ||
                          "Shared"
                        : "Personal")}
                  </Text>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${projectProgress(p)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.meta}>
                    {p.done_count} of {p.task_count} done ·{" "}
                    {dueLabel(p.deadline)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <ActionSheet
        visible={!!leave}
        label="Unsaved project changes"
        title={
          leave?.fieldsOnly ? "Discard field changes?" : "Discard changes?"
        }
        message={
          leave?.fieldsOnly
            ? "Your unsaved field changes will be lost."
            : "Your edits haven't been saved."
        }
        cancelLabel="Keep editing"
        onClose={(selection) => {
          if (selection !== "selected") {
            departureWait.current?.(false);
            departureWait.current = null;
          }
          setLeave(null);
        }}
        actions={[
          {
            label: "Discard changes",
            destructive: true,
            disabled: busy || fieldsPending,
            onPress: () => {
              if (
                leave &&
                owns() &&
                !lock.current &&
                checkFields() &&
                activeProject.current === leave.projectId
              ) {
                fieldState.current = {
                  id: open?.id,
                  dirty: false,
                  pending: false,
                };
                setFieldStateShown(fieldState.current);
                setFieldDiscard((value) => value + 1);
                if (!leave.fieldsOnly) {
                  setDraft(null);
                  setNewSummary("");
                  setNewDue(null);
                  setNewTeam(null);
                  setSummaryDraft(null);
                  setStageDraft(null);
                  setLinkUrl("");
                  setLinkTitle("");
                  setProjectPrompt("");
                  setProjectProposal(null);
                }
                leave.next();
              } else {
                departureWait.current?.(false);
                departureWait.current = null;
              }
            },
          },
        ]}
      />
      <ActionSheet
        visible={!!projectConfirm}
        label={projectConfirm?.title ?? "Project action"}
        title={projectConfirm?.title}
        message={projectConfirm?.message}
        onClose={() => setProjectConfirm(null)}
        actions={
          projectConfirm
            ? [
                {
                  label: projectConfirm.label,
                  destructive: projectConfirm.destructive,
                  disabled: busy,
                  onPress: () => {
                    if (
                      owns() &&
                      !lock.current &&
                      activeProject.current === projectConfirm.projectId
                    )
                      projectConfirm.action();
                  },
                },
              ]
            : []
        }
      />
      {/* A project card held down (MOB-07). */}
      <ActionSheet
        visible={!!heldProject}
        label="Project menu"
        title={heldProject?.name}
        actions={
          heldProject
            ? [
                {
                  label: "Open",
                  icon: "boxes",
                  onPress: () =>
                    void run(async () => {
                      setOpen(await client.getProject(heldProject.id));
                      setSection("tasks");
                    }),
                },
                {
                  label: "Star",
                  icon: "star",
                  onPress: () =>
                    void client
                      .setFavourite("project", heldProject.id, true)
                      .then(
                        () => showToast({ text: "Starred" }),
                        (e: Error) => setError(errorText(e)),
                      ),
                },
                {
                  label: "Copy link",
                  icon: "link",
                  onPress: () =>
                    void copyLink(
                      { kind: "project", id: heldProject.id },
                      heldProject.name,
                    ),
                },
                {
                  label: "Share…",
                  icon: "share",
                  onPress: () =>
                    void shareLink(
                      { kind: "project", id: heldProject.id },
                      heldProject.name,
                    ),
                },
              ]
            : []
        }
        onClose={() => setHeldProject(null)}
      />
      {lookOpen && open && (
        <LookEditor
          key={open.id}
          title={open.name}
          look={{
            icon: open.icon ?? null,
            cover_file_id: open.cover_file_id ?? null,
          }}
          uploadTo={open.doc_id}
          onClose={() => {
            if (appearanceProjectId.current === open.id) setLookOpen(false);
          }}
          onSave={async (look) => {
            const saved = await client.updateProject(open.id, look);
            setOpen((current) => (current?.id === saved.id ? saved : current));
            await reload();
          }}
        />
      )}
    </Sheet>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { gap: 10 },
    createActions: { gap: 8 },
    newForm: { gap: 12 },
    summaryInput: {
      minHeight: 76,
      maxHeight: 180,
      paddingTop: 12,
      textAlignVertical: "top",
    },
    createMore: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    // The container's gap spaces these; the button's own margin would double it.
    createButtonFull: { marginBottom: 0 },
    createHalf: { flexGrow: 1, flexBasis: 120, minWidth: 0, marginBottom: 0 },
    emptyActions: { alignSelf: "stretch", marginTop: 8 },
    aiDraft: { gap: 16 },
    aiHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    aiHeadingText: { flex: 1, minWidth: 0, gap: 4 },
    aiIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    aiTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
    aiDescription: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
      color: colors.muted,
    },
    promptInput: {
      minHeight: 100,
      maxHeight: 220,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
      lineHeight: 22,
    },
    emptyProject: {
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 32,
      paddingBottom: 20,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
      backgroundColor: colors.accentSoft,
    },
    emptyTitle: {
      fontFamily: fonts.bold,
      fontSize: 18,
      lineHeight: 26,
      textAlign: "center",
      color: colors.text,
    },
    emptyDescription: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
      textAlign: "center",
      color: colors.muted,
    },
    card: {
      gap: 6,
      minHeight: 44,
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    moveButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    cardName: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      lineHeight: 20,
      fontFamily: fonts.semibold,
    },
    chip: {
      color: colors.warning,
      backgroundColor: colors.warningSoft,
      fontSize: 11,
      fontFamily: fonts.semibold,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      overflow: "hidden",
    },
    bar: {
      height: 6,
      borderRadius: radii.pill,
      backgroundColor: colors.soft,
      overflow: "hidden",
    },
    barFill: {
      height: 6,
      backgroundColor: colors.accent,
      borderRadius: radii.pill,
    },
    meta: { color: colors.muted, fontSize: 13 },
    home: { gap: 12 },
    searchInput: {
      minHeight: 44,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
    },
    searchResults: { gap: 10 },
    searchHit: { gap: 3, paddingVertical: 7 },
    searchMark: { backgroundColor: colors.accentSoft, color: colors.text },
    homeSection: {
      gap: 10,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    linkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    linkBody: { flex: 1, minWidth: 0 },
    reentry: {
      gap: 7,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    planning: {
      gap: 6,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    planChip: { flexDirection: "row" },
    planWarn: { color: colors.warning },
    reentryTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
    page: { gap: 10 },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    spacer: { flex: 1 },
    newRow: { gap: 8 },
    nameInput: {
      color: colors.text,
      fontSize: inputFontSize,
      fontFamily: fonts.semibold,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 18,
      fontFamily: fonts.display,
    },
    summary: { color: colors.muted, fontSize: 15, lineHeight: 20 },
    projectHistory: {
      gap: 10,
      marginTop: 10,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    historyHeading: {
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.semibold,
    },
    historyDescription: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    historyCatchup: {
      padding: 10,
      borderRadius: radii.input,
      backgroundColor: colors.accentSoft,
      color: colors.text,
      fontSize: 13,
      fontFamily: fonts.medium,
    },
    historyEntry: {
      gap: 4,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    sourceFocus: {
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: radii.input,
      backgroundColor: colors.accentSoft,
    },
    historySummary: { color: colors.text, fontSize: 15, lineHeight: 20 },
    historyMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
    stage: {
      gap: 6,
      marginTop: 6,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    stageHead: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
    },
    stageAdd: { flexDirection: "row", marginTop: 2 },
    stageName: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.semibold,
    },
    stageCount: { color: colors.muted, fontSize: 13 },
    // The move button carries the 44pt target, so the row needs no padding
    // of its own; rows stay one line apart instead of drifting.
    task: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 2,
      minHeight: 48,
      borderRadius: radii.input,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.muted,
    },
    dotDone: { backgroundColor: colors.accent, borderColor: colors.accent },
    taskText: { flex: 1, color: colors.text, fontSize: 15 },
    taskDone: { color: colors.muted, textDecorationLine: "line-through" },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  }),
);

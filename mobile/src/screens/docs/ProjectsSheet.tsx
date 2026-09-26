import React, { useEffect, useRef, useState } from "react";
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
import { ScreenIntro } from "../../components/ScreenIntro";
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
import { confirmAction } from "../../lib/confirm";
import { Icon } from "../../components/Icon";
import { ProposalReview } from "../../components/ProposalReview";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { ProjectNotes } from "./ProjectNotes";
import { TemplatesPanel } from "./TemplatesPanel";
import { ProjectTimeline } from "./ProjectTimeline";
import { ProjectRecords } from "./ProjectRecords";
import { ProjectTimeMachine } from "./ProjectTimeMachine";
import { useImports } from "./Uploads";
import { PromiseTracker } from "./PromiseTracker";
import { colors, fonts, radii, themed } from "../../theme";
import { errorText } from "../../lib/errors";
import { tap } from "../../lib/haptics";
import { LinkedHere } from "./links";
import { ConnectionsMap } from "./ConnectionsMap";
import { FieldsSection } from "../views/FieldsSection";
import { AliasesField } from "./AliasesField";
import { deviceTimeZone } from "../../lib/planning";

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
export function ProjectsSheet({
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
  onOpenItem,
  onOpenNote,
  onOpenPlanner,
  onAskProject,
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
  onDismiss?: () => void;
  onOpenItem?: (item: Item) => void;
  /** Opens one of a project's notes, in the page editor. */
  onOpenNote?: (docId: string, blockId?: string | null) => void;
  onOpenPlanner: (plan: Plan, title: string) => void;
  onAskProject?: (project: Project, question?: string) => void;
  /** Called when a task moved, so the planner's lists catch up. */
  onItemsChanged?: () => void;
}) {
  const sheet = sheetStyles;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState<Project | null>(null);
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
  const [templatesOpen, setTemplatesOpen] = useState(!!openTemplate);
  useEffect(() => {
    if (openTemplate && visible) {
      setOpen(null);
      setAiDraftOpen(false);
      setTemplatesOpen(true);
    }
  }, [openTemplate, visible]);
  useEffect(() => {
    if (!visible || !initialProjectId) return;
    void client.getProject(initialProjectId).then(
      (project) => {
        setSection(initialSection ?? "home");
        setFocusSourceId(initialSourceId);
        setOpen(project);
        onInitialProjectShown?.();
      },
      (e) => setError(errorText(e)),
    );
  }, [visible, initialProjectId, initialSection, initialSourceId]);
  const [projectPrompt, setProjectPrompt] = useState("");
  const [projectProposal, setProjectProposal] = useState<Proposal | null>(null);
  const [proposalState, setProposalState] = useState<"pending" | "applied">(
    "pending",
  );
  const { busy, error, setError, run } = useRun();
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
    void client
      .projectActivity(open.id)
      .then((rows) => {
        if (active) setActivity(rows);
      })
      .catch((e: Error) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [visible, open?.id, section, setError]);

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
    void client.projectPlanning(open.id).then(
      (summary) => {
        if (active) setPlanning(summary);
      },
      (reason: Error) => {
        if (active) setError(errorText(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [visible, open?.id, open?.deadline, items, setError]);

  useEffect(() => {
    if (!visible || !open || (section !== "timeline" && section !== "home"))
      return;
    let active = true;
    void client.projectSessions(open.id).then(
      (rows) => {
        if (active) setSessions(rows);
      },
      (reason: Error) => {
        if (active) setError(errorText(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [visible, open?.id, section, items, setError]);

  useEffect(() => {
    if (!visible || !open || section !== "home") return;
    let active = true;
    setHomeNotes([]);
    setHomeRecords([]);
    setHomeLinks([]);
    void Promise.all([
      client.listDocs({ project: open.id }),
      client.listWorkRecords({ project_id: open.id }),
      client.listProjectLinks(open.id),
    ]).then(
      ([notes, records, links]) => {
        if (active) {
          setHomeNotes(notes);
          setHomeRecords(records);
          setHomeLinks(links);
        }
      },
      (reason: Error) => {
        if (active) setError(errorText(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [visible, open?.id, section, setError]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!visible || !open || q.length < 2) {
      setSearchHits([]);
      setSearchRecords([]);
      return;
    }
    setSearchHits([]);
    setSearchRecords([]);
    let active = true;
    const timer = setTimeout(() => {
      // One server search: pages, tasks and the project's decisions.
      void client.search(q, { project: open.id, limit: 30 }).then(
        (hits) => {
          if (!active) return;
          setSearchHits(hits.filter((hit) => hit.type !== "record"));
          setSearchRecords(
            hits.filter(
              (hit) => hit.type === "record" && hit.kind === "decision",
            ),
          );
        },
        (reason: Error) => {
          if (active) setError(errorText(reason));
        },
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [visible, open?.id, searchQuery, setError]);

  /** True when the list could not be read, which is not the same as empty. */
  const [failed, setFailed] = useState(false);
  /** The task whose stage is being chosen, if any. */
  const [moving, setMoving] = useState<string | null>(null);
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
    void run(async () => {
      if (!open || !canWriteIn(open.team_id)) return;
      setOpen(await client.updateProject(open.id, patch));
      await reload();
    });

  const createProjectPage = (asBrief: boolean) =>
    void run(async () => {
      if (!open || !onOpenNote || !canWriteIn(open.team_id)) return;
      const doc = await client.createDoc({
        title: asBrief ? `${open.name} brief` : "",
        kind: "note",
        project_id: open.id,
        team_id: open.team_id,
        content: [{ type: "paragraph", text: "" }],
      });
      if (asBrief) {
        setOpen(await client.updateProject(open.id, { doc_id: doc.id }));
        await reload();
      } else {
        setHomeNotes(await client.listDocs({ project: open.id }));
      }
      onOpenNote(doc.id);
    });

  const saveProjectLink = () =>
    void run(async () => {
      if (!open || !canWriteIn(open.team_id) || !linkUrl.trim()) return;
      await client.addProjectLink(open.id, {
        url: linkUrl.trim(),
        title: linkTitle.trim(),
      });
      setHomeLinks(await client.listProjectLinks(open.id));
      setLinkUrl("");
      setLinkTitle("");
      setAddingLink(false);
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
    else if (hit.type === "record") setSection("decisions");
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
    if (!open || !name) return setStageDraft(null);
    const id = stageDraft?.id ?? null;
    save({
      stages:
        id === null
          ? [...stagesOf(open), { name }]
          : stagesOf(open).map((st) => (st.id === id ? { ...st, name } : st)),
    });
    setStageDraft(null);
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
      await client.setItemProject(item.id, { project_id: null });
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
      await client.setItemProject(item.id, {
        project_id: open.id,
        stage_id: stageId,
      });
      setMoving(null);
      onItemsChanged?.();
    });

  /**
   * Read the list of projects. A failure is not an empty workspace: saying
   * "no projects yet" when the network hiccuped tells someone their work
   * has gone.
   */
  const reload = () =>
    client.listProjects().then(
      (list) => {
        setProjects(list);
        setFailed(false);
      },
      (e: Error) => {
        setProjects(null);
        setFailed(true);
        setError(errorText(e));
      },
    );

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
      const made = await client.createProject({
        name,
        summary: newSummary.trim(),
        team_id: newTeam,
        // 5 pm on the day, where you are (the same rule as editing it).
        deadline: newDue
          ? projectDeadlineAt(newDue, null, deviceTimeZone())
          : null,
      });
      setDraft(null);
      setNewSummary("");
      setNewTeam(null);
      setNewDue(null);
      await reload();
      setOpen(made);
      setSection("home");
    });
  };

  // One form for a new project, in the empty state and above the list: the
  // name, what it's for, whose it is and when it's due, as on the desktop.
  const writableTeams = teams.filter((t) => canWriteIn(t.id));
  const newProjectForm = (
    <View style={styles.newForm}>
      <TextInput
        style={styles.nameInput}
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
        value={newSummary}
        multiline
        maxLength={2000}
        placeholder="What it's for (optional)"
        placeholderTextColor={colors.faint}
        accessibilityLabel="What the project is for"
        onChangeText={setNewSummary}
      />
      {writableTeams.length > 0 && (
        <ChipRow label="Whose project">
          <Chip
            label="Just me"
            selected={newTeam === null}
            onPress={() => setNewTeam(null)}
          />
          {writableTeams.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              selected={newTeam === t.id}
              onPress={() => setNewTeam(t.id)}
            />
          ))}
        </ChipRow>
      )}
      <DateField
        label="Deadline"
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
          onPress={() => setDraft(null)}
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
    if (!projectProposal || busy) return;
    void run(async () => {
      const { project_id } = await client.applyProposal(projectProposal.id, {
        give_tasks_deadlines: giveTasksDeadlines,
      });
      setProposalState("applied");
      await reload();
      onItemsChanged?.();
      // Open the project it made.
      const made = project_id
        ? await client.getProject(project_id).catch(() => null)
        : null;
      if (made) setOpen(made);
    });
  };

  const rename = () => {
    const name = (draft ?? "").trim();
    if (!open || !canWriteIn(open.team_id) || !name || name === open.name)
      return setDraft(null);
    void run(async () => {
      const saved = await client.updateProject(open.id, { name });
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
    if (!open) return;
    const go = () =>
      void run(async () => {
        setOpen(await client.setProjectAssistant(open.id, off));
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
    <View style={styles.createActions}>
      <Button
        title="New project"
        icon="plus"
        disabled={busy}
        style={styles.createButtonFull}
        onPress={() => setDraft("")}
      />
      <View style={styles.createMore}>
        <Button
          title="Draft with AI"
          secondary
          icon="sparkles"
          disabled={busy}
          style={styles.createHalf}
          onPress={startAiDraft}
        />
        <Button
          title="Template"
          secondary
          icon="layoutGrid"
          disabled={busy}
          style={styles.createHalf}
          onPress={() => setTemplatesOpen(true)}
        />
      </View>
    </View>
  );
  return (
    <Sheet
      visible={visible}
      title={
        open
          ? open.name
          : aiDraftOpen
            ? "Draft a project"
            : templatesOpen
              ? "Templates"
              : "Projects"
      }
      onClose={onClose}
      onBack={
        open
          ? () => setOpen(null)
          : aiDraftOpen
            ? () => setAiDraftOpen(false)
            : templatesOpen
              ? () => setTemplatesOpen(false)
              : undefined
      }
      onDismiss={onDismiss}
    >
      <ScrollView
        contentContainerStyle={sheet.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={sheet.column}>
          {!open && !aiDraftOpen && !templatesOpen && !!projects?.length && (
            <ScreenIntro
              icon="boxes"
              title="Move the bigger picture forward"
              detail="See what’s progressing, what’s next and what needs your attention."
            />
          )}
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {!open && !aiDraftOpen && !templatesOpen && (
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
              initialId={openTemplate}
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
                  <Text style={styles.aiTitle}>Shape your project</Text>
                  <Text style={styles.aiDescription}>
                    Describe the goal and any deadline. Review the tasks and
                    schedule before creating it.
                  </Text>
                </View>
              </View>
              {!projectProposal ? (
                <>
                  <TextInput
                    style={styles.promptInput}
                    value={projectPrompt}
                    onChangeText={setProjectPrompt}
                    multiline
                    autoFocus
                    maxLength={4000}
                    placeholder="What are you working toward?"
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
                    onDiscard={() => setProjectProposal(null)}
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
              {draft === null ? (
                <View style={styles.titleRow}>
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
              {!!open.summary && (
                <Text style={styles.summary}>{open.summary}</Text>
              )}
              {summaryDraft !== null && (
                <View style={styles.homeSection}>
                  <Text style={styles.reentryTitle}>Summary & brief</Text>
                  <TextInput
                    style={styles.summaryInput}
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
                        save({ summary: summaryDraft.trim() });
                        setSummaryDraft(null);
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
                                setClaiming([]);
                                if (claimed.length) onItemsChanged?.();
                                onOpenPlanner(plan, `Plan ${open.name}`);
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
                    onPress={() => setSection("history")}
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
              {/* The desktop has a date field beside the progress bar; the
                  phone only ever said what the deadline was. */}
              {canWriteIn(open.team_id) && (
                <>
                  <DateField
                    label="Deadline"
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
                  {searchResults.length === 0 && (
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
                  setSection(next === "more" ? "decisions" : next)
                }
              />
              {(section === "decisions" || section === "history") && (
                <ChipRow label="More of this project">
                  <Chip
                    compact
                    label="Decisions"
                    selected={section === "decisions"}
                    onPress={() => setSection("decisions")}
                  />
                  <Chip
                    compact
                    label="History"
                    selected={section === "history"}
                    onPress={() => setSection("history")}
                  />
                </ChipRow>
              )}
              {onAskProject && !open.assistant_off && (
                <SmallAction
                  label={`Ask about ${open.name}`}
                  disabled={busy}
                  onPress={() => onAskProject(open)}
                />
              )}
              {open.assistant_off && (
                <Text style={styles.meta}>
                  Kept out of the assistant: no AI reads this project.
                </Text>
              )}
              {section === "home" && (
                <View style={styles.home}>
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
                        onPress={() => setSection("tasks")}
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
                          onPress={() => setSection("notes")}
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
                        onPress={() => setSection("decisions")}
                      />
                    </View>
                  )}
                  {/* Other names, such as a course code (LNK-03). */}
                  {(canWriteIn(open.team_id) ||
                    (open.aliases ?? []).length > 0) && (
                    <View style={styles.homeSection}>
                      <Text style={styles.reentryTitle}>Also called</Text>
                      <AliasesField
                        aliases={open.aliases ?? []}
                        canWrite={canWriteIn(open.team_id)}
                        placeholder="Add another name, like COMP3100"
                        onSave={(aliases) =>
                          client.updateProject(open.id, { aliases }).then(
                            (next) => {
                              setOpen(next);
                              return next.aliases ?? aliases;
                            },
                            (e) => {
                              setError(errorText(e as Error));
                              return open.aliases ?? [];
                            },
                          )
                        }
                      />
                    </View>
                  )}
                  {/* Your own fields on the project (ORG-02). */}
                  <FieldsSection
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
                    <Text style={styles.meta}>Loading project history…</Text>
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
          ) : failed ? (
            <View style={styles.list}>
              <Text style={styles.empty}>
                Your projects could not be reached. They are still there.
              </Text>
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
              <Text style={styles.emptyTitle}>
                Make room for the bigger picture.
              </Text>
              <Text style={styles.emptyDescription}>
                Bring related tasks together, follow their stages, and see
                what’s moving forward.
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
              {projects.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
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
    </Sheet>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { gap: 10 },
    createActions: { gap: 8 },
    newForm: { gap: 12 },
    summaryInput: { minHeight: 76, paddingTop: 12, textAlignVertical: "top" },
    createMore: { flexDirection: "row", gap: 8 },
    // The container's gap spaces these; the button's own margin would double it.
    createButtonFull: { marginBottom: 0 },
    createHalf: { flex: 1, minWidth: 0, marginBottom: 0 },
    emptyActions: { alignSelf: "stretch", marginTop: 8 },
    aiDraft: { gap: 16 },
    aiHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    aiHeadingText: { flex: 1, gap: 4 },
    aiIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    aiTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
    aiDescription: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
      color: colors.muted,
    },
    promptInput: {
      minHeight: 128,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
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
      fontFamily: fonts.display,
      fontSize: 24,
      lineHeight: 29,
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
      gap: 8,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
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
      fontSize: 18,
      lineHeight: 25,
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
      borderRadius: 3,
      backgroundColor: colors.soft,
      overflow: "hidden",
    },
    barFill: { height: 6, backgroundColor: colors.accent, borderRadius: 3 },
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
      fontSize: 15,
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
    linkBody: { flex: 1 },
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
      fontSize: 15,
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

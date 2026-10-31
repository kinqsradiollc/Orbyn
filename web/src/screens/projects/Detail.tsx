import {
  appUrl,
  changeProjectDeadline,
  projectDeadlineParts,
  projectPlanStatus,
  projectProgress,
  projectReentry,
  shortMinutes,
  snippetRuns,
  type Item,
  type Look,
  type Project,
  type ProjectStage,
  type SearchHit,
} from "@orbyn/core";
import {
  ArrowLeft,
  MoreHorizontal,
  Share2,
  Sparkles,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../../app/account";
import { messageOf, useResource } from "../../lib/resource";
import { navigate, useSearch, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  Menu,
  Pill,
  SelectBox,
  TextArea,
  useConfirm,
  useToast,
} from "../../ui/kit";
import {
  deviceTimeZone,
  refreshPlanner,
  tasks,
  useItems,
  usePlanning,
} from "../shared-task";
import { Chats } from "./Chats";
import { History } from "./History";
import { Home } from "./Home";
import { useImports } from "./imports";
import { Cover, LookDialog, LookIcon } from "./look";
import { Pages } from "./Pages";
import { Records } from "./Records";
import { ask, canManageAi, canWriteProject, dayLabel } from "./shared";
import { groupStages, StageBoard, StageList } from "./Stages";
import { Timeline } from "./Timeline";

const MODES = [
  ["home", "Home"],
  ["list", "List"],
  ["board", "Board"],
  ["timeline", "Timeline"],
  ["notes", "Pages & files"],
  ["decisions", "Decisions"],
  ["history", "History"],
] as const;
type Mode = (typeof MODES)[number][0];

type Retry = {
  itemId: string;
  title: string;
  version: number;
  stageId: string | null;
  unfile: boolean;
};

function Search({
  project,
  onDecisions,
}: {
  project: Project;
  onDecisions: () => void;
}) {
  const items = useItems();
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(() => setAsked(q.length < 2 ? "" : q), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const read = useResource<SearchHit[]>(
    () =>
      asked
        ? client.search(asked, { project: project.id, limit: 30 })
        : Promise.resolve([]),
    [asked, project.id],
  );
  const hits = read.data ?? [];
  const groups = [
    { title: "Tasks", rows: hits.filter((h) => h.type === "task") },
    { title: "Pages", rows: hits.filter((h) => h.type === "doc") },
    {
      title: "Decisions",
      rows: hits.filter((h) => h.type === "record" && h.kind === "decision"),
    },
  ];
  const flat = groups.flatMap((g) => g.rows);
  const open = (hit: SearchHit) => {
    if (hit.type === "doc")
      navigate(
        `/app/doc/${hit.id}${hit.block_id ? `#${encodeURIComponent(hit.block_id)}` : ""}`,
      );
    else if (hit.type === "record") onDecisions();
    else {
      const item = items.find((t) => t.id === hit.id);
      tasks.open(item ?? hit.id);
    }
  };
  let at = -1;
  return (
    <div className="pj-find">
      <Input
        type="search"
        aria-label={`Search ${project.name}`}
        placeholder="Search this project"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") setQuery("");
          if (event.key === "ArrowDown" && flat.length) {
            event.preventDefault();
            setIndex((i) => (i + 1) % flat.length);
          }
          if (event.key === "ArrowUp" && flat.length) {
            event.preventDefault();
            setIndex((i) => (i - 1 + flat.length) % flat.length);
          }
          if (event.key === "Enter" && flat.length) {
            event.preventDefault();
            open(flat[index] ?? flat[0]);
          }
        }}
      />
      {query.trim().length >= 2 && (
        <div
          className="pj-find-results"
          role="region"
          aria-label="Project search results"
        >
          {read.loading && !read.data && <Loading label="Searching" />}
          {read.error && (
            <ErrorNotice
              message="Search unavailable."
              onRetry={() => void read.reload()}
            />
          )}
          {asked && read.data && !flat.length && !read.loading && (
            <p className="muted small">No matches in this project.</p>
          )}
          {groups
            .filter((g) => g.rows.length)
            .map((group) => (
              <section key={group.title}>
                <h3>
                  {group.title} ({group.rows.length})
                </h3>
                <ul>
                  {group.rows.map((hit) => {
                    at += 1;
                    const here = at;
                    return (
                      <li key={`${hit.type}:${hit.id}`}>
                        <button
                          className={here === index ? "is-selected" : undefined}
                          onMouseEnter={() => setIndex(here)}
                          onClick={() => open(hit)}
                        >
                          <span dir="auto">{hit.title}</span>
                          <small dir="auto">
                            {snippetRuns(hit.snippet ?? "").map((run, n) =>
                              run.hit ? (
                                <mark key={n}>{run.text}</mark>
                              ) : (
                                <span key={n}>{run.text}</span>
                              ),
                            )}
                          </small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

function Ask({
  title,
  onClose,
  children,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Dialog title={title} onClose={onClose} actions={actions}>
      {children}
    </Dialog>
  );
}

export function Detail({ id }: { id: string }) {
  const { user } = useAccount();
  const userId = user?.id ?? "";
  const search = useSearch();
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const read = useResource(() => client.getProject(id), [id, userId]);
  useTitle(read.data?.name ?? "Project");
  if (read.error && !read.data)
    return (
      <div className="pj">
        <Button variant="ghost" onClick={() => navigate("/app/projects")}>
          <ArrowLeft aria-hidden="true" /> All projects
        </Button>
        {read.error.includes("not found") ||
        read.error.includes("Not found") ? (
          <Empty title="This project isn't available">
            <span>It may have been deleted, or it isn't shared with you.</span>
          </Empty>
        ) : (
          <ErrorNotice
            message={read.error}
            onRetry={() => void read.reload()}
          />
        )}
      </div>
    );
  if (!read.data)
    return (
      <div className="pj">
        <Loading label="Opening project" />
      </div>
    );
  return (
    <Body
      key={`${id}:${userId}`}
      project={read.data}
      userId={userId}
      initialMode={(query.get("section") as Mode) ?? "home"}
      sourceId={query.get("source")}
      onChanged={(next) => read.set(() => next)}
    />
  );
}

function Body({
  project,
  userId,
  initialMode,
  sourceId,
  onChanged,
}: {
  project: Project;
  userId: string;
  initialMode: Mode;
  sourceId: string | null;
  onChanged: (project: Project) => void;
}) {
  const items = useItems();
  const { teams } = usePlanning();
  const confirm = useConfirm();
  const toast = useToast();
  const canWrite = canWriteProject(project, teams);
  const canAi = canManageAi(project, teams, userId);
  const [mode, setMode] = useState<Mode>(
    MODES.some(([m]) => m === initialMode) ? initialMode : "home",
  );
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const linkDraft = useRef(false);
  const [retry, setRetry] = useState<Retry | null>(null);
  const [editing, setEditing] = useState<{
    kind: "rename" | "summary";
    text: string;
  } | null>(null);
  const [editError, setEditError] = useState("");
  const [stageDraft, setStageDraft] = useState<{
    id: string | null;
    name: string;
  } | null>(null);
  const [stageError, setStageError] = useState("");
  const [picker, setPicker] = useState<{
    stageId: string | null;
    itemId: string;
  } | null>(null);
  const [pickerError, setPickerError] = useState("");
  const [lookOpen, setLookOpen] = useState(false);
  const [chats, setChats] = useState(false);
  const [claiming, setClaiming] = useState<string[]>([]);
  const report = (failure: unknown, fallback: string) =>
    toast({ text: messageOf(failure, fallback), error: true });

  useEffect(() => {
    void client.recordRecent("project", project.id).catch(() => undefined);
  }, [project.id]);
  const capabilities = useResource(
    () =>
      client.aiCapabilities().catch(() => ({ enabled: false, tools: false })),
    [],
  );
  const assistant = capabilities.data ?? { enabled: false, tools: false };
  const visit = useResource(async () => {
    const [seen, rows] = await Promise.all([
      client.visitProject(project.id),
      client.projectActivity(project.id),
    ]);
    return {
      since: seen.since_at,
      reentry: seen.since_at
        ? projectReentry(rows.filter((r) => r.created_at > seen.since_at!))
        : null,
    };
  }, [project.id]);
  const planning = useResource(
    () => client.projectPlanning(project.id),
    [project.id, project.deadline, items],
  );
  const needsSessions = mode === "timeline" || mode === "home";
  const sessions = useResource(
    () =>
      needsSessions
        ? client.projectSessions(project.id)
        : Promise.resolve(null),
    [mode, project.id, items],
  );
  const [lastSessions, setLastSessions] = useState<
    NonNullable<typeof sessions.data>
  >([]);
  useEffect(() => {
    if (sessions.data) setLastSessions(sessions.data);
  }, [sessions.data]);
  const home = useResource(async () => {
    const [notes, records, links] = await Promise.all([
      client.listDocs({ project: project.id }),
      client.listWorkRecords({ project_id: project.id }),
      client.listProjectLinks(project.id),
    ]);
    return { notes, records, links };
  }, [mode === "home", project.id]);
  const team = useResource(
    () =>
      project.team_id
        ? client.getTeam(project.team_id).then((t) => t.members)
        : Promise.resolve([]),
    [project.team_id],
  );
  const favourites = useResource(() => client.listFavourites(), [project.id]);
  const starred = (favourites.data ?? []).some(
    (f) => f.kind === "project" && f.target_id === project.id,
  );
  const imports = useImports(
    (text) => toast({ text, error: true }),
    () => void home.reload(),
    project.id,
    project.team_id,
  );
  const grouped = useMemo(() => groupStages(items, project), [items, project]);
  const unassigned = items.filter(
    (i) =>
      i.project_id === project.id &&
      i.team_id === project.team_id &&
      i.kind === "task" &&
      i.status !== "done" &&
      i.status !== "cancelled" &&
      !i.assignee_id,
  );
  const unfiled = items.filter(
    (i) =>
      !i.project_id &&
      i.kind === "task" &&
      (i.team_id ?? null) === (project.team_id ?? null),
  );
  const percent = projectProgress(project);
  const zone = deviceTimeZone();
  const deadline = project.deadline
    ? projectDeadlineParts(project.deadline, zone)
    : null;
  const itemsChanged = () => {
    void refreshPlanner(true).catch(() => undefined);
    void client.getProject(project.id).then(onChanged, () => undefined);
  };

  const guarded = async (fn: () => Promise<void>, fallback: string) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (failure) {
      report(failure, fallback);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = (patch: Parameters<typeof client.updateProject>[1]) =>
    guarded(async () => {
      onChanged(await client.updateProject(project.id, patch));
    }, "Couldn't save that.");

  const back = async () => {
    if (
      linkDraft.current &&
      !(await confirm({
        title: "Discard project changes?",
        body: "Your unsaved project edits will be lost.",
        action: "Discard changes",
      }))
    )
      return;
    navigate("/app/projects");
  };

  const newPage = (asBrief: boolean) =>
    guarded(async () => {
      const doc = await client.createDoc({
        title: asBrief ? `${project.name} brief` : "",
        kind: "note",
        project_id: project.id,
        team_id: project.team_id,
        content: [{ type: "paragraph", text: "" }],
      });
      if (asBrief)
        onChanged(await client.updateProject(project.id, { doc_id: doc.id }));
      navigate(`/app/doc/${doc.id}`);
    }, "Couldn't create the page.");

  const addFiles = async (files: File[]) => {
    if (
      project.team_id &&
      !(await confirm({
        title: `Add ${files.length === 1 ? "this file" : "these files"} to ${project.name}?`,
        body: `Everyone in ${project.team_name ?? "this team"} will be able to read the pages made from them.`,
        action: "Add files",
      }))
    )
      return;
    await imports.importFiles(files);
  };

  const planProject = () =>
    void guarded(async () => {
      const claimed = claiming.filter((cid) =>
        unassigned.some((i) => i.id === cid),
      );
      const plan = await client.planProject(project.id, zone, claimed);
      setClaiming([]);
      if (claimed.length) itemsChanged();
      navigate(`/app/calendar?plan_id=${encodeURIComponent(plan.id)}`);
    }, "Couldn't plan this project.");

  const moveTo = async (item: Item, stageId: string | null) => {
    if (lock.current || !canWrite) return false;
    lock.current = true;
    setBusy(true);
    try {
      await client.setItemProject(item.id, {
        version: item.version,
        project_id: project.id,
        stage_id: stageId,
      });
      setRetry(null);
      itemsChanged();
      return true;
    } catch (failure) {
      if ((failure as { status?: number }).status === 409) {
        setRetry({
          itemId: item.id,
          title: item.title,
          version: item.version,
          stageId,
          unfile: false,
        });
        itemsChanged();
      }
      report(failure, "Couldn't move that task.");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const unfile = async (item: Item) => {
    if (lock.current || !canWrite) return;
    lock.current = true;
    setBusy(true);
    try {
      await client.setItemProject(item.id, {
        project_id: null,
        version: item.version,
      });
      setRetry(null);
      itemsChanged();
    } catch (failure) {
      if ((failure as { status?: number }).status === 409) {
        setRetry({
          itemId: item.id,
          title: item.title,
          version: item.version,
          stageId: null,
          unfile: true,
        });
        itemsChanged();
      }
      report(failure, "Couldn't remove that task.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const retryItem = retry
    ? items.find((i) => i.id === retry.itemId)
    : undefined;

  const saveStage = async () => {
    if (!stageDraft?.name.trim() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setStageError("");
    const stages = stageDraft.id
      ? project.stages.map((s) => ({
          id: s.id,
          name: s.id === stageDraft.id ? stageDraft.name.trim() : s.name,
        }))
      : [
          ...project.stages.map((s) => ({ id: s.id, name: s.name })),
          { name: stageDraft.name.trim() },
        ];
    try {
      onChanged(await client.updateProject(project.id, { stages }));
      setStageDraft(null);
    } catch (failure) {
      setStageError(messageOf(failure, "Couldn't save the stage."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const removeStage = async (stage: ProjectStage) => {
    if (
      await confirm({
        title: `Remove the “${stage.name}” stage?`,
        body: "Its tasks stay in the project.",
        action: "Remove",
        danger: true,
      })
    )
      await save({
        stages: project.stages
          .filter((s) => s.id !== stage.id)
          .map((s) => ({ id: s.id, name: s.name })),
      });
  };
  const saveEdit = async () => {
    if (!editing || lock.current) return;
    const text = editing.text.trim();
    if (editing.kind === "rename" && !text) return;
    lock.current = true;
    setBusy(true);
    setEditError("");
    try {
      onChanged(
        await client.updateProject(
          project.id,
          editing.kind === "rename" ? { name: text } : { summary: text },
        ),
      );
      setEditing(null);
    } catch (failure) {
      setEditError(
        messageOf(failure, "Couldn't save. Your text is still here."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
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
          void client
            .updateProject(project.id, before)
            .then(onChanged, (e) => report(e, "Couldn't undo that.")),
      },
    });
  };
  const keepOut = async (off: boolean) => {
    if (
      off &&
      !(await confirm({
        title: `Keep “${project.name}” out of the assistant?`,
        body: "No AI will read this project or anything in it: not the assistant, Study, the morning agenda, search by meaning or connected agents. Everyone in it keeps working as before.",
        action: "Keep it out",
      }))
    )
      return;
    await guarded(async () => {
      onChanged(await client.setProjectAssistant(project.id, off));
    }, "Couldn't change that.");
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: `Delete “${project.name}”?`,
        body: "Its tasks stay, unfiled.",
        action: "Delete",
        danger: true,
      }))
    )
      return;
    await guarded(async () => {
      await client.deleteProject(project.id);
      navigate("/app/projects");
      void refreshPlanner(true).catch(() => undefined);
    }, "Couldn't delete the project.");
  };
  const copyLink = async () => {
    const url = appUrl(location.origin, { kind: "project", id: project.id });
    try {
      await navigator.clipboard.writeText(url);
      toast({ text: "Link copied" });
    } catch {
      toast({ text: "Couldn't copy the link", error: true });
    }
  };
  const share = async () => {
    try {
      await navigator.share({
        title: project.name,
        url: appUrl(location.origin, { kind: "project", id: project.id }),
      });
    } catch (failure) {
      if ((failure as Error)?.name !== "AbortError")
        report(failure, "Couldn't share that.");
    }
  };
  const setStar = async () => {
    try {
      await client.setFavourite("project", project.id, !starred);
      await favourites.reload();
    } catch (failure) {
      report(failure, "Couldn't change the star.");
    }
  };
  const chip = planning.data ? projectPlanStatus(planning.data) : null;
  const failedDetails = home.error || planning.error || sessions.error;
  const reentry = visit.data?.reentry;
  const openAssistant = (question: string) =>
    navigate(ask(project.id, question));
  const Mode = (
    <>
      <div className="pj-modes" role="group" aria-label="How to show the work">
        {MODES.map(([value, label]) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="pj-mode-pick">
        <SelectBox
          aria-label="Project view"
          value={mode}
          onChange={(event) => setMode(event.target.value as Mode)}
        >
          {MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectBox>
      </div>
    </>
  );
  return (
    <div className="pj pj-detail">
      <div className="pj-bar">
        <Button variant="ghost" onClick={() => void back()}>
          <ArrowLeft aria-hidden="true" /> All projects
        </Button>
        <span className="pj-grow" />
        {typeof navigator.share === "function" && (
          <IconButton label="Share link" onClick={() => void share()}>
            <Share2 />
          </IconButton>
        )}
        {project.assistant_off ? (
          <span title="No AI reads this project: not the assistant, Study, the agenda, search by meaning or connected agents.">
            <Pill>AI excluded</Pill>
          </span>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => navigate(`/app/assistant?project=${project.id}`)}
            >
              <Sparkles aria-hidden="true" /> New chat
            </Button>
            <Button variant="ghost" onClick={() => setChats(true)}>
              Chats
            </Button>
          </>
        )}
        <IconButton
          label={starred ? "Unstar project" : "Star project"}
          aria-pressed={starred}
          onClick={() => void setStar()}
        >
          <Star fill={starred ? "currentColor" : "none"} />
        </IconButton>
        <Menu
          label="Project options"
          trigger={(open, expanded) => (
            <IconButton
              label="Project options"
              aria-expanded={expanded}
              onClick={open}
            >
              <MoreHorizontal />
            </IconButton>
          )}
        >
          {(close) => {
            const pick = (fn: () => void) => () => {
              close();
              fn();
            };
            return (
              <>
                <button
                  onClick={pick(() =>
                    tasks.peek({ kind: "project", id: project.id }),
                  )}
                >
                  Open beside
                </button>
                <button onClick={pick(() => void copyLink())}>Copy link</button>
                {canWrite && (
                  <>
                    <button
                      onClick={pick(() =>
                        setEditing({ kind: "rename", text: project.name }),
                      )}
                    >
                      Rename
                    </button>
                    <button
                      onClick={pick(() =>
                        setEditing({ kind: "summary", text: project.summary }),
                      )}
                    >
                      Summary &amp; brief
                    </button>
                    <button onClick={pick(() => setLookOpen(true))}>
                      Cover and icon
                    </button>
                    {(["active", "done", "archived"] as const).map((status) => (
                      <button
                        key={status}
                        disabled={busy || status === project.status}
                        onClick={pick(() => void save({ status }))}
                      >
                        Mark {status}
                      </button>
                    ))}
                    <button
                      onClick={pick(
                        () =>
                          void guarded(async () => {
                            await client.templateFromProject(project.id);
                            toast({ text: "Template saved" });
                          }, "Couldn't save the template."),
                      )}
                    >
                      Save as template
                    </button>
                  </>
                )}
                {canAi && (
                  <button
                    onClick={pick(() => void keepOut(!project.assistant_off))}
                  >
                    {project.assistant_off
                      ? "Let the assistant read it"
                      : "Keep out of the assistant"}
                  </button>
                )}
                {canWrite && (
                  <button
                    className="is-danger"
                    onClick={pick(() => void remove())}
                  >
                    Delete project
                  </button>
                )}
              </>
            );
          }}
        </Menu>
      </div>

      <header className="pj-title">
        <Cover fileId={project.cover_file_id} className="pj-cover" />
        <h1 dir="auto">
          {project.icon && <LookIcon icon={project.icon} />} {project.name}
        </h1>
        <p className="muted" dir="auto">
          {project.summary || "No summary yet."}
        </p>
        <div className="pj-facts">
          <span
            className="pj-meter is-wide"
            role="img"
            aria-label={`${percent}% done`}
          >
            <i style={{ width: `${percent}%` }} />
          </span>
          <span className="muted small">
            {project.done_count} of {project.task_count} done · {percent}%
            {project.team_name ? ` · ${project.team_name}` : ""}
            {project.status !== "active"
              ? ` · ${project.status === "done" ? "Completed" : "Archived"}`
              : ""}
          </span>
          <label className="pj-deadline">
            <span className="small muted">Deadline</span>
            <Input
              type="date"
              value={deadline?.day ?? ""}
              disabled={busy || !canWrite}
              onChange={(event) =>
                void save({
                  deadline: changeProjectDeadline(
                    project.deadline,
                    { day: event.target.value || null },
                    zone,
                  ),
                })
              }
            />
            {deadline && (
              <Input
                type="time"
                aria-label="Deadline time"
                value={deadline.clock}
                disabled={busy || !canWrite}
                onChange={(event) =>
                  void save({
                    deadline: changeProjectDeadline(
                      project.deadline,
                      { clock: event.target.value },
                      zone,
                    ),
                  })
                }
              />
            )}
          </label>
        </div>
      </header>

      {retry && (
        <div className="pj-retry" role="status">
          <p dir="auto">
            “{retry.title}” changed. Review its current placement before
            retrying your saved choice:{" "}
            {retry.unfile
              ? "No project"
              : `${project.name} / ${project.stages.find((s) => s.id === retry.stageId)?.name ?? "No stage"}`}
            .
          </p>
          {retryItem && (
            <p>
              Current placement:{" "}
              {retryItem.project_id === project.id
                ? `${project.name} / ${project.stages.find((s) => s.id === retryItem.stage_id)?.name ?? "No stage"}`
                : retryItem.project_id
                  ? "Another project"
                  : "No project"}
              .
            </p>
          )}
          <div className="pj-row-wrap">
            <Button
              disabled={
                busy ||
                !canWrite ||
                !retryItem ||
                retryItem.version <= retry.version ||
                (!retry.unfile &&
                  !!retryItem.project_id &&
                  retryItem.project_id !== project.id)
              }
              onClick={() => {
                if (!retryItem) return;
                if (retry.unfile) void unfile(retryItem);
                else void moveTo(retryItem, retry.stageId);
              }}
            >
              Retry saved move
            </Button>
            {retryItem && (
              <Button variant="ghost" onClick={() => tasks.open(retryItem)}>
                Open task
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={itemsChanged}>
              Refresh tasks
            </Button>
            <Button variant="ghost" onClick={() => setRetry(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {reentry && reentry.total > 0 && (
        <section className="pj-reentry" aria-label="Since your last visit">
          <div className="pj-grow">
            <strong>Since your last visit</strong>
            <p className="small">
              {reentry.total} change{reentry.total === 1 ? "" : "s"}
              {reentry.completedTasks > 0 &&
                ` · ${reentry.completedTasks} task${reentry.completedTasks === 1 ? "" : "s"} completed`}
              {reentry.changedRecords > 0 &&
                ` · ${reentry.changedRecords} commitment update${reentry.changedRecords === 1 ? "" : "s"}`}
            </p>
            <ul>
              {reentry.recent.map((line, n) => (
                <li key={n} dir="auto">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="pj-row-wrap">
            <Button onClick={() => setMode("history")}>View history</Button>
            {assistant.enabled &&
              reentry.total >= 2 &&
              !project.assistant_off && (
                <>
                  <Button
                    onClick={() =>
                      openAssistant(
                        "Explain what changed in this project since my last visit, with sources.",
                      )
                    }
                  >
                    Explain what changed
                  </Button>
                  {assistant.tools && (
                    <Button
                      onClick={() =>
                        openAssistant(
                          "Draft a project update page from the changes since my last visit. Show me the draft to edit and keep.",
                        )
                      }
                    >
                      Draft an update
                    </Button>
                  )}
                </>
              )}
          </div>
        </section>
      )}

      {planning.data &&
        project.task_count > 0 &&
        project.status === "active" && (
          <section className="pj-planning" aria-label="Project planning status">
            <div className="pj-planning-head">
              <p className="pj-grow small">
                {project.deadline && (
                  <strong>
                    Deadline {dayLabel(project.deadline, true)} ·{" "}
                  </strong>
                )}
                Your part: needs {shortMinutes(planning.data.needed_minutes)} ·{" "}
                {shortMinutes(planning.data.planned_minutes)} planned
                {project.deadline ? " before it" : ""} ·{" "}
                {shortMinutes(planning.data.unplanned_minutes)} not planned
                {planning.data.planned_finish_at &&
                  ` · Planned finish ${dayLabel(planning.data.planned_finish_at)}`}
              </p>
              {chip && (
                <Pill tone={chip.status === "on_track" ? "green" : "amber"}>
                  {chip.label}
                </Pill>
              )}
              {canWrite && (
                <Button disabled={busy} onClick={planProject}>
                  Plan this project
                </Button>
              )}
            </div>
            {planning.data.needed_minutes > 0 && (
              <span
                className="pj-meter is-wide"
                role="img"
                aria-label={`${shortMinutes(planning.data.planned_minutes)} of ${shortMinutes(planning.data.needed_minutes)} planned`}
              >
                <i
                  style={{
                    width: `${Math.min(100, Math.round((planning.data.planned_minutes / planning.data.needed_minutes) * 100))}%`,
                  }}
                />
              </span>
            )}
            {planning.data.late_session_count > 0 && (
              <p className="pj-warn">
                {planning.data.late_session_count === 1
                  ? "1 session after its task's deadline"
                  : `${planning.data.late_session_count} sessions after their tasks' deadlines`}
              </p>
            )}
            {planning.data.unestimated_tasks.length > 0 && (
              <p className="muted small" dir="auto">
                Needs an estimate:{" "}
                {planning.data.unestimated_tasks.map((t) => t.title).join(", ")}
              </p>
            )}
            {project.team_id && (
              <p className="muted small">
                {planning.data.team_planned_minutes !== undefined
                  ? `Team: ${shortMinutes(planning.data.team_planned_minutes)} planned by everyone`
                  : "Only your sessions are counted"}
              </p>
            )}
            {canWrite && project.team_id && unassigned.length > 0 && (
              <fieldset className="pj-checks">
                <legend className="muted small">
                  Choose tasks to claim and include in Plan this project.
                </legend>
                {unassigned.map((item) => (
                  <label key={item.id} className="check">
                    <input
                      type="checkbox"
                      checked={claiming.includes(item.id)}
                      disabled={busy}
                      onChange={(event) =>
                        setClaiming((ids) =>
                          event.target.checked
                            ? [...ids, item.id]
                            : ids.filter((x) => x !== item.id),
                        )
                      }
                    />
                    <span dir="auto">{item.title}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </section>
        )}

      <div className="pj-tools">
        {Mode}
        <Search project={project} onDecisions={() => setMode("decisions")} />
      </div>

      {failedDetails && (
        <ErrorNotice
          message="Some project details are unavailable."
          onRetry={() => {
            void home.reload();
            void planning.reload();
            void sessions.reload();
          }}
        />
      )}
      {imports.loadError && (
        <ErrorNotice
          message="Files unavailable."
          onRetry={() => void imports.refresh()}
        />
      )}
      {mode === "home" && home.loading && !home.data && (
        <Loading label="Loading project details" />
      )}

      {mode === "home" ? (
        <Home
          project={project}
          items={items}
          sessions={lastSessions}
          data={home.data}
          members={team.data ?? []}
          canWrite={canWrite}
          busy={busy}
          onItemsChanged={itemsChanged}
          onChanged={onChanged}
          onLinks={(links) => home.set((d) => (d ? { ...d, links } : d))}
          onMode={setMode}
          onNewPage={() => void newPage(false)}
          onBrief={() => void newPage(true)}
          onFiles={(files) => void addFiles(files)}
          uploadBusy={imports.busy}
          linkDraft={linkDraft}
        />
      ) : mode === "notes" ? (
        <Pages
          projectId={project.id}
          canWrite={canWrite}
          busy={busy}
          revision={imports.jobs}
          onNew={() => void newPage(false)}
        />
      ) : mode === "decisions" ? (
        <Records
          focusId={sourceId}
          project={project}
          items={items}
          userId={userId}
          canWrite={canWrite}
        />
      ) : mode === "history" ? (
        <History
          projectId={project.id}
          items={items}
          lastSeen={visit.data?.since ?? null}
          sourceId={sourceId}
        />
      ) : mode === "timeline" ? (
        <Timeline project={project} items={items} sessions={lastSessions} />
      ) : mode === "board" ? (
        <StageBoard
          project={project}
          grouped={grouped}
          items={items}
          canWrite={canWrite}
          busy={busy}
          onMove={(item, stage) => void moveTo(item, stage)}
        />
      ) : (
        <StageList
          project={project}
          grouped={grouped}
          canWrite={canWrite}
          busy={busy}
          onMove={(item, stage) => void moveTo(item, stage)}
          onUnfile={(item) => void unfile(item)}
          onAdd={(stageId) => {
            setPickerError("");
            setPicker({ stageId, itemId: "" });
          }}
          onRename={(stage) => {
            setStageError("");
            setStageDraft({ id: stage.id, name: stage.name });
          }}
          onRemove={(stage) => void removeStage(stage)}
          onNewStage={() => {
            setStageError("");
            setStageDraft({ id: null, name: "" });
          }}
        />
      )}

      {chats && (
        <Chats
          projectId={project.id}
          onClose={() => setChats(false)}
          onOpen={(chatId) => {
            setChats(false);
            navigate(
              `/app/assistant?project=${project.id}&chat=${encodeURIComponent(chatId)}`,
            );
          }}
        />
      )}
      {lookOpen && (
        <LookDialog
          title={project.name}
          look={{
            cover_file_id: project.cover_file_id ?? null,
            icon: project.icon ?? null,
          }}
          uploadTo={project.doc_id}
          onSave={saveLook}
          onClose={() => setLookOpen(false)}
        />
      )}
      {editing && (
        <Ask
          title={
            editing.kind === "rename" ? "Rename project" : "Summary & brief"
          }
          onClose={() => !busy && setEditing(null)}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={editing.kind === "rename" && !editing.text.trim()}
                onClick={() => void saveEdit()}
              >
                Save
              </Button>
            </>
          }
        >
          {editing.kind === "rename" ? (
            <Field label="Name">
              <Input
                autoFocus
                required
                maxLength={200}
                value={editing.text}
                onChange={(event) =>
                  setEditing({ ...editing, text: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveEdit();
                }}
              />
            </Field>
          ) : (
            <>
              <Field label="Summary">
                <TextArea
                  autoFocus
                  rows={3}
                  maxLength={2000}
                  placeholder="One or two lines on what this project is for"
                  value={editing.text}
                  onChange={(event) =>
                    setEditing({ ...editing, text: event.target.value })
                  }
                />
              </Field>
              <div>
                <Button
                  variant="ghost"
                  disabled={busy || !canWrite}
                  onClick={() => {
                    setEditing(null);
                    if (project.doc_id) navigate(`/app/doc/${project.doc_id}`);
                    else void newPage(true);
                  }}
                >
                  {project.doc_id ? "Open the brief" : "Write a brief"}
                </Button>
              </div>
            </>
          )}
          {editError && <ErrorNotice message={editError} />}
        </Ask>
      )}
      {stageDraft && (
        <Ask
          title={stageDraft.id ? "Rename stage" : "New stage"}
          onClose={() => !busy && setStageDraft(null)}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setStageDraft(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={!stageDraft.name.trim()}
                onClick={() => void saveStage()}
              >
                Save
              </Button>
            </>
          }
        >
          <Field label="Name">
            <Input
              autoFocus
              required
              maxLength={120}
              disabled={busy}
              value={stageDraft.name}
              onChange={(event) =>
                setStageDraft({ ...stageDraft, name: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveStage();
              }}
            />
          </Field>
          {stageError && <ErrorNotice message={stageError} />}
        </Ask>
      )}
      {picker && (
        <Ask
          title="Add task to stage"
          onClose={() => !busy && setPicker(null)}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setPicker(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={!picker.itemId}
                onClick={() => {
                  const item = unfiled.find((i) => i.id === picker.itemId);
                  if (!item) return;
                  setPickerError("");
                  void moveTo(item, picker.stageId).then((ok) =>
                    ok
                      ? setPicker(null)
                      : setPickerError("Couldn't add that task. Try again."),
                  );
                }}
              >
                Add task
              </Button>
            </>
          }
        >
          {!unfiled.length ? (
            <p className="muted">Every task is already in a project.</p>
          ) : (
            <Field label="Task">
              <SelectBox
                disabled={busy}
                value={picker.itemId}
                onChange={(event) =>
                  setPicker({ ...picker, itemId: event.target.value })
                }
              >
                <option value="">Choose a task</option>
                {unfiled.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </SelectBox>
            </Field>
          )}
          {pickerError && <ErrorNotice message={pickerError} />}
        </Ask>
      )}
    </div>
  );
}

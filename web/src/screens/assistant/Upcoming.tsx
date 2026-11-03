import {
  ASSISTANT_CHANGE_KINDS,
  describeRrule,
  nextOccurrence,
  type AgentRoutine,
  type ApprovalScopes,
  type AssistantChangeKind,
  type Goal,
} from "@orbyn/core";
import {
  ArrowLeft,
  Ellipsis,
  MessageCircleQuestion,
  Plus,
  Repeat,
  Settings2,
  Target,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { useNavigate } from "../../lib/router";
import {
  Button,
  Dialog,
  ErrorNotice,
  IconButton,
  Loading,
  Menu,
  useConfirm,
} from "../../ui/kit";
import { useOwned } from "../agents-shared/hooks";
import { More } from "../agents-shared/parts";
import { ReplyText } from "../agents-shared/ReplyText";
import { QuietPolicyEditor } from "../agents-shared/routines/QuietChecks";
import { RetryPolicyEditor } from "../agents-shared/routines/Recovery";
import { RunHistory } from "../agents-shared/routines/RunHistory";
import { CHANGE_KINDS } from "../agents-shared/words";
import { PauseLane } from "../agents-shared/work";
import { useTasks } from "../shared-task";
import { GoalForm } from "./GoalForm";
import { GoalWork } from "./GoalWork";
import { RoutineForm } from "./RoutineForm";
import { upcomingItems, type Bucket, type UpcomingItem } from "./priority";
import { timezone, useRead } from "./state";

const SECTIONS: { bucket: Bucket; title: string; hint?: string }[] = [
  {
    bucket: "now",
    title: "Need you now",
    hint: "Overdue, failed or waiting on your answer",
  },
  { bucket: "today", title: "Today" },
  { bucket: "week", title: "This week" },
  { bucket: "later", title: "Later" },
];
const FILTERS = [
  ["all", "All"],
  ["goal", "Goals"],
  ["routine", "Routines"],
  ["chat", "Waiting chats"],
] as const;

/** What needs attention across goals, routines and waiting chats, most urgent first. */
export function Upcoming({
  onClose,
  onOpenChat,
}: {
  onClose: () => void;
  onOpenChat: (id: string) => void;
}) {
  const navigate = useNavigate();
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false),
    panel = useRef<HTMLDivElement>(null);
  const goals = useRead(() => client.listGoals()),
    routines = useRead(() => client.listAgentRoutines()),
    chats = useRead(() =>
      client.aiChats({ search: "", kind: "all", limit: 100 }),
    ),
    projects = useRead(() => client.listProjects()),
    docs = useRead(() => client.listDocs({ kind: "agent" })),
    prefs = useRead(() => client.getPlannerPrefs()),
    scopes = useRead(() => client.assistantApprovalScopes());
  const [goalForm, setGoalForm] = useState<Goal | "new" | null>(null),
    [routineForm, setRoutineForm] = useState<AgentRoutine | "new" | null>(null),
    [work, setWork] = useState<Goal | null>(null),
    [goalDetail, setGoalDetail] = useState<Goal | null>(null),
    [routineDetail, setRoutineDetail] = useState<AgentRoutine | null>(null),
    [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all"),
    [settings, setSettings] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const childDirty = useRef({ quiet: false, retry: false });
  const ruleLabel = (rule: ApprovalScopes[AssistantChangeKind]) =>
    !rule
      ? "Ask each time"
      : rule === "always"
        ? "Always allowed"
        : `${rule.scope}: ${rule.scope === "goal" ? (goals.data?.find((g) => g.id === rule.id)?.title ?? "Unavailable goal") : (routines.data?.find((r) => r.id === rule.id)?.instruction ?? "Unavailable routine")}`;
  const close = async () => {
    if (!owned() || lock.current || goalForm || routineForm || work) return;
    lock.current = true;
    try {
      if (
        Object.values(childDirty.current).some(Boolean) &&
        !(await confirm({
          title: "Leave routine settings?",
          body: "Unsaved settings stay only while this panel is open. Resolve any unconfirmed save before leaving.",
          action: "Keep editing",
        }))
      )
        return;
      if (Object.values(childDirty.current).some(Boolean)) return;
      if (owned()) onClose();
    } finally {
      lock.current = false;
    }
  };
  const mutate = async (
    run: () => Promise<unknown>,
    refresh: () => Promise<unknown>,
    question?: { title: string; body: string },
  ) => {
    if (!owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (
        question &&
        !(await confirm({ ...question, action: "Confirm", danger: true }))
      )
        return;
      if (!owned()) return;
      await run();
      if (!owned()) return;
      await refresh();
    } catch (failure) {
      if (owned())
        setError(
          messageOf(
            failure,
            "Couldn't confirm this change. Reload the list before trying again.",
          ),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const toggle = (routine: AgentRoutine) =>
    void mutate(() => {
      let next = new Date(routine.next_run_at);
      if (routine.paused && next <= new Date()) {
        const future = nextOccurrence(
          next,
          routine.rrule,
          routine.timezone,
          new Date(),
        );
        if (!future)
          throw new Error(
            "This recurrence has no future occurrence. Edit its schedule before resuming.",
          );
        next = future;
      }
      return client.updateAgentRoutine(routine.id, {
        paused: !routine.paused,
        next_run_at: next.toISOString(),
        ...(routine.revision ? { expected_revision: routine.revision } : {}),
      });
    }, routines.reload);
  const editable = !busy && !!projects.data && !!docs.data;
  const reload = () => {
    void goals.reload();
    void routines.reload();
    void chats.reload();
  };
  const all = upcomingItems(
    {
      goals: goals.data ?? [],
      routines: routines.data ?? [],
      chats: chats.data ?? [],
    },
    prefs.data?.timezone ?? timezone(),
  );
  const items = all.filter((item) => filter === "all" || item.kind === filter);
  const count = (bucket: Bucket) =>
    items.filter((item) => item.bucket === bucket).length;
  const jump = (bucket: Bucket) =>
    panel.current
      ?.querySelector(`[data-bucket="${bucket}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  const loading = goals.loading || routines.loading || chats.loading;
  const quiet = items.filter((item) => item.bucket === "quiet");

  const primary = (item: UpcomingItem) => {
    if (item.kind === "chat")
      return (
        <Button onClick={() => owned() && onOpenChat(item.chat.id)}>
          Answer
        </Button>
      );
    if (item.kind === "goal")
      return item.goal.status === "active" ? (
        <Button disabled={busy} onClick={() => setWork(item.goal)}>
          Plan next step
        </Button>
      ) : null;
    if (item.failure)
      return (
        <Button
          disabled={busy}
          onClick={() => {
            childDirty.current = { quiet: false, retry: false };
            setRoutineDetail(item.routine);
          }}
        >
          Check history
        </Button>
      );
    return (
      <Button disabled={busy} onClick={() => toggle(item.routine)}>
        {item.routine.paused ? "Resume" : "Pause"}
      </Button>
    );
  };
  const more = (item: UpcomingItem) => {
    if (item.kind === "chat") return null;
    const title =
      item.kind === "goal" ? item.goal.title : item.routine.instruction;
    return (
      <Menu
        label={`Options for ${title}`}
        trigger={(show, expanded) => (
          <IconButton
            label={`More for ${title}`}
            aria-expanded={expanded}
            onClick={show}
          >
            <Ellipsis aria-hidden="true" />
          </IconButton>
        )}
      >
        {(closeMenu) =>
          item.kind === "goal" ? (
            <>
              <button
                role="menuitem"
                disabled={!editable}
                onClick={() => {
                  closeMenu();
                  setGoalForm(item.goal);
                }}
              >
                Edit goal
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  setGoalDetail(item.goal);
                }}
              >
                Check-ins and tasks
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  setWork(item.goal);
                }}
              >
                Goal work
              </button>
              {item.goal.plan_doc_id && (
                <button
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    if (owned())
                      navigate(
                        `/app/doc/${encodeURIComponent(item.goal.plan_doc_id!)}`,
                      );
                  }}
                >
                  Open plan page
                </button>
              )}
              <button
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  closeMenu();
                  void mutate(
                    () => client.deleteGoal(item.goal.id),
                    goals.reload,
                    {
                      title: "Delete this goal?",
                      body: "This removes the goal and its check-in history.",
                    },
                  );
                }}
              >
                Delete goal
              </button>
            </>
          ) : (
            <>
              {item.failure && (
                <button
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    toggle(item.routine);
                  }}
                >
                  {item.routine.paused ? "Resume" : "Pause"}
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  setRoutineForm(item.routine);
                }}
              >
                Edit schedule
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  childDirty.current = { quiet: false, retry: false };
                  setRoutineDetail(item.routine);
                }}
              >
                History and policies
              </button>
              <button
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  closeMenu();
                  void mutate(
                    () => client.deleteAgentRoutine(item.routine.id),
                    routines.reload,
                    {
                      title: "Delete this routine?",
                      body: "This removes its schedule, history and upcoming work. Already applied changes remain.",
                    },
                  );
                }}
              >
                Delete routine
              </button>
            </>
          )
        }
      </Menu>
    );
  };
  const row = (item: UpcomingItem) => {
    const Icon =
      item.kind === "goal"
        ? Target
        : item.kind === "routine"
          ? Repeat
          : MessageCircleQuestion;
    const title =
      item.kind === "goal"
        ? item.goal.title
        : item.kind === "routine"
          ? item.routine.instruction
          : item.chat.title || "Untitled chat";
    const detail =
      item.kind === "goal"
        ? [item.goal.project_name ?? "Personal", item.goal.target]
        : item.kind === "routine"
          ? [item.failure ?? describeRrule(item.routine.rrule)]
          : ["The assistant is waiting for your answer"];
    return (
      <li key={`${item.kind}:${item.id}`} className="upcoming-row">
        <span className="upcoming-kind" aria-hidden="true">
          <Icon />
        </span>
        <div className="upcoming-text">
          <span className="upcoming-title" dir="auto">
            <span className="sr-only">
              {item.kind === "goal"
                ? "Goal: "
                : item.kind === "routine"
                  ? "Routine: "
                  : "Chat: "}
            </span>
            {title}
          </span>
          <span className="upcoming-detail" dir="auto">
            {detail.filter(Boolean).join(" · ")}
          </span>
        </div>
        <span className={`upcoming-when is-${item.bucket}`}>{item.when}</span>
        <div className="upcoming-actions">
          {primary(item)}
          {more(item)}
        </div>
      </li>
    );
  };

  return (
    <Dialog
      title={settings ? "Permissions and admission" : "Upcoming"}
      wide
      onClose={() => void close()}
      actions={
        <Button
          disabled={busy || Object.values(childDirty.current).some(Boolean)}
          onClick={() => void close()}
        >
          Close
        </Button>
      }
    >
      <div className="upcoming-head">
        {settings ? (
          <Button onClick={() => setSettings(false)}>
            <ArrowLeft aria-hidden="true" />
            Back to Upcoming
          </Button>
        ) : (
          <>
            <Menu
              label="Create"
              trigger={(show, expanded) => (
                <Button aria-expanded={expanded} onClick={show}>
                  <Plus aria-hidden="true" />
                  New
                </Button>
              )}
            >
              {(closeMenu) => (
                <>
                  <button
                    role="menuitem"
                    disabled={!editable || goals.loading}
                    onClick={() => {
                      closeMenu();
                      if (owned()) setGoalForm("new");
                    }}
                  >
                    New goal
                  </button>
                  <button
                    role="menuitem"
                    disabled={busy || !prefs.data}
                    onClick={() => {
                      closeMenu();
                      if (owned()) setRoutineForm("new");
                    }}
                  >
                    New routine
                  </button>
                </>
              )}
            </Menu>
            <Button onClick={() => setSettings(true)}>
              <Settings2 aria-hidden="true" />
              Permissions and admission
            </Button>
          </>
        )}
      </div>
      <div className="upcoming-body" ref={panel}>
        {error && <ErrorNotice message={error} onRetry={reload} />}
        {[goals, routines, chats, prefs, projects, docs].map(
          (read, index) =>
            read.error && (
              <ErrorNotice
                key={index}
                message={read.error}
                onRetry={() => void read.reload()}
              />
            ),
        )}
        {settings ? (
          <>
            <section className="upcoming-settings">
              <h3>Saved automatic-change permissions</h3>
              {scopes.loading && <Loading label="Loading permissions" />}
              {scopes.error && (
                <ErrorNotice
                  message={scopes.error}
                  onRetry={() => void scopes.reload()}
                />
              )}
              <p className="muted small">
                Revoking permission affects future work. Pause admission and
                stop running work separately.
              </p>
              {scopes.data &&
                ASSISTANT_CHANGE_KINDS.map((kind) => (
                  <div className="agents-row" key={kind}>
                    <span>
                      {CHANGE_KINDS[kind]} · {ruleLabel(scopes.data?.[kind])}
                    </span>
                    {scopes.data?.[kind] && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            () => {
                              const next = { ...scopes.data };
                              delete next[kind];
                              return client.setAssistantApprovalScopes(next);
                            },
                            scopes.reload,
                            {
                              title: `Revoke ${CHANGE_KINDS[kind].toLowerCase()} permission?`,
                              body: "Future changes in this category will ask again.",
                            },
                          )
                        }
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                ))}
            </section>
            <section className="upcoming-settings">
              <h3>Admission controls</h3>
              <PauseLane lane="background" />
              <PauseLane lane="overnight" />
            </section>
          </>
        ) : (
          <>
            <div className="upcoming-counts">
              <button
                type="button"
                className="is-now"
                onClick={() => jump("now")}
              >
                <strong>{count("now")}</strong>
                Need you now
              </button>
              <button
                type="button"
                className="is-today"
                onClick={() => jump("today")}
              >
                <strong>{count("today")}</strong>
                Today
              </button>
              <button type="button" onClick={() => jump("week")}>
                <strong>{count("week")}</strong>
                This week
              </button>
            </div>
            <div className="upcoming-filters" role="group" aria-label="Show">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {loading && !items.length && <Loading label="Loading upcoming" />}
            {!loading && items.every((item) => item.bucket === "quiet") && (
              <p className="upcoming-clear">
                Nothing is coming up. You're caught up.
              </p>
            )}
            {SECTIONS.map(({ bucket, title, hint }) => {
              const rows = items.filter((item) => item.bucket === bucket);
              return (
                rows.length > 0 && (
                  <section
                    key={bucket}
                    className="upcoming-section"
                    data-bucket={bucket}
                  >
                    <h3>
                      {title}
                      <span>
                        {rows.length}
                        {hint ? ` · ${hint}` : ""}
                      </span>
                    </h3>
                    <ul>{rows.map(row)}</ul>
                  </section>
                )
              );
            })}
            {quiet.length > 0 && (
              <More summary={`Paused and done · ${quiet.length}`}>
                <ul className="upcoming-quiet">{quiet.map(row)}</ul>
              </More>
            )}
          </>
        )}
      </div>
      {goalForm && (
        <GoalForm
          key={goalForm === "new" ? "new" : goalForm.id}
          goal={goalForm === "new" ? undefined : goalForm}
          projects={projects.data ?? []}
          docs={docs.data ?? []}
          onClose={() => owned() && setGoalForm(null)}
          onSaved={() => void goals.reload()}
        />
      )}
      {routineForm && (
        <RoutineForm
          key={routineForm === "new" ? "new" : routineForm.id}
          routine={routineForm === "new" ? undefined : routineForm}
          timezone={prefs.data?.timezone ?? timezone()}
          onClose={() => owned() && setRoutineForm(null)}
          onSaved={() => void routines.reload()}
          ruleLabel={ruleLabel}
        />
      )}
      {work && (
        <GoalWork
          key={work.id}
          goal={work}
          onClose={() => owned() && setWork(null)}
          onOpenChat={onOpenChat}
        />
      )}
      {goalDetail && (
        <GoalDetail
          goal={goalDetail}
          onClose={() => owned() && setGoalDetail(null)}
        />
      )}
      {routineDetail && (
        <RoutineDetails
          routine={routineDetail}
          onClose={() => owned() && setRoutineDetail(null)}
          onOpenChat={onOpenChat}
        />
      )}
    </Dialog>
  );
}
function GoalDetail({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const tasks = useTasks();
  const owned = useOwned(),
    checkins = useRead(() => client.goalCheckins(goal.id)),
    work = useRead(() => client.goalWork(goal.id));
  return (
    <Dialog
      title={`Check-ins · ${goal.title}`}
      wide
      onClose={onClose}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      {checkins.error && (
        <ErrorNotice
          message={checkins.error}
          onRetry={() => void checkins.reload()}
        />
      )}
      {checkins.loading && <Loading label="Loading check-ins" />}
      {checkins.data?.length === 0 && <p>No check-ins yet.</p>}
      {checkins.data?.map((row) => (
        <section key={row.id}>
          <h3>
            Week of {row.week_of} · {row.status}
          </h3>
          <ReplyText text={row.summary} />
          {Object.keys(row.progress).length > 0 && (
            <More summary="Recorded progress">
              <pre>{JSON.stringify(row.progress, null, 2)}</pre>
            </More>
          )}
        </section>
      ))}
      <h3>Unfinished linked tasks</h3>
      {work.error && (
        <ErrorNotice message={work.error} onRetry={() => void work.reload()} />
      )}
      {work.loading && <Loading label="Loading linked work" />}
      {work.data?.length === 0 && <p>No unfinished linked tasks.</p>}
      {work.data?.map((task) => (
        <div className="agents-row" key={task.id}>
          <span>{task.remaining_minutes} unbooked minutes</span>
          <Button onClick={() => owned() && tasks.open(task.id)}>
            Open task
          </Button>
        </div>
      ))}
    </Dialog>
  );
}
function RoutineDetails({
  routine,
  onClose,
  onOpenChat,
}: {
  routine: AgentRoutine;
  onClose: () => void;
  onOpenChat: (id: string) => void;
}) {
  const owned = useOwned(),
    [dirty, setDirty] = useState({ quiet: false, retry: false });
  const [notice, setNotice] = useState("");
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const quietDirty = useCallback(
    (value: boolean) => {
      if (!owned() || dirtyRef.current.quiet === value) return;
      const next = { ...dirtyRef.current, quiet: value };
      dirtyRef.current = next;
      setDirty(next);
    },
    [owned],
  );
  const retryDirty = useCallback(
    (value: boolean) => {
      if (!owned() || dirtyRef.current.retry === value) return;
      const next = { ...dirtyRef.current, retry: value };
      dirtyRef.current = next;
      setDirty(next);
    },
    [owned],
  );
  const close = () => {
    if (owned() && !Object.values(dirtyRef.current).some(Boolean)) onClose();
  };
  return (
    <Dialog
      title="Routine history and policies"
      wide
      onClose={close}
      actions={
        <Button disabled={Object.values(dirty).some(Boolean)} onClick={close}>
          Close
        </Button>
      }
    >
      <p className="agents-prewrap" dir="auto">
        {routine.instruction}
      </p>
      {Object.values(dirty).some(Boolean) && (
        <p role="status">
          Save, resolve an unconfirmed save, or discard policy changes before
          closing.
        </p>
      )}
      <More summary="Quiet checks">
        <QuietPolicyEditor
          routineId={routine.id}
          disabled={false}
          onDirty={quietDirty}
        />
      </More>
      <More summary="Recovery and retry limits">
        <RetryPolicyEditor
          routineId={routine.id}
          disabled={false}
          onDirty={retryDirty}
        />
      </More>
      {notice && <p role="status">{notice}</p>}
      <RunHistory
        routineId={routine.id}
        timezone={routine.timezone}
        disabled={false}
        onOpenChat={(id) => {
          if (!owned()) return;
          if (Object.values(dirtyRef.current).some(Boolean)) {
            setNotice(
              "Save, discard, or resolve the pending policy changes before opening work.",
            );
            return;
          }
          onOpenChat(id);
        }}
      />
    </Dialog>
  );
}

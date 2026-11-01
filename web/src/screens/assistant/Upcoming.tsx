import {
  ASSISTANT_CHANGE_KINDS,
  describeRrule,
  nextOccurrence,
  type AgentRoutine,
  type ApprovalScopes,
  type AssistantChangeKind,
  type Goal,
} from "@orbyn/core";
import { useCallback, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { navigate } from "../../lib/router";
import {
  Button,
  Dialog,
  ErrorNotice,
  Loading,
  Pill,
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
import { tasks } from "../shared-task";
import { GoalForm } from "./GoalForm";
import { GoalWork } from "./GoalWork";
import { RoutineForm } from "./RoutineForm";
import { timezone, useRead } from "./state";

export function Upcoming({
  onClose,
  onOpenChat,
}: {
  onClose: () => void;
  onOpenChat: (id: string) => void;
}) {
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false);
  const goals = useRead(() => client.listGoals()),
    routines = useRead(() => client.listAgentRoutines()),
    projects = useRead(() => client.listProjects()),
    docs = useRead(() => client.listDocs({ kind: "agent" })),
    prefs = useRead(() => client.getPlannerPrefs()),
    scopes = useRead(() => client.assistantApprovalScopes());
  const [goalForm, setGoalForm] = useState<Goal | "new" | null>(null),
    [routineForm, setRoutineForm] = useState<AgentRoutine | "new" | null>(null),
    [work, setWork] = useState<Goal | null>(null),
    [goalDetail, setGoalDetail] = useState<Goal | null>(null),
    [routineDetail, setRoutineDetail] = useState<AgentRoutine | null>(null),
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
  return (
    <Dialog
      title="Upcoming"
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
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => {
            void goals.reload();
            void routines.reload();
            void scopes.reload();
          }}
        />
      )}
      <section className="agents-band">
        <header>
          <h2>Goals</h2>
          <Button
            disabled={busy || goals.loading}
            onClick={() => void goals.reload()}
          >
            Refresh goals
          </Button>
          <Button
            disabled={!editable || goals.loading}
            onClick={() => owned() && setGoalForm("new")}
          >
            New goal
          </Button>
        </header>
        {goals.loading && <Loading label="Loading goals" />}
        {goals.error && (
          <ErrorNotice
            message={goals.error}
            onRetry={() => void goals.reload()}
          />
        )}
        {!goals.loading && goals.data?.length === 0 && <p>No goals yet.</p>}
        <ul className="assistant-records">
          {goals.data?.map((goal) => (
            <li key={goal.id}>
              <div className="agents-row">
                <strong dir="auto">{goal.title}</strong>
                <Pill>{goal.status}</Pill>
              </div>
              <p dir="auto">{goal.target}</p>
              <p className="muted small">
                {goal.project_name ?? "Personal"}
                {goal.target_date ? ` · Target ${goal.target_date}` : ""}
              </p>
              {goal.plan_doc_id && (
                <Button
                  onClick={() =>
                    owned() &&
                    navigate(
                      `/app/doc/${encodeURIComponent(goal.plan_doc_id!)}`,
                    )
                  }
                >
                  Open plan page
                </Button>
              )}
              <div className="agents-buttons">
                <Button disabled={!editable} onClick={() => setGoalForm(goal)}>
                  Edit
                </Button>
                <Button disabled={busy} onClick={() => setGoalDetail(goal)}>
                  Check-ins and tasks
                </Button>
                <Button disabled={busy} onClick={() => setWork(goal)}>
                  Goal work
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () => client.deleteGoal(goal.id),
                      goals.reload,
                      {
                        title: "Delete this goal?",
                        body: "This removes the goal and its check-in history.",
                      },
                    )
                  }
                >
                  Delete goal
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="agents-band">
        <header>
          <h2>Routines</h2>
          <Button
            disabled={busy || routines.loading}
            onClick={() => void routines.reload()}
          >
            Refresh routines
          </Button>
          <Button
            disabled={busy || !prefs.data}
            onClick={() => owned() && setRoutineForm("new")}
          >
            New routine
          </Button>
        </header>
        {prefs.error && (
          <ErrorNotice
            message={prefs.error}
            onRetry={() => void prefs.reload()}
          />
        )}
        {routines.loading && <Loading label="Loading routines" />}
        {routines.error && (
          <ErrorNotice
            message={routines.error}
            onRetry={() => void routines.reload()}
          />
        )}
        {routines.data?.length === 0 && <p>No routines yet.</p>}
        <ul className="assistant-records">
          {routines.data?.map((routine) => (
            <li key={routine.id}>
              <strong className="agents-prewrap" dir="auto">
                {routine.instruction}
              </strong>
              <p className="muted small">
                {describeRrule(routine.rrule)} · {routine.timezone} ·{" "}
                {routine.paused
                  ? "Paused"
                  : `Next ${new Date(routine.next_run_at).toLocaleString(undefined, { timeZone: routine.timezone })}`}
              </p>
              <div className="agents-buttons">
                <Button disabled={busy} onClick={() => toggle(routine)}>
                  {routine.paused ? "Resume" : "Pause"}
                </Button>
                <Button disabled={busy} onClick={() => setRoutineForm(routine)}>
                  Edit schedule
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    childDirty.current = { quiet: false, retry: false };
                    setRoutineDetail(routine);
                  }}
                >
                  History and policies
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () => client.deleteAgentRoutine(routine.id),
                      routines.reload,
                      {
                        title: "Delete this routine?",
                        body: "This removes its schedule, history and upcoming work. Already applied changes remain.",
                      },
                    )
                  }
                >
                  Delete routine
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <More summary="Saved automatic-change permissions">
        {scopes.loading && <Loading label="Loading permissions" />}
        {scopes.error && (
          <ErrorNotice
            message={scopes.error}
            onRetry={() => void scopes.reload()}
          />
        )}
        <p className="muted">
          Revoking permission affects future work. Pause admission and stop
          running work separately.
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
      </More>
      <More summary="Admission controls">
        <PauseLane lane="background" />
        <PauseLane lane="overnight" />
      </More>
      {projects.error && (
        <ErrorNotice
          message={projects.error}
          onRetry={() => void projects.reload()}
        />
      )}
      {docs.error && (
        <ErrorNotice message={docs.error} onRetry={() => void docs.reload()} />
      )}
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

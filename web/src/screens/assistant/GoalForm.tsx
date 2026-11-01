import {
  GOAL_STATUSES,
  goalInput,
  type DocSummary,
  type Goal,
  type Project,
} from "@orbyn/core";
import { useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  SelectBox,
  TextArea,
  useConfirm,
} from "../../ui/kit";
import { unclear } from "./state";
import { useOwned } from "../agents-shared/hooks";

export function GoalForm({
  goal,
  projects,
  docs,
  onClose,
  onSaved,
}: {
  goal?: Goal;
  projects: Project[];
  docs: DocSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false);
  const initial = useRef({
    title: goal?.title ?? "",
    target: goal?.target ?? "",
    target_date: goal?.target_date ?? "",
    project_id: goal?.project_id ?? "",
    plan_doc_id: goal?.plan_doc_id ?? "",
    status: goal?.status ?? "active",
  }).current;
  const [draft, setDraft] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [matches, setMatches] = useState<Goal[] | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const frozen = busy || uncertain;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const close = async () => {
    if (!owned() || lock.current || uncertain) return;
    lock.current = true;
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard goal changes?",
          action: "Discard",
          danger: true,
        }))
      )
        return;
      if (owned()) onClose();
    } finally {
      lock.current = false;
    }
  };
  const save = async () => {
    if (!owned() || lock.current || uncertain) return;
    const parsed = goalInput.safeParse({
      ...draft,
      target_date: draft.target_date || null,
      project_id: draft.project_id || null,
      plan_doc_id: draft.plan_doc_id || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check this goal.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (goal)
        await client.updateGoal(goal.id, {
          ...parsed.data,
          ...(goal.revision ? { expected_revision: goal.revision } : {}),
        });
      else await client.createGoal(parsed.data);
      if (!owned()) return;
      onSaved();
      if (owned()) onClose();
    } catch (failure) {
      if (owned()) setUncertain(unclear(failure));
      if (owned())
        setError(
          messageOf(failure, "Couldn't save the goal. Your draft is kept."),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const checkSaved = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const list = await client.listGoals();
      if (!owned()) return;
      setMatches(
        list.filter(
          (row) =>
            (!goal || row.id === goal.id) &&
            row.title === draft.title.trim() &&
            row.target === draft.target.trim() &&
            row.target_date === (draft.target_date || null) &&
            row.project_id === (draft.project_id || null) &&
            row.plan_doc_id === (draft.plan_doc_id || null) &&
            row.status === draft.status,
        ),
      );
    } catch (failure) {
      if (owned())
        setError(
          messageOf(failure, "Couldn't check saved goals. Your draft is kept."),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  return (
    <Dialog
      title={goal ? "Edit goal" : "New goal"}
      onClose={() => void close()}
      actions={
        <>
          <Button disabled={frozen} onClick={() => void close()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={uncertain || !draft.title.trim() || (!!goal && !dirty)}
            onClick={() => void save()}
          >
            Save goal
          </Button>
        </>
      }
    >
      {error && <ErrorNotice message={error} />}
      {uncertain && (
        <section>
          <p role="status">
            The save outcome is unconfirmed. Check existing goals before
            creating another.
          </p>
          <Button disabled={busy} onClick={() => void checkSaved()}>
            Check saved goals
          </Button>
          {matches?.length === 0 && (
            <p>
              No matching goal was found. This does not prove the save failed.
              Keep this draft and check again.
            </p>
          )}
          {matches?.map((row) => (
            <div key={row.id}>
              <p>
                {row.title} · Created{" "}
                {new Date(row.created_at).toLocaleString()}
              </p>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (!owned() || lock.current) return;
                  lock.current = true;
                  try {
                    if (
                      !(await confirm({
                        title: "Use this saved goal?",
                        body: "This goal matches the fields above. Continue with this existing goal without creating another.",
                        action: "Use existing goal",
                      }))
                    )
                      return;
                    if (owned()) {
                      onSaved();
                      if (owned()) onClose();
                    }
                  } finally {
                    lock.current = false;
                  }
                }}
              >
                Use this existing goal
              </Button>
            </div>
          ))}
        </section>
      )}
      <Field label="Title">
        <Input
          value={draft.title}
          maxLength={120}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </Field>
      <Field label="Target">
        <TextArea
          value={draft.target}
          maxLength={2000}
          rows={3}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, target: e.target.value })}
        />
      </Field>
      <Field label="Target date">
        <Input
          type="date"
          value={draft.target_date}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}
        />
      </Field>
      <Field label="Project">
        <SelectBox
          value={draft.project_id}
          disabled={frozen}
          onChange={(e) =>
            setDraft({ ...draft, project_id: e.target.value, plan_doc_id: "" })
          }
        >
          <option value="">Personal</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectBox>
      </Field>
      <Field label="Plan agent page">
        <SelectBox
          value={draft.plan_doc_id}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, plan_doc_id: e.target.value })}
        >
          <option value="">No plan page</option>
          {docs
            .filter(
              (d) => !draft.project_id || d.project_id === draft.project_id,
            )
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || "Untitled"}
              </option>
            ))}
        </SelectBox>
      </Field>
      <Field label="Status">
        <SelectBox
          value={draft.status}
          disabled={frozen}
          onChange={(e) => {
            const status = GOAL_STATUSES.find((s) => s === e.target.value);
            if (status) setDraft({ ...draft, status });
          }}
        >
          {GOAL_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </SelectBox>
      </Field>
    </Dialog>
  );
}

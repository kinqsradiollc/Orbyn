import {
  MILESTONE_STATUS_LABELS,
  addDays,
  isClosed,
  localDateKey,
  shortMinutes,
  type Item,
  type ProjectMilestone,
} from "@orbyn/core";
import { Flag, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Pill,
  useConfirm,
} from "../../ui/kit";
import { deviceTimeZone } from "../shared-task";

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const TONE: Record<ProjectMilestone["status"], "green" | "amber" | undefined> =
  {
    done: "green",
    on_track: "green",
    not_planned: "amber",
    late: "amber",
    passed: "amber",
    empty: undefined,
  };

type Draft = {
  id: string | null;
  name: string;
  due_on: string;
  item_ids: string[];
};

/** Named, dated checkpoints, each rolling up its tasks. Task deadlines stay put. */
export function Milestones({
  projectId,
  items,
  canWrite,
  onChanged,
  refreshKey,
}: {
  projectId: string;
  items: Item[];
  canWrite: boolean;
  onChanged: () => void;
  refreshKey: unknown;
}) {
  const confirm = useConfirm();
  const list = useResource(
    () => client.projectMilestones(projectId),
    [projectId, refreshKey],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const tasks = items.filter((i) => i.kind === "task" && !isClosed(i.status));
  const run = async (fn: () => Promise<void>) => {
    if (lock.current || !canWrite) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      setDraft(null);
      await list.reload();
      onChanged();
    } catch (failure) {
      setError(
        messageOf(
          failure,
          "Couldn't save the milestone. Your changes are still here.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      if (!draft || !draft.name.trim() || !draft.due_on)
        throw new Error("Give the milestone a name and a date.");
      if (draft.id) {
        await client.updateMilestone(projectId, draft.id, {
          name: draft.name.trim(),
          due_on: draft.due_on,
        });
        const was = new Set(
          items.filter((i) => i.milestone_id === draft.id).map((i) => i.id),
        );
        const now = new Set(draft.item_ids);
        for (const id of now)
          if (!was.has(id)) await client.setItemMilestone(id, draft.id);
        for (const id of was)
          if (!now.has(id)) await client.setItemMilestone(id, null);
      } else
        await client.createMilestone(projectId, {
          name: draft.name.trim(),
          due_on: draft.due_on,
          item_ids: draft.item_ids,
        });
    });
  const remove = async (m: ProjectMilestone) => {
    const yes = await confirm({
      title: `Remove the milestone “${m.name}”?`,
      body: "Its tasks stay in the project, with their deadlines as they are.",
      action: "Remove",
      danger: true,
    });
    if (yes)
      await run(() =>
        client.deleteMilestone(projectId, m.id).then(() => undefined),
      );
  };
  const rows = list.data;
  if (rows && !rows.length && !canWrite && !list.error) return null;
  const today = localDateKey(new Date(), deviceTimeZone());
  const editing = draft?.id ? rows?.find((m) => m.id === draft.id) : undefined;
  return (
    <section className="pj-block">
      <header className="pj-block-head">
        <h3>Milestones</h3>
        {canWrite && (
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              setDraft({
                id: null,
                name: "",
                due_on: addDays(today, 7),
                item_ids: [],
              });
            }}
          >
            <Plus aria-hidden="true" /> Add
          </Button>
        )}
      </header>
      {list.error && (
        <ErrorNotice message={list.error} onRetry={() => void list.reload()} />
      )}
      {rows?.length === 0 && <p className="muted small">No milestones yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="pj-milestones">
          {rows.map((m) => (
            <li key={m.id}>
              <Flag aria-hidden="true" />
              <span className="pj-grow">
                {canWrite ? (
                  <button
                    className="pj-link"
                    dir="auto"
                    onClick={() => {
                      setError("");
                      setDraft({
                        id: m.id,
                        name: m.name,
                        due_on: m.due_on,
                        item_ids: items
                          .filter((i) => i.milestone_id === m.id)
                          .map((i) => i.id),
                      });
                    }}
                  >
                    {m.name}
                  </button>
                ) : (
                  <span dir="auto">{m.name}</span>
                )}
                <small>
                  {dayLabel(m.due_on)} · {m.done_count} of {m.task_count}{" "}
                  {m.task_count === 1 ? "task" : "tasks"} done
                  {m.planned_finish_at && m.status !== "done"
                    ? ` · planned finish ${new Date(m.planned_finish_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}`
                    : ""}
                  {m.status === "not_planned" &&
                  m.needed_minutes > m.planned_minutes
                    ? ` · ${shortMinutes(m.needed_minutes - m.planned_minutes)} not planned`
                    : ""}
                </small>
              </span>
              <Pill tone={TONE[m.status]}>
                {MILESTONE_STATUS_LABELS[m.status]}
              </Pill>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <Dialog
          title={draft.id ? "Milestone" : "New milestone"}
          onClose={() => !busy && setDraft(null)}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button variant="primary" busy={busy} onClick={() => void save()}>
                Save
              </Button>
            </>
          }
        >
          <p className="muted small">Task deadlines stay unchanged.</p>
          <Field label="Name">
            <Input
              autoFocus
              required
              maxLength={120}
              placeholder="Draft ready"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={draft.due_on}
              onChange={(event) =>
                setDraft({ ...draft, due_on: event.target.value })
              }
            />
          </Field>
          {tasks.length > 0 && (
            <fieldset className="pj-checks">
              <legend>Its tasks</legend>
              {tasks.map((t) => (
                <label key={t.id} className="check">
                  <input
                    type="checkbox"
                    checked={draft.item_ids.includes(t.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        item_ids: event.target.checked
                          ? [...draft.item_ids, t.id]
                          : draft.item_ids.filter((id) => id !== t.id),
                      })
                    }
                  />
                  <span dir="auto">{t.title}</span>
                </label>
              ))}
            </fieldset>
          )}
          {editing && (
            <div className="pj-row-wrap">
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    client
                      .updateMilestone(projectId, editing.id, {
                        done: !editing.done_at,
                      })
                      .then(() => undefined),
                  )
                }
              >
                {editing.done_at ? "Not done yet" : "Mark done"}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void remove(editing)}
              >
                Remove milestone
              </Button>
            </div>
          )}
          {error && <ErrorNotice message={error} />}
        </Dialog>
      )}
    </section>
  );
}

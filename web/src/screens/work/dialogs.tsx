import {
  type ItemSort,
  type ProgressReport,
  type SavedViewInput,
  type ViewFilters,
} from "@orbyn/core";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../../lib/router";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  Segmented,
  SelectBox,
  useToast,
} from "../../ui/kit";
import { usePlanning } from "../shared-task";
import type { Filters, Layout, StatusFilter } from "./view-state";

const mondayOf = (back: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - back * 7);
  return d;
};

/** What got done this week or last, with the proof beside each. */
export function DoneDialog({ onClose }: { onClose: () => void }) {
  const { teams } = usePlanning();
  const toast = useToast();
  const [teamId, setTeamId] = useState("");
  const [back, setBack] = useState("0");
  const report = useResource<ProgressReport>(() => {
    const from = mondayOf(Number(back));
    return client.progress(
      from,
      new Date(from.getTime() + 7 * 86_400_000),
      teamId || undefined,
    );
  }, [teamId, back]);
  const count = report.data?.people.reduce((n, p) => n + p.done.length, 0) ?? 0;
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(!report.loading), [report.loading]);
  return (
    <Dialog
      title="What got done"
      wide
      onClose={onClose}
      actions={
        report.data && count > 0 ? (
          <Button
            onClick={() =>
              void navigator.clipboard.writeText(report.data!.markdown).then(
                () => toast({ text: "Copied" }),
                (e) =>
                  toast({ text: messageOf(e, "Couldn't copy."), error: true }),
              )
            }
          >
            <Copy aria-hidden="true" /> Copy as text
          </Button>
        ) : undefined
      }
    >
      <div className="work-done-controls">
        <Segmented
          label="Week"
          value={back}
          options={[
            { value: "0", label: "This week" },
            { value: "1", label: "Last week" },
          ]}
          onChange={setBack}
        />
        {teams.length > 0 && (
          <SelectBox
            aria-label="Whose work"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            <option value="">Just mine</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </SelectBox>
        )}
      </div>
      {report.error ? (
        <ErrorNotice
          message={report.error}
          onRetry={() => void report.reload()}
        />
      ) : !shown || !report.data ? (
        <Loading />
      ) : count === 0 ? (
        <p className="muted">No completed tasks for this period.</p>
      ) : (
        report.data.people.map((person) => (
          <div key={person.user_id} className="work-done-person">
            {teamId && <h3 dir="auto">{person.name}</h3>}
            <ul>
              {person.done.map((task) => (
                <li key={task.item_id}>
                  <Check aria-hidden="true" />
                  <span>
                    <span dir="auto">{task.title}</span>
                    <small>
                      {new Date(task.done_at).toLocaleDateString([], {
                        day: "numeric",
                        month: "short",
                      })}
                      {task.project ? ` · ${task.project}` : ""}
                    </small>
                    {task.proofs.map((proof, index) =>
                      proof.url ? (
                        <a
                          key={index}
                          href={proof.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {proof.note || "Proof"}
                        </a>
                      ) : (
                        <small key={index}>{proof.note}</small>
                      ),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Dialog>
  );
}

const SORT_FOR_VIEW: Record<
  ItemSort,
  NonNullable<SavedViewInput["definition"]["sort"]>
> = {
  newest: { by: "created", dir: "desc" },
  created: { by: "created", dir: "asc" },
  due: { by: "due", dir: "asc" },
  priority: { by: "priority", dir: "desc" },
  estimate: { by: "estimate", dir: "asc" },
  title: { by: "title", dir: "asc" },
  score: { by: "due", dir: "asc" },
  position: { by: "due", dir: "asc" },
};

/** Keeps this list as a saved view, which can be pinned and shared. */
export function SaveViewDialog({
  query,
  filter,
  filters,
  sort,
  group,
  layout,
  onClose,
}: {
  query: string;
  filter: StatusFilter;
  filters: Filters;
  sort: ItemSort;
  group: string;
  layout: Layout;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const left =
    (filters.priority !== "any" ? 1 : 0) +
    (filters.size !== "any" ? 1 : 0) +
    (filter !== "all" && filter !== "active" && filter !== "done" ? 1 : 0);
  const save = async () => {
    const definition: ViewFilters = {
      ...(query.trim() ? { text: query.trim().slice(0, 200) } : {}),
      status: filter === "active" ? "open" : filter === "done" ? "done" : "any",
      ...(filters.list !== "any" && filters.list !== "none"
        ? { list: filters.list }
        : {}),
      ...(filters.tag !== "any" ? { tag: filters.tag } : {}),
      ...(filters.assignee === "me"
        ? { assignee: "me" as const }
        : filters.assignee !== "any" && filters.assignee !== "none"
          ? { assignee: filters.assignee }
          : {}),
      ...(filters.due === "overdue" ? { overdue: true } : {}),
      ...(filters.due === "none" ? { no_due: true } : {}),
      ...(filters.due === "today" ? { due_within_days: 0 } : {}),
      ...(filters.due === "tomorrow" ? { due_within_days: 1 } : {}),
      ...(filters.due === "soon" || filters.due === "week"
        ? { due_within_days: 7 }
        : {}),
    };
    setBusy(true);
    setError("");
    try {
      const view = await client.createView({
        name: name.trim(),
        team_id: null,
        definition: {
          source: "tasks",
          filters: definition,
          sort: SORT_FOR_VIEW[sort],
          group_by: group,
          layout,
        },
      });
      onClose();
      toast({
        text: `Saved “${view.name}”`,
        action: { label: "Open", run: () => navigate(`/app/view/${view.id}`) },
      });
    } catch (e) {
      setError(messageOf(e, "Couldn't save the view."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Save as view"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={() => void save()}
          >
            Save view
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          autoFocus
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void save();
          }}
        />
      </Field>
      {left > 0 && (
        <p className="muted small">
          Saved views have no priority, size or single-status filter, so those
          stay here. Add them in Views.
        </p>
      )}
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}

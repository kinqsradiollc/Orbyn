import {
  fullDefinition,
  VIEW_FEATURE,
  type ItemSort,
  type ProgressReport,
  type SavedViewInput,
  type ViewFilters,
} from "@orbyn/core";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../../app/account";
import { useCapturedNavigate, useBeforeNavigate } from "../../lib/router";
import { messageOf, useResource } from "../../lib/resource";
import { client, getSessionVersion, getToken } from "../../lib/session";
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
  useConfirm,
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
  newest: { by: "created", dir: "asc" },
  created: { by: "created", dir: "desc" },
  due: { by: "due", dir: "asc" },
  priority: { by: "priority", dir: "asc" },
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
  const navigate = useCapturedNavigate();
  const { user, version } = useAccount();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const toast = useToast(),
    confirm = useConfirm();
  const mounted = useRef(true),
    lock = useRef(false);
  const attempt = useRef<{
    key: string;
    at: number;
    input: SavedViewInput;
    before: Set<string>;
  } | null>(null);
  const live = () =>
    mounted.current && !!getToken() && getSessionVersion() === version;
  const caps = useResource(() => client.viewCapabilities(), [version]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const mayLeave = async () => {
    if (!live() || lock.current || attempt.current) {
      if (live()) setError("Resolve the pending save before closing.");
      return false;
    }
    if (!name.trim()) return true;
    lock.current = true;
    try {
      const ok = await confirm({
        title: "Discard view name?",
        action: "Discard",
        danger: true,
      });
      return live() && ok;
    } finally {
      lock.current = false;
    }
  };
  useBeforeNavigate(() => mayLeave());
  const leave = async () => {
    if (await mayLeave()) onClose();
  };
  const save = async () => {
    if (
      !live() ||
      lock.current ||
      !name.trim() ||
      !caps.data?.features.includes(VIEW_FEATURE)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let request = attempt.current;
      if (!request) {
        const before = new Set(
          (await client.listViews({ fresh: true })).map((v) => v.id),
        );
        if (!live()) return;
        const exact =
          filter !== "active" && filter !== "all" && filter !== "done"
            ? filter
            : undefined;
        const definition: ViewFilters = {
          ...(query.trim() ? { text: query.trim() } : {}),
          status:
            filter === "active" ? "open" : filter === "done" ? "done" : "any",
          ...(exact ? { task_status: exact } : {}),
          ...(filters.priority !== "any" ? { priority: filters.priority } : {}),
          ...(filters.size !== "any" ? { size: filters.size } : {}),
          ...(filters.list !== "any" ? { list: filters.list } : {}),
          ...(filters.tag !== "any" ? { tag: filters.tag } : {}),
          ...(filters.assignee !== "any" ? { assignee: filters.assignee } : {}),
          ...(filters.due === "overdue" ? { overdue: true } : {}),
          ...(filters.due === "none" ? { no_due: true } : {}),
          ...(["today", "tomorrow", "soon", "week"].includes(filters.due)
            ? {
                due_bucket: filters.due as
                  "today" | "tomorrow" | "soon" | "week",
              }
            : {}),
        };
        const input: SavedViewInput = {
          name: name.trim(),
          team_id: null,
          definition: fullDefinition({
            source: "tasks",
            filters: definition,
            sort: SORT_FOR_VIEW[sort],
            group_by: group,
            layout,
          }),
        };
        request = { key: crypto.randomUUID(), at: Date.now(), input, before };
        attempt.current = request;
      }
      const age = Date.now() - request.at;
      if (!Number.isFinite(age) || age < 0 || age >= 23 * 60 * 60 * 1000)
        throw new Error(
          "This save can no longer be safely replayed. Keep this dialog open and inspect the saved-view library before starting another save.",
        );
      if (!live()) return;
      const view = await client.once(request.key, () =>
        client.createView(request.input),
      );
      if (!live() || attempt.current !== request) return;
      if (
        !view.id ||
        request.before.has(view.id) ||
        view.user_id !== user?.id ||
        view.team_id !== null ||
        view.name !== request.input.name ||
        JSON.stringify(fullDefinition(view.definition)) !==
          JSON.stringify(fullDefinition(request.input.definition))
      )
        throw new Error(
          "The save receipt did not match this view. Its outcome is still unknown; retry only this exact request.",
        );
      attempt.current = null;
      setUncertain(false);
      onClose();
      toast({
        text: `Saved “${view.name}”`,
        action: {
          label: "Open",
          run: () =>
            getToken() && getSessionVersion() === version
              ? navigate(`/app/view/${view.id}`)
              : undefined,
        },
      });
    } catch (failure) {
      if (!live()) return;
      const status = (failure as { status?: number })?.status;
      if ([400, 401, 403, 404, 409, 422].includes(status ?? 0))
        attempt.current = null;
      setUncertain(!!attempt.current);
      setError(messageOf(failure, "Couldn't save the view."));
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  };
  return (
    <Dialog
      title="Save as view"
      onClose={() => void leave()}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={busy || uncertain}
            onClick={() => void leave()}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={
              !name.trim() ||
              !caps.data?.features.includes(VIEW_FEATURE) ||
              query.trim().length > 200
            }
            onClick={() => void save()}
          >
            {uncertain ? "Retry exact save" : "Save view"}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          autoFocus
          maxLength={80}
          disabled={busy || uncertain}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void save();
          }}
        />
      </Field>
      <p className="muted small">
        Saved views list top-level tasks; events and subtasks stay in Work.
      </p>
      {query.trim().split(/\s+/).length > 1 && (
        <p className="muted small">
          Saved views match each word; Work matches the full phrase.
        </p>
      )}
      {sort === "score" || sort === "position" ? (
        <p className="muted small">
          This view keeps the exact filters. Priority score and manual order
          become deadline order.
        </p>
      ) : null}
      {query.trim().length > 200 && (
        <ErrorNotice message="Shorten the words filter to 200 characters before saving." />
      )}
      {caps.loading && <Loading label="Checking saved-view support" />}
      {caps.error && (
        <ErrorNotice message={caps.error} onRetry={() => void caps.reload()} />
      )}
      {caps.data && !caps.data.features.includes(VIEW_FEATURE) && (
        <ErrorNotice message="This server cannot save these exact task filters yet." />
      )}
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}

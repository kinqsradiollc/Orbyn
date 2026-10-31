import type {
  DocSummary,
  Item,
  Project,
  TeamMember,
  WorkRecord,
  WorkRecordKind,
} from "@orbyn/core";
import { useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  SelectBox,
  TextArea,
  useToast,
} from "../../ui/kit";
import { createItem } from "../shared-task/store";

const KINDS: { value: WorkRecordKind; label: string }[] = [
  { value: "promise", label: "Promise" },
  { value: "decision", label: "Decision" },
  { value: "experiment", label: "Experiment" },
  { value: "meeting_outcome", label: "Meeting outcome" },
];

const dateValue = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString([], { dateStyle: "medium" })
    : null;

const statusLabel = (status: string | null) =>
  status === "done"
    ? "done"
    : status === "in_progress"
      ? "in progress"
      : status === "blocked"
        ? "blocked"
        : status === "cancelled"
          ? "cancelled"
          : "not started";

const PLACEHOLDERS: Record<WorkRecordKind, [string, string]> = {
  experiment: ["What are we testing?", "What result would change our plan?"],
  meeting_outcome: [
    "What was this meeting for?",
    "Context or success criteria (optional)",
  ],
  decision: ["What did we decide?", "Why did we choose this?"],
  promise: ["What was promised?", "Context or success criteria (optional)"],
};

function NewRecord({
  project,
  tasksIn,
  notes,
  members,
  userId,
  onClose,
  onSaved,
}: {
  project: Project;
  tasksIn: Item[];
  notes: DocSummary[];
  members: TeamMember[];
  userId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [kind, setKind] = useState<WorkRecordKind>("promise");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [linked, setLinked] = useState("");
  const [date, setDate] = useState("");
  const [minutes, setMinutes] = useState("");
  const [people, setPeople] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState(userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const effortValid =
    kind !== "meeting_outcome" ||
    (!minutes && !people) ||
    (Number.isInteger(Number(minutes)) &&
      Number(minutes) >= 1 &&
      Number(minutes) <= 1440 &&
      Number.isInteger(Number(people)) &&
      Number(people) >= 1 &&
      Number(people) <= 100);
  const save = async () => {
    if (!title.trim() || !effortValid || busy) return;
    setBusy(true);
    setError("");
    try {
      const noon = date ? new Date(`${date}T12:00:00`).toISOString() : null;
      await client.createWorkRecord({
        kind,
        title: title.trim(),
        details: details.trim(),
        project_id: project.id,
        team_id: project.team_id,
        source_doc_id: source || null,
        owner_id: kind === "promise" ? owner : userId,
        linked_item_id: linked || null,
        meeting_minutes:
          kind === "meeting_outcome" && minutes ? Number(minutes) : null,
        participant_count:
          kind === "meeting_outcome" && people ? Number(people) : null,
        due_at: kind === "promise" ? noon : null,
        review_at: kind === "experiment" || kind === "decision" ? noon : null,
      });
      await onSaved();
    } catch (failure) {
      setError(
        messageOf(failure, "Couldn't save the record. It's still here."),
      );
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New record"
      onClose={() => !busy && onClose()}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!title.trim() || !effortValid}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Type">
        <SelectBox
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as WorkRecordKind);
            setMinutes("");
            setPeople("");
          }}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </SelectBox>
      </Field>
      <Field label="Title">
        <Input
          autoFocus
          placeholder={PLACEHOLDERS[kind][0]}
          value={title}
          maxLength={200}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="Context">
        <TextArea
          placeholder={PLACEHOLDERS[kind][1]}
          value={details}
          maxLength={4000}
          onChange={(event) => setDetails(event.target.value)}
        />
      </Field>
      {kind === "meeting_outcome" && (
        <>
          <div className="pj-pair">
            <Field label="Length (minutes)">
              <Input
                type="number"
                min="1"
                max="1440"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </Field>
            <Field label="People, including you">
              <Input
                type="number"
                min="1"
                max="100"
                value={people}
                onChange={(event) => setPeople(event.target.value)}
              />
            </Field>
          </div>
          {minutes && people && (
            <p className="muted small">
              {((Number(minutes) * Number(people)) / 60).toLocaleString([], {
                maximumFractionDigits: 1,
              })}{" "}
              person-hours
            </p>
          )}
        </>
      )}
      {notes.length > 0 && (
        <Field label="Source note">
          <SelectBox
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">No source note</option>
            {notes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title || "Untitled note"}
              </option>
            ))}
          </SelectBox>
        </Field>
      )}
      {kind === "promise" && !!project.team_id && (
        <Field label="Promised by">
          <SelectBox
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value={userId}>Me</option>
            {members
              .filter((m) => m.user_id !== userId)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
          </SelectBox>
        </Field>
      )}
      <Field label="Linked task">
        <SelectBox
          value={linked}
          onChange={(event) => setLinked(event.target.value)}
        >
          <option value="">No linked task</option>
          {tasksIn.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </SelectBox>
      </Field>
      {kind !== "meeting_outcome" && (
        <Field label={kind === "promise" ? "Due" : "Review"}>
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
      )}
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}

/** A project's trail of commitments and how they turned out. */
export function Records({
  focusId,
  project,
  items,
  userId,
  canWrite,
}: {
  focusId: string | null;
  project: Project;
  items: Item[];
  userId: string;
  canWrite: boolean;
}) {
  const toast = useToast();
  const data = useResource(async () => {
    const [records, notes, team] = await Promise.all([
      client.listWorkRecords({ project_id: project.id }),
      client.listDocs({ project: project.id }),
      project.team_id ? client.getTeam(project.team_id) : Promise.resolve(null),
    ]);
    return { records, notes, members: team?.members ?? [] };
  }, [project.id, project.team_id]);
  const [adding, setAdding] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<WorkRecord | null>(null);
  const [outcome, setOutcome] = useState("");
  const [outcomeError, setOutcomeError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const act = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
      await data.reload();
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't update that record."),
        error: true,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const saveOutcome = async () => {
    if (!outcomeFor || !outcome.trim() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setOutcomeError("");
    try {
      await client.updateWorkRecord(outcomeFor.id, {
        version: outcomeFor.version,
        outcome: outcome.trim(),
        status: "done",
      });
      setOutcomeFor(null);
      setOutcome("");
      await data.reload();
    } catch (failure) {
      setOutcomeError(
        messageOf(failure, "Couldn't save the outcome. It's still here."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const makeTask = (record: WorkRecord) =>
    act(async () => {
      const task = await createItem({
        kind: "task",
        title: record.title,
        team_id: project.team_id,
        project_id: project.id,
      });
      await client.updateWorkRecord(record.id, {
        version: record.version,
        linked_item_id: task.id,
      });
    });
  const records = data.data?.records;
  const notes = data.data?.notes ?? [];
  return (
    <section className="pj-records" aria-labelledby="pj-records-title">
      <header className="pj-block-head">
        <h3 id="pj-records-title">Decisions &amp; commitments</h3>
        {canWrite && (
          <Button disabled={busy || !data.data} onClick={() => setAdding(true)}>
            Add record
          </Button>
        )}
      </header>
      {data.error && (
        <ErrorNotice message={data.error} onRetry={() => void data.reload()} />
      )}
      {data.loading && !data.data && <Loading label="Loading records" />}
      {records?.length === 0 && <p className="muted small">No records yet.</p>}
      {records && records.length > 0 && (
        <ul>
          {records.map((record) => (
            <li
              key={record.id}
              className={record.id === focusId ? "is-focus" : undefined}
              ref={
                record.id === focusId
                  ? (el) => el?.scrollIntoView({ block: "center" })
                  : undefined
              }
            >
              <div className="pj-record-top">
                <span>{KINDS.find((k) => k.value === record.kind)?.label}</span>
                <span className="muted">
                  {record.status === "done"
                    ? "Completed"
                    : record.status === "proposed"
                      ? "Awaiting response"
                      : record.status.charAt(0).toUpperCase() +
                        record.status.slice(1)}
                </span>
              </div>
              <strong dir="auto">{record.title}</strong>
              {record.kind === "promise" &&
                record.owner_id !== record.created_by && (
                  <span className="muted small">
                    Promised by {record.owner_name}
                  </span>
                )}
              {record.details && <p dir="auto">{record.details}</p>}
              {record.kind === "meeting_outcome" &&
                record.meeting_minutes &&
                record.participant_count && (
                  <p className="muted small">
                    {record.meeting_minutes} minutes ·{" "}
                    {record.participant_count} people ·{" "}
                    {(
                      (record.meeting_minutes * record.participant_count) /
                      60
                    ).toLocaleString([], {
                      maximumFractionDigits: 1,
                    })}{" "}
                    person-hours
                  </p>
                )}
              {record.source_doc_id && (
                <button
                  className="pj-link"
                  dir="auto"
                  onClick={() => navigate(`/app/doc/${record.source_doc_id}`)}
                >
                  Source:{" "}
                  {notes.find((n) => n.id === record.source_doc_id)?.title ||
                    "Open note"}
                </button>
              )}
              {record.outcome && (
                <p dir="auto">
                  <strong>Outcome:</strong> {record.outcome}
                </p>
              )}
              <div className="pj-record-meta muted small">
                {record.linked_item_title && (
                  <span dir="auto">
                    Task: {record.linked_item_title} ·{" "}
                    {statusLabel(record.linked_item_status)}
                  </span>
                )}
                {record.due_at && <span>Due {dateValue(record.due_at)}</span>}
                {record.review_at && (
                  <span>Review {dateValue(record.review_at)}</span>
                )}
              </div>
              {record.kind === "decision" &&
                record.status === "open" &&
                !record.linked_item_id && (
                  <p className="pj-gap">
                    No task delivers this yet.
                    {canWrite && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void makeTask(record)}
                      >
                        Make a task
                      </Button>
                    )}
                  </p>
                )}
              <div className="pj-row-wrap">
                {record.status === "proposed" && record.owner_id === userId ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          client.respondWorkRecord(record.id, "accept"),
                        )
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          client.respondWorkRecord(record.id, "decline"),
                        )
                      }
                    >
                      Decline
                    </Button>
                  </>
                ) : canWrite &&
                  (record.status === "open" || record.status === "done") ? (
                  record.status === "open" &&
                  (record.kind === "experiment" ||
                    record.kind === "meeting_outcome") ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setOutcomeFor(record);
                        setOutcome(record.outcome);
                        setOutcomeError("");
                      }}
                    >
                      Record outcome
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          client.updateWorkRecord(record.id, {
                            version: record.version,
                            status: record.status === "open" ? "done" : "open",
                          }),
                        )
                      }
                    >
                      {record.status === "open" ? "Mark complete" : "Reopen"}
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && data.data && (
        <NewRecord
          project={project}
          tasksIn={items.filter(
            (i) => i.project_id === project.id && i.kind === "task",
          )}
          notes={notes}
          members={data.data.members}
          userId={userId}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await data.reload();
          }}
        />
      )}
      {outcomeFor && (
        <Dialog
          title="Record outcome"
          onClose={() => !busy && setOutcomeFor(null)}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setOutcomeFor(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={!outcome.trim()}
                onClick={() => void saveOutcome()}
              >
                Save outcome
              </Button>
            </>
          }
        >
          <Field label="What happened?">
            <TextArea
              autoFocus
              disabled={busy}
              value={outcome}
              maxLength={4000}
              onChange={(event) => setOutcome(event.target.value)}
            />
          </Field>
          {outcomeError && <ErrorNotice message={outcomeError} />}
        </Dialog>
      )}
    </section>
  );
}

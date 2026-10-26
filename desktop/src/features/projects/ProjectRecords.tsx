import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import type {
  Item,
  DocSummary,
  Project,
  TeamMember,
  WorkRecord,
  WorkRecordKind,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Select } from "../../components/Select";
import { DateField } from "../../components/DateField";

const kinds: { value: WorkRecordKind; label: string }[] = [
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

/** Small, project-scoped trail of commitments and their outcomes. */
export function ProjectRecords(
  props: Parameters<typeof ProjectRecordsBody>[0],
) {
  return (
    <ProjectRecordsBody
      key={`${props.project.id}:${props.userId}`}
      {...props}
    />
  );
}

function ProjectRecordsBody({
  focusId = null,
  project,
  items,
  userId,
  canWrite,
  onOpenNote,
  report,
}: {
  focusId?: string | null;
  project: Project;
  items: Item[];
  userId: string;
  canWrite: boolean;
  onOpenNote?: (docId: string) => void;
  report: (error: unknown) => void;
}) {
  const [records, setRecords] = useState<WorkRecord[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<WorkRecordKind>("promise");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [linkedItem, setLinkedItem] = useState("");
  const [date, setDate] = useState("");
  const [meetingMinutes, setMeetingMinutes] = useState("");
  const [participantCount, setParticipantCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [notes, setNotes] = useState<DocSummary[]>([]);
  const [sourceDocId, setSourceDocId] = useState("");
  const [ownerId, setOwnerId] = useState(userId);
  const [editingOutcome, setEditingOutcome] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");

  const request = useRef(0);
  const mutation = useRef(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const load = async () => {
    const epoch = ++request.current;
    setFailed(false);
    try {
      const [next, pages, team] = await Promise.all([
        client.listWorkRecords({ project_id: project.id }),
        client.listDocs({ project: project.id }),
        project.team_id
          ? client.getTeam(project.team_id)
          : Promise.resolve(null),
      ]);
      if (epoch !== request.current) return;
      setRecords(next);
      setNotes(pages);
      setMembers(team?.members ?? []);
      setReady(true);
    } catch (e) {
      if (epoch === request.current) {
        setFailed(true);
        report(e);
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [project.id, project.team_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !canWrite ||
      !ready ||
      mutation.current ||
      !title.trim() ||
      !meetingEffortValid
    )
      return;
    mutation.current = true;
    setBusy(true);
    try {
      await client.createWorkRecord({
        kind,
        title: title.trim(),
        details: details.trim(),
        project_id: project.id,
        team_id: project.team_id,
        source_doc_id: sourceDocId || null,
        owner_id: kind === "promise" ? ownerId : userId,
        linked_item_id: linkedItem || null,
        meeting_minutes:
          kind === "meeting_outcome" && meetingMinutes
            ? Number(meetingMinutes)
            : null,
        participant_count:
          kind === "meeting_outcome" && participantCount
            ? Number(participantCount)
            : null,
        due_at:
          kind === "promise" && date
            ? new Date(`${date}T12:00:00`).toISOString()
            : null,
        review_at:
          (kind === "experiment" || kind === "decision") && date
            ? new Date(`${date}T12:00:00`).toISOString()
            : null,
      });
      setTitle("");
      setDetails("");
      setLinkedItem("");
      setSourceDocId("");
      setDate("");
      setMeetingMinutes("");
      setParticipantCount("");
      setOwnerId(userId);
      setAdding(false);
      await load();
    } catch (error) {
      report(error);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const changeStatus = async (record: WorkRecord, status: "done" | "open") => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await client.updateWorkRecord(record.id, {
        version: record.version,
        status,
      });
      await load();
    } catch (error) {
      report(error);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const respond = async (
    record: WorkRecord,
    decision: "accept" | "decline",
  ) => {
    if (record.owner_id !== userId || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await client.respondWorkRecord(record.id, decision);
      await load();
    } catch (error) {
      report(error);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  /** Turn a decision nobody is delivering yet into a task on this project. */
  const makeTask = async (record: WorkRecord) => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      const task = await client.createItem({
        kind: "task",
        title: record.title,
        team_id: project.team_id,
        project_id: project.id,
      });
      await client.updateWorkRecord(record.id, {
        version: record.version,
        linked_item_id: task.id,
      });
      await load();
    } catch (error) {
      report(error);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const saveOutcome = async (record: WorkRecord) => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await client.updateWorkRecord(record.id, {
        version: record.version,
        outcome: outcome.trim(),
        status: "done",
      });
      setEditingOutcome(null);
      setOutcome("");
      await load();
    } catch (error) {
      report(error);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const tasks = items.filter(
    (item) => item.project_id === project.id && item.kind === "task",
  );
  const meetingEffortValid =
    kind !== "meeting_outcome" ||
    (!meetingMinutes && !participantCount) ||
    (Number.isInteger(Number(meetingMinutes)) &&
      Number(meetingMinutes) >= 1 &&
      Number(meetingMinutes) <= 1440 &&
      Number.isInteger(Number(participantCount)) &&
      Number(participantCount) >= 1 &&
      Number(participantCount) <= 100);
  return (
    <section
      className="project-records"
      aria-labelledby="project-records-title"
    >
      <div className="project-records-head">
        <div>
          <h3 id="project-records-title">Decisions & commitments</h3>
        </div>
        {canWrite && (
          <button
            className="secondary"
            disabled={busy || !ready}
            onClick={() => {
              setEditingOutcome(null);
              setAdding(true);
            }}
          >
            Add record
          </button>
        )}
      </div>
      {failed && (
        <p role="status">
          Project records unavailable.{" "}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void load()}
          >
            Retry
          </button>
        </p>
      )}
      {adding && (
        <RecordDialog
          title="New record"
          busy={busy}
          onClose={() => setAdding(false)}
        >
          <form className="project-record-form" onSubmit={create}>
            <fieldset disabled={busy} className="project-record-fields">
              <Select
                aria-label="Record type"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as WorkRecordKind);
                  setMeetingMinutes("");
                  setParticipantCount("");
                }}
              >
                {kinds.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <input
                aria-label="Record title"
                placeholder={
                  kind === "experiment"
                    ? "What are we testing?"
                    : kind === "meeting_outcome"
                      ? "What was this meeting for?"
                      : kind === "decision"
                        ? "What did we decide?"
                        : "What was promised?"
                }
                value={title}
                maxLength={200}
                required
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                aria-label="Context"
                placeholder={
                  kind === "experiment"
                    ? "What result would change our plan?"
                    : kind === "decision"
                      ? "Why did we choose this?"
                      : "Context or success criteria (optional)"
                }
                value={details}
                maxLength={4000}
                onChange={(e) => setDetails(e.target.value)}
              />
              {kind === "meeting_outcome" && (
                <div className="project-record-meeting">
                  <label>
                    Length (minutes)
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={meetingMinutes}
                      onChange={(event) =>
                        setMeetingMinutes(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    People, including you
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={participantCount}
                      onChange={(event) =>
                        setParticipantCount(event.target.value)
                      }
                    />
                  </label>
                  {meetingMinutes && participantCount && (
                    <span className="muted">
                      {(
                        (Number(meetingMinutes) * Number(participantCount)) /
                        60
                      ).toLocaleString([], { maximumFractionDigits: 1 })}{" "}
                      person-hours
                    </span>
                  )}
                </div>
              )}
              {!!notes.length && (
                <Select
                  aria-label="Source note"
                  value={sourceDocId}
                  onChange={(event) => setSourceDocId(event.target.value)}
                >
                  <option value="">No source note</option>
                  {notes.map((note) => (
                    <option key={note.id} value={note.id}>
                      {note.title || "Untitled note"}
                    </option>
                  ))}
                </Select>
              )}
              {kind === "promise" && !!project.team_id && (
                <label className="project-record-owner">
                  Promised by
                  <Select
                    aria-label="Promise owner"
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                  >
                    <option value={userId}>Me</option>
                    {members
                      .filter((member) => member.user_id !== userId)
                      .map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {member.name}
                        </option>
                      ))}
                  </Select>
                </label>
              )}
              <div className="project-record-form-bottom">
                <Select
                  aria-label="Linked task"
                  value={linkedItem}
                  onChange={(e) => setLinkedItem(e.target.value)}
                >
                  <option value="">No linked task</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </Select>
                {(kind === "promise" ||
                  kind === "experiment" ||
                  kind === "decision") && (
                  <label>
                    {kind === "promise" ? "Due" : "Review"}{" "}
                    <DateField
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy || !meetingEffortValid}
                >
                  Save
                </button>
              </div>
            </fieldset>
          </form>
        </RecordDialog>
      )}
      {records === null ? (
        <p className="muted">{failed ? "" : "Loading records…"}</p>
      ) : records.length === 0 ? (
        <p className="muted project-record-empty">No records yet.</p>
      ) : (
        <ul className="project-record-list">
          {records.map((record) => (
            <li
              key={record.id}
              className={
                record.id === focusId ? "project-source-focus" : undefined
              }
              ref={
                record.id === focusId
                  ? (element) => element?.scrollIntoView({ block: "center" })
                  : undefined
              }
            >
              <div className="project-record-top">
                <span className="project-record-kind">
                  {kinds.find((k) => k.value === record.kind)?.label}
                </span>
                <span className="muted">
                  {record.status === "done"
                    ? "Completed"
                    : record.status === "proposed"
                      ? "Awaiting response"
                      : record.status.charAt(0).toUpperCase() +
                        record.status.slice(1)}
                </span>
              </div>
              <strong>{record.title}</strong>
              {record.kind === "promise" &&
                record.owner_id !== record.created_by && (
                  <span className="muted">Promised by {record.owner_name}</span>
                )}
              {record.details && <p>{record.details}</p>}
              {record.kind === "meeting_outcome" &&
                record.meeting_minutes &&
                record.participant_count && (
                  <p className="muted">
                    {record.meeting_minutes} minutes ·{" "}
                    {record.participant_count} people ·{" "}
                    {(
                      (record.meeting_minutes * record.participant_count) /
                      60
                    ).toLocaleString([], { maximumFractionDigits: 1 })}{" "}
                    person-hours
                  </p>
                )}
              {record.source_doc_id && onOpenNote && (
                <button
                  className="text-button project-record-source"
                  onClick={() => onOpenNote(record.source_doc_id!)}
                >
                  Source:{" "}
                  {notes.find((note) => note.id === record.source_doc_id)
                    ?.title || "Open note"}
                </button>
              )}
              {record.outcome && (
                <p className="project-record-outcome">
                  <strong>Outcome:</strong> {record.outcome}
                </p>
              )}
              <div className="project-record-meta muted">
                {record.linked_item_title && (
                  <span>
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
                  <p className="project-record-gap">
                    No task delivers this yet.
                    {canWrite && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void makeTask(record)}
                      >
                        Make a task
                      </button>
                    )}
                  </p>
                )}
              {record.status === "proposed" && record.owner_id === userId ? (
                <div className="project-record-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void respond(record, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void respond(record, "decline")}
                  >
                    Decline
                  </button>
                </div>
              ) : (
                canWrite &&
                (record.status === "open" || record.status === "done") && (
                  <>
                    {editingOutcome === record.id && (
                      <RecordDialog
                        title="Record outcome"
                        busy={busy}
                        onClose={() => setEditingOutcome(null)}
                      >
                        <div className="project-record-form">
                          <textarea
                            disabled={busy}
                            aria-label="What happened?"
                            placeholder="What happened?"
                            value={outcome}
                            maxLength={4000}
                            onChange={(event) => setOutcome(event.target.value)}
                          />
                          <div className="project-record-actions">
                            <button
                              className="primary"
                              disabled={busy || !outcome.trim()}
                              onClick={() => void saveOutcome(record)}
                            >
                              Save outcome
                            </button>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => setEditingOutcome(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </RecordDialog>
                    )}
                    <div className="project-record-actions">
                      {record.status === "open" &&
                      (record.kind === "experiment" ||
                        record.kind === "meeting_outcome") ? (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setEditingOutcome(record.id);
                            setOutcome(record.outcome);
                          }}
                        >
                          Record outcome
                        </button>
                      ) : (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void changeStatus(
                              record,
                              record.status === "open" ? "done" : "open",
                            )
                          }
                        >
                          {record.status === "open"
                            ? "Mark complete"
                            : "Reopen"}
                        </button>
                      )}
                    </div>
                  </>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecordDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(
    <dialog
      ref={focus.ref as RefObject<HTMLDialogElement>}
      className="project-record-dialog"
      aria-label={title}
      data-modal-owner={focus.id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>,
    document.body,
  );
}

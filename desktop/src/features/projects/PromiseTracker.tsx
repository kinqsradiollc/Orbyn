import { useEffect, useState } from "react";
import { hasTeamPermission, type Team, type WorkRecord } from "@orbyn/core";
import { client } from "../../lib/api";

/** Open commitments across projects, including those awaiting a response. */
export function PromiseTracker({
  userId,
  teams,
  onProject,
  report,
}: {
  userId: string;
  teams: Team[];
  onProject: (id: string) => void;
  report: (error: unknown) => void;
}) {
  const [rows, setRows] = useState<WorkRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () =>
    client
      .listWorkRecords({ kind: "promise", limit: 200 })
      .then(setRows)
      .catch(report);
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const active =
    rows?.filter((row) => row.status === "open" || row.status === "proposed") ??
    [];
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="promise-tracker" aria-label="Promises">
      <button
        className="promise-tracker-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <strong>Promises</strong>
        <span className="muted">
          {rows === null ? "Loading…" : `${active.length} needing attention`}
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="promise-tracker-body">
          {!active.length && (
            <p className="muted">No open promises right now.</p>
          )}
          {active.map((record) => {
            const due = record.due_at ? new Date(record.due_at) : null;
            const overdue = due && due.getTime() < Date.now();
            const canWrite =
              !record.team_id ||
              hasTeamPermission(
                teams.find((team) => team.id === record.team_id)?.role,
                "items:write",
              );
            return (
              <div className="promise-tracker-row" key={record.id}>
                <div>
                  <strong>{record.title}</strong>
                  <small className="muted">
                    {record.owner_id === userId
                      ? "Promised by you"
                      : `Promised by ${record.owner_name}`}
                    {due && (
                      <>
                        {" "}
                        ·{" "}
                        <span className={overdue ? "promise-overdue" : ""}>
                          {overdue ? "Overdue " : "Due "}
                          {due.toLocaleDateString([], { dateStyle: "medium" })}
                        </span>
                      </>
                    )}
                    {record.status === "proposed" && " · Awaiting response"}
                  </small>
                </div>
                <div className="promise-tracker-actions">
                  {record.project_id && (
                    <button
                      className="text-button"
                      onClick={() => onProject(record.project_id!)}
                    >
                      Project
                    </button>
                  )}
                  {record.status === "proposed" &&
                    record.owner_id === userId && (
                      <>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              client.respondWorkRecord(record.id, "accept"),
                            )
                          }
                        >
                          Accept
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              client.respondWorkRecord(record.id, "decline"),
                            )
                          }
                        >
                          Decline
                        </button>
                      </>
                    )}
                  {record.status === "open" && canWrite && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          client.updateWorkRecord(record.id, {
                            version: record.version,
                            status: "done",
                          }),
                        )
                      }
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

import { hasTeamPermission, type Team } from "@orbyn/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, ErrorNotice, useToast } from "../../ui/kit";

/** Open commitments across projects, including those awaiting a response. */
export function Promises({ userId, teams }: { userId: string; teams: Team[] }) {
  const toast = useToast();
  const rows = useResource(
    () => client.listWorkRecords({ kind: "promise", limit: 200 }),
    [userId],
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const active = (rows.data ?? []).filter(
    (r) => r.status === "open" || r.status === "proposed",
  );
  const act = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
      await rows.reload();
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't update that promise."),
        error: true,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section aria-label="Promises" className="pj-promises">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        <Chevron aria-hidden="true" />
        <span>Promises</span>
        <span className="muted small">
          {rows.error && !rows.data
            ? "Unavailable"
            : !rows.data
              ? "Loading…"
              : `${active.length} needing attention`}
        </span>
      </button>
      {open && (
        <div>
          {rows.error && (
            <ErrorNotice
              message={rows.error}
              onRetry={() => void rows.reload()}
            />
          )}
          {rows.data && !active.length && (
            <p className="muted small">No open promises right now.</p>
          )}
          <ul>
            {active.map((record) => {
              const due = record.due_at ? new Date(record.due_at) : null;
              const overdue = due && due.getTime() < Date.now();
              const canWrite =
                !record.team_id ||
                hasTeamPermission(
                  teams.find((t) => t.id === record.team_id)?.role,
                  "items:write",
                );
              return (
                <li key={record.id}>
                  <div className="pj-promise-main">
                    <span dir="auto">{record.title}</span>
                    <small className="muted">
                      {record.owner_id === userId
                        ? "Promised by you"
                        : `Promised by ${record.owner_name}`}
                      {due && (
                        <>
                          {" · "}
                          <span className={overdue ? "pj-late" : ""}>
                            {overdue ? "Overdue " : "Due "}
                            {due.toLocaleDateString([], {
                              dateStyle: "medium",
                            })}
                          </span>
                        </>
                      )}
                      {record.status === "proposed" && " · Awaiting response"}
                    </small>
                  </div>
                  <div className="pj-row-wrap">
                    {record.project_id && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          navigate(`/app/project/${record.project_id}`)
                        }
                      >
                        Project
                      </Button>
                    )}
                    {record.status === "proposed" &&
                      record.owner_id === userId && (
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
                      )}
                    {record.status === "open" && canWrite && (
                      <Button
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
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

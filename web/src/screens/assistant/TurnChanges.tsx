import { useRef, useState } from "react";
import { client } from "../../lib/session";
import { Button, ErrorNotice } from "../../ui/kit";
import { useOwned } from "../agents-shared/hooks";
import { changeWords, realChanges } from "../agents-shared/words";
import { More } from "../agents-shared/parts";
import { tasks, refreshPlanner } from "../shared-task";
import { navigate } from "../../lib/router";
import { useRead } from "./state";
export function TurnChanges({ job }: { job: string }) {
  const owned = useOwned(),
    lock = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const read = useRead(() => client.assistantJobChanges(job), [job]);
  const changes = read.data?.changes ?? [],
    shown = realChanges(changes);
  const undo = async () => {
    if (!owned() || lock.current || !read.data?.grantId || stale) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await client.undoAgentJob(read.data.grantId, job);
      if (!owned()) return;
      setStale(true);
      await refreshPlanner();
      const receipt = await read.reload();
      if (owned() && receipt) setStale(false);
    } catch {
      if (owned()) {
        setStale(true);
        setError(
          "Couldn't confirm Undo. Reload these changes before another action.",
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  return (
    <More summary="What this reply changed">
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}{" "}
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => {
            void read.reload().then((value) => {
              if (owned() && value) setStale(false);
            });
          }}
        />
      )}
      {read.loading && <p role="status">Loading changes…</p>}
      {!read.loading && !read.error && !changes.length && (
        <p>No direct changes recorded.</p>
      )}
      <ul>
        {shown.map((change) => (
          <li key={change.id}>
            {changeWords(change)}
            {change.links?.map((link) => (
              <Button
                key={`${link.kind}:${link.id}`}
                onClick={() => {
                  if (!owned()) return;
                  if (link.kind === "task") tasks.open(link.id);
                  else
                    navigate(
                      `/app/${link.kind === "doc" ? "doc" : "project"}/${encodeURIComponent(link.id)}`,
                    );
                }}
              >
                {link.title || "Open item"}
              </Button>
            ))}
          </li>
        ))}
      </ul>
      {!!read.data?.grantId &&
        changes.some((change) => change.undoable && !change.undone_at) && (
          <Button
            disabled={busy || read.loading || stale}
            onClick={() => void undo()}
          >
            Undo these changes
          </Button>
        )}
    </More>
  );
}

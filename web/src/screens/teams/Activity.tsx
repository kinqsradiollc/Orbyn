import { useRef, useState } from "react";
import {
  changeVerb,
  changeEdits,
  type TeamChange,
  type TeamChangesPage,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, ErrorNotice } from "../../ui/kit";
import { useTasks } from "../shared-task/host-store";
import { ReadState, useOwned, useRead } from "./state";
export function Activity({ teamId }: { teamId: string }) {
  const tasks = useTasks();
  const [hideMine, setHideMine] = useState(true),
    [extra, setExtra] = useState<TeamChangesPage[]>([]),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    lock = useRef(false),
    owned = useOwned(),
    read = useRead(
      () =>
        client.listChanges({ team_id: teamId, hide_mine: hideMine, limit: 50 }),
      [teamId, hideMine],
    );
  const rows: TeamChange[] = [
      ...new Map(
        [...(read.data?.changes ?? []), ...extra.flatMap((p) => p.changes)].map(
          (c) => [c.id, c],
        ),
      ).values(),
    ],
    cursor = extra.length ? extra[extra.length - 1].next : read.data?.next;
  const more = async () => {
    if (!cursor || lock.current || !owned()) return;
    lock.current = true;
    setPending(true);
    setError("");
    const opening = cursor,
      scope = hideMine;
    try {
      const page = await client.listChanges({
        team_id: teamId,
        hide_mine: scope,
        before: opening,
        limit: 50,
      });
      if (owned()) setExtra((s) => [...s, page]);
    } catch (e) {
      if (owned())
        setError(
          e instanceof Error ? e.message : "Could not load earlier changes.",
        );
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  };
  return (
    <section className="teams-section">
      <header className="teams-heading">
        <h3>Recent changes</h3>
        <label className="teams-check">
          <input
            type="checkbox"
            checked={hideMine}
            disabled={pending}
            onChange={(e) => {
              setHideMine(e.target.checked);
              setExtra([]);
            }}
          />
          Hide my changes
        </label>
      </header>
      <ReadState read={read} label="changes" />
      {error && <ErrorNotice message={error} onRetry={() => void more()} />}
      <ul className="teams-records">
        {rows.map((c) => (
          <li key={c.id}>
            <span>
              {changeVerb(c)}
              {c.via_agent ? ` via ${c.via_agent}` : ""}
            </span>
            {c.open ? (
              <Button
                variant="ghost"
                onClick={() =>
                  tasks.peek({
                    kind: c.kind === "page" ? "doc" : "task",
                    id: c.object_id,
                  })
                }
              >
                <span dir="auto">{c.title}</span>
              </Button>
            ) : (
              <strong dir="auto">{c.title}</strong>
            )}
            <span className="small">
              {new Date(c.at).toLocaleString()} {changeEdits(c)}
            </span>
          </li>
        ))}
      </ul>
      {read.data && !rows.length && <p>No shared changes in this view.</p>}
      {cursor && (
        <Button busy={pending} onClick={() => void more()}>
          Earlier changes
        </Button>
      )}
      <Button
        disabled={pending || read.loading}
        onClick={() => {
          setExtra([]);
          void read.reload();
        }}
      >
        Refresh changes
      </Button>
    </section>
  );
}

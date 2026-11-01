import { flushSync } from "react-dom";
import {
  activityOriginLabel,
  changeEdits,
  changeTime,
  changeVerb,
  groupChangesByDay,
  type TeamChange,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client, getSessionVersion } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { useNavigate } from "../../lib/router";
import { RouteScopeProvider, useRouteScope } from "../../lib/route-scope";
import {
  deviceTimeZone,
  usePlanning,
  useTasks,
} from "../../screens/shared-task";
import { Button, Dialog, ErrorNotice, Loading, SelectBox } from "../../ui/kit";

function ActivityBody({ onClose }: { onClose(): void }) {
  const navigate = useNavigate(),
    tasks = useTasks(),
    { teams } = usePlanning();
  const [generation] = useState(getSessionVersion);
  const [team, setTeam] = useState(""),
    [hideMine, setHideMine] = useState(true),
    [attempt, retry] = useState(0);
  const [data, setData] = useState<{
      key: string;
      rows: TeamChange[];
      cursor: string | null;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    request = useRef(0),
    mutex = useRef(false);
  const key = `${team}:${hideMine}`,
    latest = useRef(key);
  latest.current = key;
  const current = () => alive.current && generation === getSessionVersion();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const read = async (more = false) => {
    if (!current() || (more && mutex.current)) return;
    const mine = ++request.current,
      opening = key,
      previous = more && data?.key === key ? data : null;
    mutex.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await client.listChanges({
        ...(team ? { team_id: team } : {}),
        hide_mine: hideMine,
        limit: 40,
        ...(previous?.cursor ? { before: previous.cursor } : {}),
      });
      if (!current() || mine !== request.current || latest.current !== opening)
        return;
      const rows = [...(previous?.rows ?? []), ...result.changes];
      setData({
        key: opening,
        rows: [...new Map(rows.map((row) => [row.id, row])).values()],
        cursor: result.next,
      });
    } catch (failure) {
      if (current() && mine === request.current && latest.current === opening)
        setError(messageOf(failure, "Couldn't load recent changes."));
    } finally {
      if (mine === request.current) {
        mutex.current = false;
        if (current()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    void read();
  }, [key, attempt]);
  const rows = data?.key === key ? data.rows : [];
  return (
    <Dialog
      title="Recent changes"
      wide
      onClose={onClose}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <div className="shell-search-options">
        <label className="field">
          Space
          <SelectBox value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {teams.map((row) => (
              <option value={row.id} key={row.id}>
                {row.name}
              </option>
            ))}
          </SelectBox>
        </label>
        <label>
          <input
            type="checkbox"
            checked={hideMine}
            onChange={(e) => setHideMine(e.target.checked)}
          />
          Hide my changes
        </label>
        <Button disabled={busy} onClick={() => retry((at) => at + 1)}>
          Refresh
        </Button>
      </div>
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => void read(!!data?.rows.length)}
        />
      )}
      {busy && !rows.length && <Loading label="Loading changes" />}
      {!busy && !error && !rows.length && (
        <p className="muted">No recent changes match these filters.</p>
      )}
      {groupChangesByDay(rows, deviceTimeZone()).map((day) => (
        <section className="shell-activity-day" key={day.day}>
          <h3>{day.label}</h3>
          {day.changes.map((change) => (
            <button
              className="shell-activity-row"
              key={change.id}
              disabled={!change.open || busy}
              onClick={(e) => {
                if (!current() || latest.current !== key) return;
                flushSync(onClose);
                if (generation !== getSessionVersion()) return;
                if (e.metaKey || e.ctrlKey)
                  tasks.peek({
                    kind: change.kind === "page" ? "doc" : "task",
                    id: change.object_id,
                  });
                else if (change.kind === "page")
                  navigate(`/app/doc/${change.object_id}`);
                else tasks.open(change.object_id);
              }}
            >
              <span>
                {changeVerb(change)}{" "}
                <strong dir="auto">{change.title || "Untitled"}</strong>
                <small className="muted">
                  {[
                    changeEdits(change),
                    change.team_name,
                    activityOriginLabel({ via_agent: change.via_agent }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <time dateTime={change.at}>
                {changeTime(change.at, deviceTimeZone())}
              </time>
            </button>
          ))}
        </section>
      ))}
      {data?.key === key && data.cursor && (
        <Button busy={busy} onClick={() => void read(true)}>
          Earlier changes
        </Button>
      )}
    </Dialog>
  );
}
export function Activity(props: { onClose(): void }) {
  const opening = useRouteScope(),
    [scope] = useState(opening);
  return (
    <RouteScopeProvider value={scope}>
      <ActivityBody {...props} />
    </RouteScopeProvider>
  );
}

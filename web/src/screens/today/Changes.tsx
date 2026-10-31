import {
  activityOriginLabel,
  changeEdits,
  changeTime,
  changeVerb,
  groupChangesByDay,
} from "@orbyn/core";
import { useState } from "react";
import { useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { ErrorNotice, Loading } from "../../ui/kit";
import { deviceTimeZone, tasks } from "../shared-task";

const HIDE_KEY = "orbyn-changes-hide-mine";
const hideAtFirst = () => {
  try {
    return localStorage.getItem(HIDE_KEY) !== "0";
  } catch {
    return true;
  }
};

/** What changed in your teams, others' changes first. */
export function Changes() {
  const [hideMine, setHideMine] = useState(hideAtFirst);
  const read = useResource(
    () => client.listChanges({ hide_mine: hideMine, limit: 12 }),
    [hideMine],
  );
  const zone = deviceTimeZone();
  const days = groupChangesByDay(read.data?.changes ?? [], zone);
  return (
    <section className="today-section" aria-labelledby="today-changes">
      <header className="today-section-head">
        <h2 id="today-changes">Recent changes</h2>
        <label className="today-switch">
          <input
            type="checkbox"
            checked={hideMine}
            onChange={(event) => {
              setHideMine(event.target.checked);
              try {
                localStorage.setItem(
                  HIDE_KEY,
                  event.target.checked ? "1" : "0",
                );
              } catch {
                // Kept for this visit.
              }
            }}
          />
          Hide mine
        </label>
      </header>
      {read.error && !read.data && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {read.loading && !read.data && <Loading label="Loading recent changes" />}
      {read.data && !days.length && (
        <p className="muted">
          {hideMine ? "No recent changes from others." : "No recent changes."}
        </p>
      )}
      {days.slice(0, 2).map((day) => (
        <div key={day.day} className="today-change-day">
          <h3>{day.label}</h3>
          <ul>
            {day.changes.slice(0, 5).map((change) => {
              const facts = [
                changeEdits(change),
                change.team_name,
                activityOriginLabel({ via_agent: change.via_agent }),
              ]
                .filter(Boolean)
                .join(" · ");
              const open = () =>
                change.kind === "page"
                  ? navigate(`/app/doc/${change.object_id}`)
                  : tasks.open(change.object_id);
              return (
                <li key={change.id}>
                  <button
                    disabled={!change.open}
                    title={
                      change.open
                        ? "Open. ⌘-click opens it beside."
                        : "It was deleted since."
                    }
                    onClick={(event) =>
                      event.metaKey || event.ctrlKey
                        ? tasks.peek({
                            kind: change.kind === "page" ? "doc" : "task",
                            id: change.object_id,
                          })
                        : open()
                    }
                  >
                    <span className="today-change-main" dir="auto">
                      {changeVerb(change)}{" "}
                      <strong>{change.title || "Untitled"}</strong>
                      {facts && <small>{facts}</small>}
                    </span>
                    <time dateTime={change.at}>
                      {changeTime(change.at, zone)}
                    </time>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

import {
  addDays,
  buildWeekScene,
  hoursLabel,
  localDateKey,
  weekRange,
  weekStartOf,
} from "@orbyn/core";
import { useMemo } from "react";
import { useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, ErrorNotice } from "../../ui/kit";
import { usePlanning } from "../shared-task";

/**
 * The week's load at a glance, from the same model the 3D Planner draws: a
 * day's bar is its booked time against its working time.
 */
export function Week({ stamp }: { stamp: unknown }) {
  const { prefs } = usePlanning();
  const zone = prefs?.timezone;
  const first = zone ? weekStartOf(localDateKey(new Date(), zone)) : "";
  const read = useResource(async () => {
    if (!prefs) return null;
    const { from, to } = weekRange(first, prefs.timezone);
    return client.calendar(from, to);
  }, [first, zone, stamp]);
  const scene = useMemo(
    () =>
      read.data && prefs
        ? buildWeekScene({ week_start: first, view: read.data, prefs })
        : null,
    [read.data, prefs, first],
  );
  if (read.error && !scene)
    return (
      <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
    );
  if (!scene) return null;
  const clashes = scene.issues.filter((i) => i.kind === "clash").length;
  const late = scene.issues.filter((i) => i.kind === "late").length;
  const over = scene.issues.filter((i) => i.kind === "over").length;
  const notes = [
    over ? `${over} ${over === 1 ? "day" : "days"} over` : "",
    clashes ? `${clashes} ${clashes === 1 ? "clash" : "clashes"}` : "",
    late ? `${late} late ${late === 1 ? "session" : "sessions"}` : "",
  ].filter(Boolean);
  return (
    <section className="today-section" aria-labelledby="today-week">
      <header className="today-section-head">
        <h2 id="today-week">This week</h2>
        <Button variant="ghost" onClick={() => navigate("/app/calendar")}>
          Planner
        </Button>
      </header>
      <ol className="today-week">
        {scene.days.map((day, n) => {
          const whole = Math.max(day.working_minutes, day.booked_minutes, 60);
          const label = new Date(
            `${addDays(first, n)}T12:00:00Z`,
          ).toLocaleDateString([], {
            weekday: "narrow",
            timeZone: "UTC",
          });
          return (
            <li key={day.date}>
              <button
                className={`${day.today ? "is-today" : ""}${day.over ? " is-over" : ""}${day.off ? " is-off" : ""}`}
                aria-label={`${day.date}: ${hoursLabel(day.booked_minutes)} booked, ${hoursLabel(day.free_minutes)} free`}
                title={`${hoursLabel(day.booked_minutes)} booked · ${hoursLabel(day.free_minutes)} free`}
                onClick={() => navigate(`/app/calendar?date=${day.date}`)}
              >
                <span className="today-week-bar">
                  <i
                    style={{
                      height: `${Math.min(100, (day.booked_minutes / whole) * 100)}%`,
                    }}
                  />
                </span>
                <span aria-hidden="true">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {notes.length > 0 && <p className="muted small">{notes.join(" · ")}</p>}
    </section>
  );
}

import {
  dateLabel,
  type AssistantIdea,
  type Item,
  type UpNext as UpNextData,
} from "@orbyn/core";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, Pill } from "../../ui/kit";
import { progressOf, tasks, TaskRow, usePlanning } from "../shared-task";
import { minutesText } from "./dates";

const REFRESH_MS = 5 * 60_000;

const windowText = (next: UpNextData) => {
  const w = next.window;
  if (!w) return "No free time right now";
  if (w.until) return `${minutesText(w.minutes)} free before ${w.until}`;
  const end = new Date(w.end_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${minutesText(w.minutes)} free until ${end}`;
};

/**
 * What to do now: the task most worth starting in the free time ahead, why,
 * and two others. Tasks already on the plan or queue are not repeated.
 */
export function UpNext({
  items,
  excludeIds,
}: {
  items: Item[];
  excludeIds: Set<string>;
}) {
  const [next, setNext] = useState<UpNextData | null>(null);
  const [failed, setFailed] = useState(false);
  const [why, setWhy] = useState(false);
  const fetched = useRef(0);
  useEffect(() => {
    let alive = true;
    let request = 0;
    const load = () => {
      const version = ++request;
      fetched.current = Date.now();
      client.getUpNext().then(
        (value) => {
          if (alive && version === request) {
            setNext(value);
            setFailed(false);
          }
        },
        () => {
          if (alive && version === request) setFailed(true);
        },
      );
    };
    const wait = Math.max(0, 15_000 - (Date.now() - fetched.current));
    const soon = setTimeout(load, fetched.current ? wait : 0);
    const every = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearTimeout(soon);
      clearInterval(every);
    };
  }, [items]);
  if (failed && !next) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = (next?.suggestions ?? []).filter(
    (s) => byId.has(s.item_id) && !excludeIds.has(s.item_id),
  );
  const [first, ...rest] = shown;
  const item = first && byId.get(first.item_id)!;
  return (
    <section
      className={`today-next${first ? "" : " is-quiet"}`}
      aria-labelledby="today-up-next"
    >
      <header className="today-section-head">
        <h2 id="today-up-next">Up next</h2>
        <span className="today-head-note">
          {next ? windowText(next) : "Finding your next step…"}
        </span>
      </header>
      {first && item ? (
        <div className="today-next-main">
          <div className="today-next-text">
            <button
              className="today-next-title"
              dir="auto"
              onClick={() => tasks.open(item)}
            >
              {first.title}
            </button>
            <span className="today-facts">
              {first.planned_now
                ? `${first.minutes} min left of its time`
                : `Suggested: ${first.minutes} min`}
            </span>
            <button
              className="today-disclose"
              aria-expanded={why}
              onClick={() => setWhy(!why)}
            >
              {why ? (
                <ChevronDown aria-hidden="true" />
              ) : (
                <ChevronRight aria-hidden="true" />
              )}
              Why this task
            </button>
            {why && (
              <ul className="today-reasons">
                {first.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="primary" onClick={() => tasks.focus(item)}>
            <Play aria-hidden="true" /> Start focus
          </Button>
        </div>
      ) : (
        next && (
          <p className="muted">
            {next.suggestions.some((s) => excludeIds.has(s.item_id))
              ? "Suggested tasks are already listed."
              : "No suggested task right now."}
          </p>
        )
      )}
      {rest.length > 0 && (
        <ul className="today-also" aria-label="Also worth doing">
          {rest.map((s) => (
            <li key={s.item_id}>
              <button
                dir="auto"
                onClick={() => tasks.open(byId.get(s.item_id)!)}
              >
                <span>{s.title}</span>
                <small>{s.reasons[0]}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TaskSection({
  id,
  title,
  hint,
  items,
  tone,
  action,
}: {
  id: string;
  title: string;
  hint?: string;
  items: Item[];
  tone?: "warn";
  action?: ReactNode;
}) {
  const { canWrite } = usePlanning();
  if (!items.length) return null;
  return (
    <section
      className={`today-section${tone ? ` is-${tone}` : ""}`}
      aria-labelledby={id}
    >
      <header className="today-section-head">
        <h2 id={id}>
          {title} <span className="today-count">{items.length}</span>
          {hint && <span className="today-head-note">{hint}</span>}
        </h2>
        {action}
      </header>
      <div className="st-rows">
        {items.map((item) => (
          <TaskRow key={item.id} item={item} readOnly={!canWrite(item)} />
        ))}
      </div>
    </section>
  );
}

export function ComingUp({ items }: { items: Item[] }) {
  return (
    <section className="today-section" aria-labelledby="today-coming">
      <header className="today-section-head">
        <h2 id="today-coming">
          Coming up{" "}
          {items.length > 0 && (
            <span className="today-count">{items.length}</span>
          )}
        </h2>
        <Button variant="ghost" onClick={() => navigate("/app/calendar")}>
          Calendar
        </Button>
      </header>
      {items.length ? (
        <ul className="today-coming">
          {items.slice(0, 5).map((item) => {
            const at = new Date(item.due_at!);
            const progress = progressOf(item);
            return (
              <li key={item.id}>
                <button onClick={() => tasks.open(item)}>
                  <span className="today-date" aria-hidden="true">
                    <small>
                      {at.toLocaleDateString([], { month: "short" })}
                    </small>
                    {at.getDate()}
                  </span>
                  <span className="today-coming-main">
                    <span className="today-coming-title" dir="auto">
                      {item.title}
                    </span>
                    <span className="today-facts">
                      {dateLabel(item.due_at)} ·{" "}
                      {item.kind === "event" ? "Event" : "Task"}
                      {item.status === "blocked" && " · Blocked"}
                      {item.status === "in_progress" && " · In progress"}
                    </span>
                    {item.kind === "task" &&
                      ((progress > 0 && progress < 100) ||
                        !!item.steps_total) && (
                        <span
                          className="today-meter"
                          role="img"
                          aria-label={`Progress on ${item.title}: ${Math.round(progress)}%`}
                        >
                          <i style={{ width: `${progress}%` }} />
                        </span>
                      )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No upcoming tasks or events.</p>
      )}
    </section>
  );
}

/** Ready-to-review ideas, beside the plan. Quiet when there are none. */
export function Ideas() {
  const shown = useResource(async () => {
    const [ideas, settings] = await Promise.all([
      client.assistantIdeas(),
      client.agentSettings().catch(() => null),
    ]);
    return {
      name: settings?.name || "Orbyn",
      ideas: ideas
        .filter((i: AssistantIdea) => i.status === "pending" && i.proposal_id)
        .slice(0, 3),
    };
  }, []);
  const data = shown.data;
  if (!data?.ideas.length) return null;
  return (
    <section className="today-section" aria-labelledby="today-ideas">
      <header className="today-section-head">
        <h2 id="today-ideas">
          Suggested for today{" "}
          <span className="today-head-note">Ideas from {data.name}</span>
        </h2>
        <Button variant="ghost" onClick={() => navigate("/app/review")}>
          View all
        </Button>
      </header>
      <ul className="today-ideas">
        {data.ideas.map((idea) => {
          const detail = idea.summary.trim();
          return (
            <li key={idea.id}>
              <div>
                <span dir="auto">{idea.title}</span>
                {detail && detail !== idea.title.trim() && (
                  <details>
                    <summary>Details</summary>
                    <p dir="auto">{detail}</p>
                  </details>
                )}
              </div>
              <Button variant="ghost" onClick={() => navigate("/app/review")}>
                Review
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

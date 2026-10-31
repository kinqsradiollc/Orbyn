import type { HomeSummary } from "@orbyn/core";
import { useRef, useState, type ReactNode } from "react";
import { messageOf } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Input, useToast } from "../../ui/kit";

const goalDay = (day: string) =>
  new Date(`${day.slice(0, 10)}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

function Panel({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="today-panel" aria-labelledby={id}>
      <header className="today-section-head">
        <h2 id={id}>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Goals and routines live with the assistant's upcoming work. */
const upcoming = () => navigate("/app/assistant?panel=upcoming");

export function Goals({ data }: { data: HomeSummary }) {
  return (
    <Panel
      id="today-goals"
      title="Goals"
      action={
        <Button variant="ghost" onClick={upcoming}>
          Upcoming
        </Button>
      }
    >
      {data.goals.length ? (
        <ul className="today-panel-rows">
          {data.goals.map((goal) => (
            <li key={goal.id}>
              <button onClick={upcoming}>
                <span dir="auto">{goal.title}</span>
                {goal.progress !== null && (
                  <span
                    className="today-meter"
                    role="img"
                    aria-label={`Progress on ${goal.title}: ${Math.round(goal.progress * 100)}%`}
                  >
                    <i style={{ width: `${goal.progress * 100}%` }} />
                  </span>
                )}
                <small>
                  {goal.next_checkin
                    ? `Check-in ${goalDay(goal.next_checkin)}`
                    : "Paused"}
                  {goal.progress_label ? ` · ${goal.progress_label}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No active goals yet.</p>
      )}
    </Panel>
  );
}

export function Routines({ data }: { data: HomeSummary }) {
  return (
    <Panel
      id="today-routines"
      title="Routines"
      action={
        <Button variant="ghost" onClick={upcoming}>
          Upcoming
        </Button>
      }
    >
      {data.routines.length ? (
        <ul className="today-panel-rows">
          {data.routines.map((routine) => (
            <li key={routine.id}>
              <button onClick={upcoming}>
                <span dir="auto">{routine.name}</span>
                <small>
                  {new Date(routine.next_run_at).toLocaleString([], {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: routine.timezone,
                  })}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No routines scheduled.</p>
      )}
    </Panel>
  );
}

export function Reflection({
  data,
  onAdded,
}: {
  data: HomeSummary;
  onAdded: (lines: string[], docId: string) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const add = async () => {
    const line = text.trim();
    if (!line || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await client.addReflection(line);
      setText("");
      onAdded(saved.reflection, saved.doc_id);
      toast({
        text: "Added to today's agenda",
        action: {
          label: "Open",
          run: () => navigate(`/app/doc/${saved.doc_id}`),
        },
      });
    } catch (failure) {
      setError(messageOf(failure, "Couldn't add that."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Panel id="today-reflection" title="Reflection">
      {data.brief && (
        <button
          className="today-brief"
          onClick={() => navigate(`/app/doc/${data.brief!.doc_id}`)}
        >
          <span>Today's brief</span>
          <small dir="auto">{data.brief.title}</small>
          {data.brief.overnight && (
            <small dir="auto">{data.brief.overnight}</small>
          )}
        </button>
      )}
      {data.brief?.overnight && (
        <Button variant="ghost" onClick={() => navigate("/app/overnight")}>
          Review Overnight
        </Button>
      )}
      <form
        className="today-reflect"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input
          aria-label="How did today go?"
          placeholder="How did today go?"
          disabled={busy}
          maxLength={500}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" busy={busy} disabled={!text.trim()}>
          Add
        </Button>
      </form>
      {error && <ErrorNotice message={error} onRetry={() => void add()} />}
      {data.reflection.length > 0 && (
        <ul className="today-lines">
          {data.reflection.slice(-3).map((line, n) => (
            <li key={n} dir="auto">
              {line}
            </li>
          ))}
        </ul>
      )}
      {data.agenda_doc_id && (
        <Button
          variant="ghost"
          onClick={() => navigate(`/app/doc/${data.agenda_doc_id}`)}
        >
          Today's agenda
        </Button>
      )}
    </Panel>
  );
}

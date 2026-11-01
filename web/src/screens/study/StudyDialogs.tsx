import type {
  DocSummary,
  RevisionPlan,
  StudyExam,
  StudyOverview,
} from "@orbyn/core";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Input,
  Loading,
  Pill,
} from "../../ui/kit";
import { deviceTimeZone } from "../shared-task";
import { useStudyOwner } from "./lifetime";

export function PagePicker({
  decks,
  busy,
  onClose,
  onPick,
  onNew,
}: {
  decks: StudyOverview;
  busy: boolean;
  onClose: () => void;
  onPick: (page: DocSummary) => void;
  onNew: () => void;
}) {
  const pages = useResource(() => client.listDocs(), []);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(40);
  const words = query.trim().toLocaleLowerCase();
  const matches = [...(pages.data ?? [])]
    .filter(
      (page) =>
        page.kind !== "agenda" &&
        `${page.title} ${page.preview}`.toLocaleLowerCase().includes(words),
    )
    .sort(
      (a, b) =>
        Number(!!b.imported_from) - Number(!!a.imported_from) ||
        b.updated_at.localeCompare(a.updated_at),
    );
  const shown = matches.slice(0, limit);
  const withCards = new Set(decks.decks.map((deck) => deck.doc_id));
  return (
    <Dialog title="Choose a page" onClose={() => !busy && onClose()}>
      <Input
        autoFocus
        aria-label="Search your pages"
        placeholder="Search your pages"
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setLimit(40);
        }}
      />
      {pages.error && (
        <ErrorNotice
          message={pages.error}
          onRetry={() => void pages.reload()}
        />
      )}
      {pages.loading && !pages.data && <Loading label="Loading your pages" />}
      {pages.data && !shown.length && (
        <p className="small muted">No pages match.</p>
      )}
      <ul className="rows study-page-choices">
        {shown.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              className="row"
              disabled={busy}
              onClick={() => onPick(page)}
            >
              <span className="row-main">
                <span className="row-title" dir="auto">
                  {page.title || "Untitled"}
                </span>
                <span className="small muted study-preview" dir="auto">
                  {page.preview}
                </span>
              </span>
              {page.imported_from && <Pill>Imported</Pill>}
              {withCards.has(page.id) && <Pill>Has cards</Pill>}
            </button>
          </li>
        ))}
      </ul>
      {matches.length > limit && (
        <Button onClick={() => setLimit((count) => count + 40)}>
          Show more pages
        </Button>
      )}
      <details className="study-manual">
        <summary>Write cards by hand</summary>
        <p className="small muted">
          <code>Question :: Answer</code> makes a card.
        </p>
        <Button disabled={busy} onClick={onNew}>
          <Plus /> New study page
        </Button>
      </details>
    </Dialog>
  );
}

export function ExamPages({
  exam,
  onClose,
  onSaved,
}: {
  exam: StudyExam;
  onClose: () => void;
  onSaved: (next: StudyOverview) => void;
}) {
  const pages = useResource(() => client.listDocs(), []);
  const [chosen, setChosen] = useState(new Set(exam.doc_ids));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useStudyOwner();
  const action = useRef(false);
  const save = async () => {
    if (action.current || !current()) return;
    action.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.setExamDecks({
        key: exam.key,
        title: exam.title,
        starts_at: exam.starts_at,
        doc_ids: [...chosen],
      });
      if (current()) onSaved(next);
    } catch (failure) {
      if (current()) setError(messageOf(failure, "Couldn't save these pages."));
    } finally {
      action.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <Dialog
      title="Pages to revise"
      onClose={() => !busy && onClose()}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <p className="small muted" dir="auto">
        {exam.title}
      </p>
      {(error || pages.error) && (
        <ErrorNotice
          message={error || pages.error}
          onRetry={pages.error ? () => void pages.reload() : undefined}
        />
      )}
      {pages.loading && !pages.data && <Loading label="Loading your pages" />}
      {pages.data && !pages.data.some((page) => page.kind !== "agenda") && (
        <p className="small muted">
          No pages yet. Create a study page to add cards.
        </p>
      )}
      {pages.data
        ?.filter((page) => page.kind !== "agenda")
        .map((page) => (
          <label key={page.id} className="check small">
            <input
              type="checkbox"
              disabled={busy}
              checked={chosen.has(page.id)}
              onChange={(event) => {
                const on = event.currentTarget.checked;
                setChosen((was) => {
                  const next = new Set(was);
                  if (on) next.add(page.id);
                  else next.delete(page.id);
                  return next;
                });
              }}
            />
            <span className="study-page-title" dir="auto">
              {page.title || "Untitled"}
            </span>
          </label>
        ))}
    </Dialog>
  );
}

export function PlanDialog({
  exam,
  onClose,
}: {
  exam: StudyExam;
  onClose: (planned: boolean) => void;
}) {
  const [minutes, setMinutes] = useState(45);
  const [plan, setPlan] = useState<RevisionPlan | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [off, setOff] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const current = useStudyOwner();
  const action = useRef(false);
  const [plannedMinutes, setPlannedMinutes] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setPlan(null);
    setPlannedMinutes(null);
    setError("");
    setOff(new Set());
    client
      .planRevision({ key: exam.key, minutes, timezone: deviceTimeZone() })
      .then(
        (next) => {
          if (live && current()) {
            setPlan(next);
            setPlannedMinutes(minutes);
          }
        },
        (failure) =>
          live &&
          current() &&
          setError(messageOf(failure, "Couldn't plan revision.")),
      );
    return () => {
      live = false;
    };
  }, [exam.key, minutes, attempt, current]);
  const chosen = (
    plannedMinutes === minutes ? (plan?.sessions ?? []) : []
  ).filter((one) => !off.has(one.start_at));
  const apply = async () => {
    if (action.current || !current() || !chosen.length) return;
    action.current = true;
    setBusy(true);
    setError("");
    try {
      await client.applyRevision({ key: exam.key, sessions: chosen });
      if (current()) onClose(true);
    } catch (failure) {
      if (current())
        setError(messageOf(failure, "Couldn't add these sessions."));
    } finally {
      action.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Plan revision for ${exam.title}`}
      onClose={() => !busy && onClose(false)}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onClose(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!chosen.length}
            onClick={() => void apply()}
          >
            Add {chosen.length} session{chosen.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <label className="field">
        Session length
        <select
          className="input"
          disabled={busy}
          value={minutes}
          onChange={(event) => setMinutes(Number(event.currentTarget.value))}
        >
          {[25, 45, 60, 90].map((value) => (
            <option key={value} value={value}>
              {value} minutes
            </option>
          ))}
        </select>
      </label>
      {error && (
        <ErrorNotice
          message={error}
          onRetry={plan ? undefined : () => setAttempt((n) => n + 1)}
        />
      )}
      {!plan && !error && <Loading label="Finding free time" />}
      {plan && !plan.sessions.length && (
        <p className="small muted">No free time found before this exam.</p>
      )}
      {plan?.sessions.map((one) => {
        const start = new Date(one.start_at);
        return (
          <label key={one.start_at} className="check small">
            <input
              type="checkbox"
              disabled={busy}
              checked={!off.has(one.start_at)}
              onChange={(event) => {
                const on = event.currentTarget.checked;
                setOff((was) => {
                  const next = new Set(was);
                  if (on) next.delete(one.start_at);
                  else next.add(one.start_at);
                  return next;
                });
              }}
            />
            {start.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
            ,{" "}
            {start.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </label>
        );
      })}
    </Dialog>
  );
}

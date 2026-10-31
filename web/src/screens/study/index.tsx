import {
  IMPORT_ACCEPT,
  importRefusal,
  type DocSummary,
  type ImportJob,
  type StudyExam,
  type StudyOverview,
  type RevisionPlan,
} from "@orbyn/core";
import {
  BookOpenCheck,
  CalendarClock,
  FastForward,
  FileText,
  FileUp,
  Flame,
  MoreHorizontal,
  Plus,
  Repeat,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { navigate, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  IconButton,
  Input,
  Loading,
  Menu,
  Pill,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { deviceTimeZone } from "../shared-task";
import { MakeCards } from "./MakeCards";
import { Review, type Session } from "./Review";
import "./study.css";

const EXAMPLE =
  "What does CAP stand for? :: Consistency, availability, partition tolerance";

export default function StudyScreen() {
  useTitle("Study");
  const toast = useToast();
  const confirm = useConfirm();
  const overview = useResource(() => client.study(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const [making, setMaking] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [planning, setPlanning] = useState<StudyExam | null>(null);
  const [attaching, setAttaching] = useState<StudyExam | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("due");
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshJobs = () => client.listImports().then(setJobs, () => {});
  useEffect(() => {
    void refreshJobs();
  }, []);

  const report = (failure: unknown, fallback: string) =>
    toast({ text: messageOf(failure, fallback), error: true });
  const run = async (work: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      report(failure, fallback);
    } finally {
      setBusy(false);
    }
  };
  const importFiles = async (files: File[]) => {
    setUploading(true);
    try {
      for (const file of files) {
        const refused = importRefusal(file.name, file.type);
        if (refused) {
          toast({ text: refused, error: true });
          continue;
        }
        const { upload_path, import: started } = await client.createImport({
          file_name: file.name,
          bytes: file.size,
          mime: file.type || undefined,
        });
        try {
          await client.uploadImportFile(upload_path, file, file.type);
        } catch (failure) {
          await client.removeImport(started.id).catch(() => {});
          throw failure;
        }
      }
      toast({ text: "Imported. Your page will be ready in a moment." });
      void refreshJobs();
    } catch (failure) {
      report(failure, "Couldn't import this file.");
    } finally {
      setUploading(false);
    }
  };
  const newPage = () =>
    run(async () => {
      const doc = await client.createDoc({
        title: "Study notes",
        kind: "note",
        content: [
          {
            type: "paragraph",
            text: "Write notes as usual. Any line written as Question :: Answer becomes a card.",
          },
          { type: "heading", level: 2, text: "Cards" },
          { type: "bullet", text: EXAMPLE },
        ],
      });
      navigate(`/app/doc/${doc.id}`);
    }, "Couldn't create the page.");
  const makeHabit = () =>
    run(async () => {
      const ok = await confirm({
        title: "Make a daily review a habit?",
        body: "Orbyn sets aside 15 minutes a day for reviewing cards and keeps your streak.",
        action: "Add the habit",
      });
      if (!ok) return;
      await client.createHabit({
        name: "Review cards",
        cadence: 1,
        period: "day",
        duration_minutes: 15,
      });
      setNote("Review habit added.");
    }, "Couldn't add the habit.");

  const data = overview.data;
  const decks = useMemo(() => {
    if (!data) return [];
    const words = query.trim().toLowerCase();
    return [...data.decks]
      .filter((deck) => !words || deck.title.toLowerCase().includes(words))
      .sort((a, b) =>
        sort === "title"
          ? a.title.localeCompare(b.title)
          : sort === "known"
            ? a.known / Math.max(1, a.cards) - b.known / Math.max(1, b.cards)
            : b.due + b.new - (a.due + a.new) ||
              (a.next_due_at ?? "9").localeCompare(b.next_due_at ?? "9"),
      );
  }, [data, query, sort]);

  if (session)
    return (
      <Review
        session={session}
        onDone={(reviewed) => {
          setSession(null);
          setNote(
            reviewed
              ? `Reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}.`
              : "",
          );
          void overview.reload();
        }}
      />
    );
  if (!data)
    return (
      <div className="page study">
        <h1>Study</h1>
        {overview.error ? (
          <ErrorNotice
            message={overview.error}
            onRetry={() => void overview.reload()}
          />
        ) : (
          <Loading label="Loading cards" />
        )}
      </div>
    );

  const toReview = data.due_today + data.new_cards;
  const totalCards = data.decks.reduce((sum, deck) => sum + deck.cards, 0);
  const minutes = Math.max(1, Math.round((toReview * 8) / 60));
  const forecast = data.forecast ?? [];
  const peak = Math.max(1, ...forecast.map((day) => day.due));
  const readyImports = jobs
    .filter(
      (job) =>
        job.status === "ready" &&
        job.doc_id &&
        !data.decks.some((deck) => deck.doc_id === job.doc_id) &&
        Date.now() - Date.parse(job.finished_at ?? job.created_at) <
          3 * 86_400_000,
    )
    .slice(0, 3);

  return (
    <div className="page study">
      <div className="page-head">
        <h1>Study</h1>
        <div className="study-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void makeHabit()}
          >
            <Repeat /> Make it a daily habit
          </Button>
        </div>
      </div>
      {overview.error && (
        <ErrorNotice
          message={overview.error}
          onRetry={() => void overview.reload()}
        />
      )}
      <section className="study-today" aria-label="Today">
        <div className="study-today-main">
          <h2>
            {toReview
              ? `${toReview} card${toReview === 1 ? "" : "s"} to review`
              : "No cards due"}
          </h2>
          <p className="small muted">
            {toReview
              ? `${data.due_today} due · ${data.new_cards} new · about ${minutes} min`
              : totalCards
                ? "Study ahead or start a quiz."
                : "Add cards from a page."}
          </p>
          <div className="study-actions">
            {toReview ? (
              <Button
                variant="primary"
                onClick={() =>
                  setSession({ title: "All your cards", quiz: false })
                }
              >
                <BookOpenCheck /> Start review
              </Button>
            ) : totalCards ? (
              <>
                <Button
                  variant="primary"
                  onClick={() =>
                    setSession({
                      title: "Study ahead",
                      quiz: false,
                      ahead: true,
                    })
                  }
                >
                  <FastForward /> Study ahead
                </Button>
                <Button
                  onClick={() =>
                    setSession({
                      title: "All your cards",
                      quiz: true,
                      ahead: true,
                    })
                  }
                >
                  <Sparkles /> Quiz me
                </Button>
              </>
            ) : null}
            {toReview > 0 && (
              <Button
                onClick={() =>
                  setSession({ title: "All your cards", quiz: true })
                }
              >
                <Sparkles /> Quiz me
              </Button>
            )}
          </div>
          {note && (
            <p className="small study-note" role="status">
              {note}
            </p>
          )}
        </div>
        <dl className="study-stats">
          <div>
            <dt className="small muted">Reviewed today</dt>
            <dd>{data.reviewed_today}</dd>
          </div>
          <div>
            <dt className="small muted">Day streak</dt>
            <dd>
              <Flame aria-hidden="true" /> {data.streak}
            </dd>
          </div>
        </dl>
        {totalCards > 0 && forecast.length > 0 && (
          <div
            className="study-forecast"
            role="img"
            aria-label={`Reviews due over the next 7 days: ${forecast.map((day) => day.due).join(", ")}`}
          >
            {forecast.map((day, index) => (
              <span key={day.date} title={`${day.due} due`}>
                <i
                  style={{ height: `${Math.max(6, (day.due / peak) * 100)}%` }}
                />
                <small>
                  {index === 0
                    ? "Today"
                    : new Date(`${day.date}T12:00:00`).toLocaleDateString(
                        undefined,
                        { weekday: "narrow" },
                      )}
                </small>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="study-sources" aria-label="Add cards">
        <button
          type="button"
          className="study-source"
          onClick={() => setPicking(true)}
        >
          <FileText aria-hidden="true" />
          <span>
            <strong>From your pages</strong>
            <span className="small muted">
              Suggest cards from something you've written
            </span>
          </span>
        </button>
        <button
          type="button"
          className="study-source"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          <FileUp aria-hidden="true" />
          <span>
            <strong>{uploading ? "Uploading…" : "Import material"}</strong>
            <span className="small muted">
              A PDF, Word file or photo of notes
            </span>
          </span>
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          aria-label="Choose material to import"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            if (files.length) void importFiles(files);
          }}
        />
      </section>
      <details className="study-manual">
        <summary>Write cards manually</summary>
        <p className="small muted">
          A line written as <code>Question :: Answer</code> in a page becomes a
          card. <code>{"{{words}}"}</code> makes a cloze.
        </p>
        <Button disabled={busy} onClick={() => void newPage()}>
          <Plus /> New study page
        </Button>
      </details>

      {readyImports.length > 0 && (
        <section>
          <h2>From your uploads</h2>
          <ul className="rows">
            {readyImports.map((job) => (
              <li key={job.id} className="row">
                <span className="row-main">
                  <span className="row-title" dir="auto">
                    {job.file_name}
                  </span>
                </span>
                <Button
                  onClick={() =>
                    setMaking({ id: job.doc_id!, title: job.file_name })
                  }
                >
                  <Sparkles /> Make cards
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.exams.length > 0 && (
        <section>
          <h2>Exams coming up</h2>
          <ul className="study-exams">
            {data.exams.map((exam) => {
              const date = new Date(exam.starts_at);
              const ready =
                exam.readiness === null
                  ? null
                  : Math.round(exam.readiness * 100);
              return (
                <li key={exam.key} className="study-exam">
                  <time className="study-date" dateTime={exam.starts_at}>
                    <b>{date.getDate()}</b>
                    <span className="small">
                      {date.toLocaleString(undefined, { month: "short" })}
                    </span>
                  </time>
                  <div className="row-main">
                    <div className="row-title" dir="auto">
                      {exam.title}
                    </div>
                    <div className="small muted">
                      {exam.days_left === 0
                        ? "Today"
                        : `${exam.days_left} days left`}
                      {ready !== null
                        ? ` · ${ready}% known well`
                        : " · Choose pages to revise"}
                      {exam.target ? ` · ${exam.target}` : ""}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => setAttaching(exam)}>
                    Pages
                  </Button>
                  <Button
                    disabled={!exam.doc_ids.length}
                    onClick={() => setPlanning(exam)}
                  >
                    <CalendarClock /> Plan revision
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.decks.length > 0 && (
        <section>
          <div className="study-section-head">
            <h2>
              Pages with cards{" "}
              <span className="small muted">{data.decks.length}</span>
            </h2>
            {data.decks.length >= 8 && (
              <Input
                aria-label="Search pages with cards"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            )}
            <select
              className="input study-select"
              aria-label="Sort pages"
              value={sort}
              onChange={(event) => setSort(event.currentTarget.value)}
            >
              <option value="due">Due first</option>
              <option value="known">Least known first</option>
              <option value="title">Title A to Z</option>
            </select>
          </div>
          <ul className="rows">
            {decks.map((deck) => {
              const known = Math.round(
                (deck.known / Math.max(1, deck.cards)) * 100,
              );
              const waiting = deck.due + deck.new;
              return (
                <li key={deck.doc_id} className="row study-deck">
                  <div className="row-main">
                    <div className="row-title" dir="auto">
                      {deck.title}
                    </div>
                    <div className="small muted">
                      {deck.cards} cards · {known}% known well
                      {deck.imported_from ? ` · ${deck.imported_from}` : ""}
                    </div>
                  </div>
                  {waiting > 0 ? (
                    <Button
                      onClick={() =>
                        setSession({
                          docId: deck.doc_id,
                          title: deck.title,
                          quiz: false,
                        })
                      }
                    >
                      Review {waiting}
                    </Button>
                  ) : (
                    <Pill>Done for now</Pill>
                  )}
                  <Menu
                    label={`More for ${deck.title}`}
                    trigger={(show, expanded) => (
                      <IconButton
                        label={`More for ${deck.title}`}
                        aria-expanded={expanded}
                        onClick={show}
                      >
                        <MoreHorizontal />
                      </IconButton>
                    )}
                  >
                    {(close) => (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            setMaking({ id: deck.doc_id, title: deck.title });
                          }}
                        >
                          Suggest more cards
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            setSession({
                              docId: deck.doc_id,
                              title: deck.title,
                              quiz: true,
                              ahead: true,
                            });
                          }}
                        >
                          Quiz me
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            setSession({
                              docId: deck.doc_id,
                              title: deck.title,
                              quiz: false,
                              ahead: true,
                            });
                          }}
                        >
                          Study ahead
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            navigate(`/app/doc/${deck.doc_id}`);
                          }}
                        >
                          Open the page
                        </button>
                      </>
                    )}
                  </Menu>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {data.decks.length === 0 && data.exams.length === 0 && (
        <Empty title="No cards yet">
          <p className="small">Start from a page or import material above.</p>
        </Empty>
      )}

      {data.weak.length > 0 && (
        <section>
          <h2>Needs practice</h2>
          <ul className="rows">
            {data.weak.map((card) => (
              <li key={card.id} className="row">
                <div className="row-main">
                  <div className="row-title" dir="auto">
                    {card.question}
                  </div>
                  <div className="small muted" dir="auto">
                    {card.doc_title} · missed {card.misses} times
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    navigate(
                      `/app/doc/${card.source?.doc_id ?? card.doc_id}${card.source?.block_id ? `#${card.source.block_id}` : ""}`,
                    )
                  }
                >
                  Re-read
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {picking && (
        <PagePicker
          decks={data}
          onClose={() => setPicking(false)}
          onPick={(page) => {
            setPicking(false);
            setMaking({ id: page.id, title: page.title || "Untitled" });
          }}
          onNew={() => void newPage()}
        />
      )}
      {making && (
        <MakeCards
          docId={making.id}
          title={making.title}
          onClose={(added) => {
            setMaking(null);
            if (added) void overview.reload();
          }}
        />
      )}
      {attaching && (
        <ExamPages
          exam={attaching}
          onClose={() => setAttaching(null)}
          onSaved={(next) => {
            overview.set(() => next);
            setAttaching(null);
          }}
        />
      )}
      {planning && (
        <PlanDialog
          exam={planning}
          onClose={(planned) => {
            setPlanning(null);
            if (planned)
              setNote(
                `Revision planned for ${planning.title}. The sessions are on your calendar.`,
              );
          }}
        />
      )}
    </div>
  );
}

function PagePicker({
  decks,
  onClose,
  onPick,
  onNew,
}: {
  decks: StudyOverview;
  onClose: () => void;
  onPick: (page: DocSummary) => void;
  onNew: () => void;
}) {
  const pages = useResource(() => client.listDocs(), []);
  const [query, setQuery] = useState("");
  const words = query.trim().toLocaleLowerCase();
  const shown = (pages.data ?? [])
    .filter(
      (page) =>
        page.kind !== "agenda" &&
        `${page.title} ${page.preview}`.toLocaleLowerCase().includes(words),
    )
    .slice(0, 40);
  const withCards = new Set(decks.decks.map((deck) => deck.doc_id));
  return (
    <Dialog title="Choose a page" onClose={onClose}>
      <Input
        autoFocus
        aria-label="Search your pages"
        placeholder="Search your pages"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
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
      <ul className="rows">
        {shown.map((page) => (
          <li key={page.id}>
            <button type="button" className="row" onClick={() => onPick(page)}>
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
      <details className="study-manual">
        <summary>Write cards by hand</summary>
        <p className="small muted">
          <code>Question :: Answer</code> makes a card.
        </p>
        <Button onClick={onNew}>
          <Plus /> New study page
        </Button>
      </details>
    </Dialog>
  );
}

function ExamPages({
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
  return (
    <Dialog
      title="Pages to revise"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              client
                .setExamDecks({
                  key: exam.key,
                  title: exam.title,
                  starts_at: exam.starts_at,
                  doc_ids: [...chosen],
                })
                .then(onSaved, (failure) => {
                  setError(messageOf(failure, "Couldn't save these pages."));
                  setBusy(false);
                });
            }}
          >
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
      {pages.data
        ?.filter((page) => page.kind !== "agenda")
        .map((page) => (
          <label key={page.id} className="check small">
            <input
              type="checkbox"
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
            <span dir="auto">{page.title || "Untitled"}</span>
          </label>
        ))}
    </Dialog>
  );
}

function PlanDialog({
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
  useEffect(() => {
    let live = true;
    setPlan(null);
    setError("");
    setOff(new Set());
    client
      .planRevision({ key: exam.key, minutes, timezone: deviceTimeZone() })
      .then(
        (next) => live && setPlan(next),
        (failure) =>
          live && setError(messageOf(failure, "Couldn't plan revision.")),
      );
    return () => {
      live = false;
    };
  }, [exam.key, minutes, attempt]);
  const chosen = (plan?.sessions ?? []).filter((one) => !off.has(one.start_at));
  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      await client.applyRevision({ key: exam.key, sessions: chosen });
      onClose(true);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't add these sessions."));
      setBusy(false);
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

import {
  IMPORT_ACCEPT,
  IMPORT_ACTIVE,
  importHint,
  importStatusLine,
  type StudyExam,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "../../app/account";
import { messageOf, useResource } from "../../lib/resource";
import { useBeforeNavigate, useNavigate, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
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
import { UploadsProvider, useUploads } from "../library/Uploads";
import { useStudyOwner } from "./lifetime";
import { MakeCards } from "./MakeCards";
import { Review, type Session } from "./Review";
import { ExamPages, PagePicker, PlanDialog } from "./StudyDialogs";
import "./study.css";

const EXAMPLE =
  "What does CAP stand for? :: Consistency, availability, partition tolerance";

export default function StudyScreen() {
  const { token } = useAccount();
  return (
    <UploadsProvider key={token}>
      <StudyBody />
    </UploadsProvider>
  );
}

function StudyBody() {
  const navigate = useNavigate();
  useTitle("Study");
  const toast = useToast();
  const confirm = useConfirm();
  const current = useStudyOwner();
  const action = useRef(false);
  const uploads = useUploads();
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
  const { jobs, busy: uploading } = uploads;
  const fileInput = useRef<HTMLInputElement>(null);
  const handoff = useRef<string | null>(null),
    exitState = useRef({ busy, uploading });
  exitState.current = { busy, uploading };
  const prepareLeave = useCallback(
    (to: string) =>
      handoff.current === to ||
      (!action.current &&
        !exitState.current.busy &&
        !exitState.current.uploading),
    [],
  );
  useBeforeNavigate(prepareLeave);
  const followReceipt = async (to: string) => {
    handoff.current = to;
    try {
      const result = await navigate(to);
      if (result.kind === "refused")
        throw new Error(`Saved, but ${result.reason}`);
    } finally {
      if (handoff.current === to) handoff.current = null;
    }
  };

  const ready = useRef(new Set<string>());
  useEffect(() => {
    const added = jobs.some(
      (job) => job.status === "ready" && !ready.current.has(job.id),
    );
    for (const job of jobs)
      if (job.status === "ready") ready.current.add(job.id);
    if (added) void overview.reload();
  }, [jobs, overview.reload]);

  const report = (failure: unknown, fallback: string) =>
    toast({ text: messageOf(failure, fallback), error: true });
  const run = async (work: () => Promise<void>, fallback: string) => {
    if (action.current || !current()) return;
    action.current = true;
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      if (current()) report(failure, fallback);
    } finally {
      action.current = false;
      if (current()) setBusy(false);
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
      if (current()) await followReceipt(`/app/doc/${doc.id}`);
    }, "Couldn't create the page.");
  const makeHabit = () =>
    run(async () => {
      const ok = await confirm({
        title: "Make a daily review a habit?",
        body: "Orbyn sets aside 15 minutes a day for reviewing cards and keeps your streak.",
        action: "Add the habit",
      });
      if (!ok || !current()) return;
      await client.createHabit({
        name: "Review cards",
        cadence: 1,
        period: "day",
        duration_minutes: 15,
      });
      if (current()) setNote("Review habit added.");
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
            if (files.length) void uploads.importFiles(files);
          }}
        />
      </section>
      <ImportProgress onRetry={() => fileInput.current?.click()} />
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
                      <time dateTime={exam.starts_at}>
                        {date.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                        {!exam.all_day
                          ? `, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                          : ""}
                      </time>
                      {" · "}
                      {exam.days_left === 0
                        ? "Today"
                        : `${exam.days_left} days left`}
                      {ready !== null
                        ? ` · ${ready}% known well`
                        : " · Choose pages to revise"}
                      {exam.projected !== null && exam.projected !== undefined
                        ? ` · ${Math.round(exam.projected * 100)}% by the exam if you keep up`
                        : ""}
                      {exam.source !== "yours" ? ` · ${exam.source}` : ""}
                      {exam.target ? ` · ${exam.target}` : ""}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => setAttaching(exam)}>
                    Pages
                  </Button>
                  {exam.doc_ids.length > 0 && (
                    <Button
                      onClick={() =>
                        setSession({
                          title: exam.title,
                          docId:
                            exam.doc_ids.length === 1
                              ? exam.doc_ids[0]
                              : undefined,
                          quiz: false,
                          ahead: true,
                        })
                      }
                    >
                      Revise now
                    </Button>
                  )}
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
              const exam = data.exams.find((one) =>
                one.doc_ids.includes(deck.doc_id),
              );
              return (
                <li key={deck.doc_id} className="row study-deck">
                  <div className="row-main">
                    <div className="row-title" dir="auto">
                      {deck.title}
                    </div>
                    <div className="small muted">
                      {deck.cards} cards · {known}% known well
                      {deck.due > 0 ? ` · ${deck.due} due` : ""}
                      {deck.new > 0 ? ` · ${deck.new} new` : ""}
                      {!deck.due && deck.next_due_at
                        ? ` · next review ${new Date(deck.next_due_at).toLocaleDateString()}`
                        : ""}
                      {exam ? ` · ${exam.title}` : ""}
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
          busy={busy}
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
          key={making.id}
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
          key={attaching.key}
          exam={attaching}
          onClose={() => setAttaching(null)}
          onSaved={(next) => {
            overview.set(() => next);
            void overview.reload();
            setAttaching(null);
          }}
        />
      )}
      {planning && (
        <PlanDialog
          key={planning.key}
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

function ImportProgress({ onRetry }: { onRetry: () => void }) {
  const uploads = useUploads();
  const pending = uploads.jobs.filter((job) => job.status !== "ready");
  return (
    <section className="study-imports" aria-label="Imported material">
      <p className="small muted">{importHint(uploads.caps)}</p>
      {uploads.error && (
        <ErrorNotice
          message={uploads.error}
          onRetry={() => void uploads.refresh()}
        />
      )}
      {pending.length > 0 && (
        <ul className="rows">
          {pending.map((job) => (
            <li className="row" key={job.id}>
              <span className="row-main">
                <strong className="row-title" dir="auto">
                  {job.file_name}
                </strong>
                <span className="study-preview small muted">
                  {job.status === "failed"
                    ? job.error || "This file couldn't be read."
                    : importStatusLine(job)}
                </span>
                {IMPORT_ACTIVE.includes(job.status) && (
                  <progress aria-label={`Importing ${job.file_name}`} />
                )}
              </span>
              {job.status === "failed" && (
                <Button disabled={uploads.busy} onClick={onRetry}>
                  Try another file
                </Button>
              )}
              <Button variant="ghost" onClick={() => void uploads.remove(job)}>
                {IMPORT_ACTIVE.includes(job.status)
                  ? "Cancel import"
                  : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

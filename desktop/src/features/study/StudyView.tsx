import { useElementWidth } from "../../hooks/useElementWidth";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  BookOpenCheck,
  CalendarClock,
  Check,
  FastForward,
  FileText,
  Flame,
  HelpCircle,
  MoreHorizontal,
  Lightbulb,
  Plus,
  Repeat,
  Sparkles,
  X,
} from "lucide-react";
import {
  withCards,
  docContainerBlocks,
  type Doc,
  type DocSummary,
  type RevisionPlan,
  type StudyExam,
  type StudyOverview,
  aiFeatureProviderLabel,
  type SuggestedCard,
  type DocBlock,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { deviceTimeZone } from "../planner/planning";
import { useConfirm } from "../../components/Confirm";
import { Select } from "../../components/Select";
import { ReviewSession } from "./ReviewSession";
import { ImportButton, useImports } from "../documents/library/Uploads";
import "./study.css";
import { errorText } from "../../lib/errors";
import { EmptyState } from "../../components/EmptyState";
import { CONCEPT_ICON } from "../../app/concept-icons";
import { Popover } from "../../components/Popover";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { useModalFocus } from "../../hooks/useModalFocus";
import { session as authSession } from "../../lib/session";

function useStudyOwner() {
  const owner = useRef(authSession.get()).current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && authSession.get() === owner,
    [owner],
  );
}

type Props = {
  report: (e: unknown) => void;
  /** Open a page in Docs. */
  onOpenPage: (doc: Doc) => void;
  /** The calendar and tasks changed (a revision plan was applied). */
  onPlanned: () => void;
};

type Session = {
  docId?: string;
  title: string;
  quiz: boolean;
  ahead?: boolean;
};

const when = (iso: string, allDay: boolean) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
  });

/** "today", "tomorrow", "in 3 days" for a coming date. */
const relDay = (iso: string) => {
  const days = Math.round(
    (new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86_400_000,
  );
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
};

const EXAMPLE = `What does CAP stand for? :: Consistency, availability, partition tolerance`;

/**
 * Study: cards written in your own pages as "Question :: Answer" lines,
 * reviewed when they're due, with the assistant suggesting cards, checking
 * answers and explaining — and revision planned around your exams. Every
 * change the assistant or the planner suggests waits for your approval.
 */
export function StudyView(props: Props) {
  return <StudyBody key={authSession.get()} {...props} />;
}

function StudyBody({ report, onOpenPage, onPlanned }: Props) {
  const currentOwner = useStudyOwner();
  const action = useAction(report);
  const read = useRef(0);
  const [readFailed, setReadFailed] = useState(false);
  const { ref: pageRef, width: pageWidth } = useElementWidth();
  const { ask } = useConfirm();
  const [data, setData] = useState<StudyOverview | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [making, setMaking] = useState<{ docId: string; title: string } | null>(
    null,
  );
  const [planning, setPlanning] = useState<StudyExam | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"due" | "known" | "title">("due");
  // Importing from Study: a finished upload offers "Make cards" right here.
  const imports = useImports(report, () => void load());

  const load = useCallback(async () => {
    if (!currentOwner()) return false;
    const version = ++read.current;
    setReadFailed(false);
    try {
      const next = await client.study();
      if (!currentOwner() || read.current !== version) return false;
      setData(next);
      return true;
    } catch (e) {
      if (currentOwner() && read.current === version) {
        setReadFailed(true);
        report(e);
      }
      return false;
    }
  }, [currentOwner, report]);
  useEffect(() => {
    void load();
  }, [load]);

  const openPage = (docId: string) =>
    action.run(async () => {
      const doc = await client.getDocForEditor(docId);
      if (currentOwner()) onOpenPage(doc);
    });

  const newPage = () =>
    action.run(async () => {
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
      if (currentOwner()) onOpenPage(doc);
    });

  const makeHabit = () =>
    action.run(async () => {
      if (
        !(await ask({
          title: "Make a daily review a habit?",
          body: "Orbyn sets aside 15 minutes a day for reviewing cards and keeps your streak.",
          confirmLabel: "Add the habit",
        }))
      )
        return;
      if (!currentOwner()) return;
      await client.createHabit({
        name: "Review cards",
        cadence: 1,
        period: "day",
        duration_minutes: 15,
      });
      if (currentOwner()) setNote("Review habit added.");
    });

  const attach = (exam: StudyExam, docIds: string[]) =>
    action.run(async () => {
      read.current++;
      const next = await client.setExamDecks({
        key: exam.key,
        title: exam.title,
        starts_at: exam.starts_at,
        doc_ids: docIds,
      });
      if (currentOwner()) {
        read.current++;
        setReadFailed(false);
        setData(next);
      }
    });

  if (session)
    return (
      <ReviewSession
        docId={session.docId}
        title={session.title}
        quiz={session.quiz}
        ahead={session.ahead}
        report={report}
        onOpenPage={openPage}
        onDone={(reviewed) => {
          setSession(null);
          setNote(
            reviewed
              ? `Reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}.`
              : "",
          );
          void load();
        }}
      />
    );

  if (!data)
    return readFailed ? (
      <div role="status">
        <p>Couldn’t load cards.</p>
        <button className="secondary" onClick={() => void load()}>
          Retry
        </button>
      </div>
    ) : (
      <p className="muted" role="status">
        Loading cards…
      </p>
    );

  const toReview = data.due_today + data.new_cards;
  const readyImports = imports.jobs
    .filter(
      (j) =>
        j.status === "ready" &&
        j.doc_id &&
        !data.decks.some((d) => d.doc_id === j.doc_id) &&
        Date.now() - Date.parse(j.finished_at ?? j.created_at) < 3 * 86_400_000,
    )
    .slice(0, 3);

  const minutes = Math.max(1, Math.round((toReview * 8) / 60));
  const totalCards = data.decks.reduce((n, d) => n + d.cards, 0);
  const forecast = data.forecast ?? [];
  const peak = Math.max(1, ...forecast.map((f) => f.due));
  const q = query.trim().toLowerCase();
  const decks = [...data.decks]
    .filter((d) => !q || d.title.toLowerCase().includes(q))
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "known"
          ? a.known / Math.max(1, a.cards) - b.known / Math.max(1, b.cards)
          : b.due + b.new - (a.due + a.new) ||
            (a.next_due_at ?? "9").localeCompare(b.next_due_at ?? "9"),
    );

  return (
    <div
      ref={pageRef}
      className={
        "study" +
        (pageWidth < 760 ? " is-compact" : "") +
        (pageWidth < 640 ? " is-small" : "")
      }
    >
      <OutcomeNote outcome={action.outcome} />
      {readFailed && (
        <div role="status">
          <span>Couldn’t refresh cards. </span>
          <button className="text-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      <section className="card study-hero">
        <div className="study-hero-main">
          <span className="study-eyebrow">Today</span>
          <h2 className="study-hero-count">
            {toReview
              ? `${toReview} card${toReview === 1 ? "" : "s"} to review`
              : "No cards due"}
          </h2>
          <p className="muted">
            {toReview
              ? `${data.due_today} due · ${data.new_cards} new · about ${minutes} min`
              : totalCards
                ? "Study ahead or start a quiz."
                : "Add cards from a page."}
          </p>
          <div className="study-actions">
            {toReview ? (
              <button
                className="primary"
                onClick={() =>
                  setSession({ title: "All your cards", quiz: false })
                }
              >
                <BookOpenCheck size={16} /> Start review
              </button>
            ) : totalCards ? (
              <>
                <button
                  className="primary"
                  title="Review the cards due soonest, ahead of time"
                  onClick={() =>
                    setSession({
                      title: "Study ahead",
                      quiz: false,
                      ahead: true,
                    })
                  }
                >
                  <FastForward size={16} /> Study ahead
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    setSession({
                      title: "All your cards",
                      quiz: true,
                      ahead: true,
                    })
                  }
                >
                  <Sparkles size={15} /> Quiz me
                </button>
              </>
            ) : null}
            <button className="text-button" onClick={() => setPicking(true)}>
              <Plus size={15} /> Add cards
            </button>
          </div>
          {note && (
            <p className="study-note" role="status">
              <Check size={14} aria-hidden="true" /> {note}
            </p>
          )}
        </div>
        <div className="study-hero-side">
          <dl className="study-stats">
            <div>
              <dt>Reviewed today</dt>
              <dd>{data.reviewed_today}</dd>
            </div>
            <div>
              <dt>Day streak</dt>
              <dd>
                <Flame size={16} aria-hidden="true" /> {data.streak}
              </dd>
            </div>
          </dl>
          {totalCards > 0 && forecast.length > 0 && (
            <div
              className="study-forecast"
              role="img"
              aria-label={`Reviews due over the next 7 days: ${forecast
                .map((f) => f.due)
                .join(", ")}`}
            >
              {forecast.map((f, i) => (
                <span key={f.date} title={`${f.due} due`}>
                  <i
                    style={{ height: `${Math.max(6, (f.due / peak) * 100)}%` }}
                  />
                  <small>
                    {i === 0
                      ? "Today"
                      : new Date(`${f.date}T12:00:00`).toLocaleDateString(
                          "en-GB",
                          { weekday: "narrow" },
                        )}
                  </small>
                </span>
              ))}
            </div>
          )}
          <button
            className="text-button"
            disabled={action.pending}
            onClick={() => void makeHabit()}
          >
            <Repeat size={14} /> Make it a daily habit
          </button>
        </div>
      </section>

      {data.exams.length > 0 && (
        <section className="study-section">
          <h2>Exams coming up</h2>
          <ul className="study-exams">
            {data.exams.map((exam) => {
              const d = new Date(exam.starts_at);
              const ready =
                exam.readiness == null
                  ? null
                  : Math.round(exam.readiness * 100);
              return (
                <li key={exam.key} className="card study-exam">
                  <div className="study-exam-row">
                    <div className="study-date" aria-hidden="true">
                      <b>{d.getDate()}</b>
                      <span>
                        {d.toLocaleString("en-GB", { month: "short" })}
                      </span>
                    </div>
                    <div className="study-exam-info">
                      <strong>{exam.title}</strong>
                      <small>
                        {when(exam.starts_at, exam.all_day)} ·{" "}
                        {exam.days_left === 0
                          ? "today"
                          : `in ${exam.days_left} day${exam.days_left === 1 ? "" : "s"}`}
                        {exam.source !== "yours" ? ` · ${exam.source}` : ""}
                      </small>
                      {ready != null ? (
                        <div className="study-exam-ready">
                          <div
                            className="study-bar"
                            role="progressbar"
                            aria-label={`${exam.title}: known well`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={ready}
                          >
                            <i style={{ width: `${ready}%` }} />
                          </div>
                          <span>
                            {ready}% known well
                            {exam.projected != null &&
                              ` · ${Math.round(exam.projected * 100)}% by the exam if you keep up`}
                          </span>
                        </div>
                      ) : (
                        <small className="muted">Choose pages to revise.</small>
                      )}
                    </div>
                    <div className="study-exam-actions">
                      {exam.doc_ids.length > 0 && (
                        <button
                          className="secondary"
                          onClick={() =>
                            setSession({
                              title: exam.title,
                              quiz: false,
                              docId:
                                exam.doc_ids.length === 1
                                  ? exam.doc_ids[0]
                                  : undefined,
                              ahead: true,
                            })
                          }
                        >
                          Revise now
                        </button>
                      )}
                      <button
                        className="secondary"
                        onClick={() => setPlanning(exam)}
                      >
                        <CalendarClock size={15} /> Plan revision
                      </button>
                    </div>
                  </div>
                  <div className="study-exam-pages">
                    {exam.doc_ids.map((id) => (
                      <span key={id} className="chip">
                        {data.decks.find((x) => x.doc_id === id)?.title ??
                          "Page"}
                      </span>
                    ))}
                    <button
                      className="text-button"
                      aria-expanded={choosing === exam.key}
                      onClick={() =>
                        setChoosing(choosing === exam.key ? null : exam.key)
                      }
                    >
                      {choosing === exam.key
                        ? "Done"
                        : exam.doc_ids.length
                          ? "Change pages"
                          : "Choose pages"}
                    </button>
                  </div>
                  {choosing === exam.key && (
                    <fieldset className="study-choose">
                      <legend>Pages to revise for this exam</legend>
                      {data.decks.length ? (
                        data.decks.map((x) => (
                          <label key={x.doc_id} className="check-line">
                            <input
                              type="checkbox"
                              disabled={action.pending}
                              checked={exam.doc_ids.includes(x.doc_id)}
                              onChange={(e) =>
                                void attach(
                                  exam,
                                  e.target.checked
                                    ? [...exam.doc_ids, x.doc_id]
                                    : exam.doc_ids.filter(
                                        (y) => y !== x.doc_id,
                                      ),
                                )
                              }
                            />
                            {x.title}
                            <small className="muted">
                              {x.cards} card{x.cards === 1 ? "" : "s"}
                            </small>
                          </label>
                        ))
                      ) : (
                        <small className="muted">
                          No pages with cards yet.
                        </small>
                      )}
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.decks.length === 0 ? (
        <section className="study-section">
          <EmptyState
            icon={CONCEPT_ICON.study}
            title="No cards yet"
            body="Choose course material, review card drafts, then schedule practice."
          >
            <div className="empty-actions">
              <button
                className="primary"
                disabled={action.pending}
                onClick={() => setPicking(true)}
              >
                <FileText size={15} /> From your pages
              </button>
              <ImportButton
                onFiles={(files) => void imports.importFiles(files)}
                busy={imports.busy}
                className="secondary"
                label="Import material"
              />
            </div>
          </EmptyState>
          <details className="study-manual-entry">
            <summary>Write cards manually</summary>
            <p className="muted">
              A line written as Question :: Answer in a page becomes a card.
            </p>
            <button
              className="secondary"
              disabled={action.pending}
              onClick={() => void newPage()}
            >
              <Plus size={15} /> New study page
            </button>
          </details>
        </section>
      ) : (
        <section className="study-section">
          <div className="study-section-head">
            <h2>
              Pages with cards <small>{data.decks.length}</small>
            </h2>
            <div className="study-tools">
              {data.decks.length >= 8 && (
                <input
                  className="study-search"
                  aria-label="Search pages with cards"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
              <Select
                aria-label="Sort pages"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="due">Due first</option>
                <option value="known">Least known first</option>
                <option value="title">Title A–Z</option>
              </Select>
            </div>
          </div>
          <ul className="card study-deck-list">
            {decks.map((d) => {
              const pct = d.cards ? Math.round((d.known / d.cards) * 100) : 0;
              const exam = data.exams.find((e) => e.doc_ids.includes(d.doc_id));
              const waiting = d.due + d.new;
              return (
                <li key={d.doc_id} className="study-deck-row">
                  <span
                    className="study-ring"
                    style={{ ["--pct" as string]: `${pct}%` }}
                    role="img"
                    aria-label={`${pct}% known well`}
                  >
                    <b>{pct}%</b>
                  </span>
                  <button
                    className="study-deck-main"
                    onClick={() => void openPage(d.doc_id)}
                    title="Open the page"
                  >
                    <strong>{d.title}</strong>
                    <small>
                      {d.cards} card{d.cards === 1 ? "" : "s"}
                      {d.next_due_at && !d.due
                        ? ` · next review ${relDay(d.next_due_at)}`
                        : ""}
                      {d.imported_from
                        ? ` · imported from ${d.imported_from}`
                        : ""}
                    </small>
                  </button>
                  <span className="study-deck-chips">
                    {d.due > 0 && (
                      <span className="chip chip-warn">{d.due} due</span>
                    )}
                    {d.new > 0 && <span className="chip">{d.new} new</span>}
                    {exam && (
                      <span className="chip chip-info" title={exam.title}>
                        Exam {when(exam.starts_at, true)}
                      </span>
                    )}
                    {!waiting && pct === 100 && (
                      <span className="chip chip-quiet">Done for now</span>
                    )}
                  </span>
                  <span className="study-deck-go">
                    <button
                      className={waiting ? "primary" : "secondary"}
                      onClick={() =>
                        setSession(
                          waiting
                            ? { docId: d.doc_id, title: d.title, quiz: false }
                            : {
                                docId: d.doc_id,
                                title: d.title,
                                quiz: true,
                                ahead: true,
                              },
                        )
                      }
                    >
                      {waiting ? "Review" : "Quiz me"}
                    </button>
                    <DeckMenu
                      title={d.title}
                      onSuggest={() =>
                        setMaking({ docId: d.doc_id, title: d.title })
                      }
                      onOpen={() => void openPage(d.doc_id)}
                      onQuiz={() =>
                        setSession({
                          docId: d.doc_id,
                          title: d.title,
                          quiz: true,
                          ahead: true,
                        })
                      }
                      onAhead={() =>
                        setSession({
                          docId: d.doc_id,
                          title: d.title,
                          quiz: false,
                          ahead: true,
                        })
                      }
                    />
                  </span>
                </li>
              );
            })}
            {decks.length === 0 && (
              <li className="study-deck-empty muted">
                No pages match “{query}”.
              </li>
            )}
          </ul>
        </section>
      )}

      {readyImports.length > 0 && (
        <section className="card study-uploads">
          <strong>From your uploads</strong>
          <ul>
            {readyImports.map((j) => (
              <li key={j.id}>
                <span>{j.file_name}</span>
                <button
                  className="secondary"
                  onClick={() =>
                    setMaking({
                      docId: j.doc_id!,
                      title: j.file_name.replace(/\.[a-z0-9]+$/i, ""),
                    })
                  }
                >
                  <Sparkles size={14} /> Make cards
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.weak.length > 0 && (
        <section className="study-section">
          <h2>Needs practice</h2>
          <ul className="card study-weak">
            {data.weak.map((w) => (
              <li key={w.id}>
                <span>{w.question}</span>
                <small className="muted">wrong {w.misses || w.lapses}×</small>
                <button
                  className="text-button"
                  onClick={() => void openPage(w.source?.doc_id ?? w.doc_id)}
                >
                  Re-read {w.source?.doc_title ?? w.doc_title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {picking && (
        <PagePicker
          decks={data.decks.map((d) => d.doc_id)}
          report={report}
          onClose={() => setPicking(false)}
          onPick={(docId, title) => {
            setPicking(false);
            setMaking({ docId, title });
          }}
        />
      )}

      {making && (
        <MakeCardsDialog
          docId={making.docId}
          title={making.title}
          report={report}
          onClose={(added) => {
            setMaking(null);
            if (added) {
              setNote(
                `Added ${added} card${added === 1 ? "" : "s"} to ${making.title}.`,
              );
              void load();
            }
          }}
        />
      )}
      {planning && (
        <RevisionDialog
          exam={planning}
          report={report}
          onClose={(applied) => {
            setPlanning(null);
            if (applied) {
              setNote(
                `Revision planned for ${planning.title}. The sessions are on your calendar.`,
              );
              onPlanned();
            }
          }}
        />
      )}
    </div>
  );
}

/** A menu of a page's other actions. */
function DeckMenu({
  title,
  onSuggest,
  onOpen,
  onQuiz,
  onAhead,
}: {
  title: string;
  onSuggest: () => void;
  onOpen: () => void;
  onQuiz: () => void;
  onAhead: () => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const item = (label: string, icon: React.ReactNode, act: () => void) => (
    <button
      onClick={() => {
        setAnchor(null);
        act();
      }}
    >
      {icon} {label}
    </button>
  );
  return (
    <span className="study-menu">
      <button
        className="icon-button"
        aria-label={`More for ${title}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) =>
          setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())
        }
      >
        <MoreHorizontal size={18} />
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          label={`Actions for ${title}`}
          onClose={() => setAnchor(null)}
          width={240}
        >
          {item("Suggest cards", <Sparkles size={14} />, onSuggest)}
          {item("Quiz me", <HelpCircle size={14} />, onQuiz)}
          {item("Study ahead", <FastForward size={14} />, onAhead)}
          {item("Open page", <FileText size={14} />, onOpen)}
        </Popover>
      )}
    </span>
  );
}

/**
 * Choose a page to have cards suggested from: recently imported and
 * recently edited pages first, pages that already have cards marked.
 */
function PagePicker({
  decks,
  report,
  onPick,
  onClose,
}: {
  decks: string[];
  report: (e: unknown) => void;
  onPick: (docId: string, title: string) => void;
  onClose: () => void;
}) {
  const currentOwner = useStudyOwner();
  const modal = useModalFocus(onClose);
  const titleId = useId();
  const [pages, setPages] = useState<DocSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(60);
  useEffect(() => {
    let active = true;
    setFailed(false);
    client.listDocs().then(
      (all) => {
        if (!active || !currentOwner()) return;
        setPages(
          all
            .filter((d) => d.kind !== "agenda")
            .sort(
              (a, b) =>
                Number(!!b.imported_from) - Number(!!a.imported_from) ||
                b.updated_at.localeCompare(a.updated_at),
            ),
        );
      },
      (e) => {
        if (!active || !currentOwner()) return;
        report(e);
        setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [retry, currentOwner, report]);
  const shown = (pages ?? []).filter((p) =>
    `${p.title} ${p.preview}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={modal.ref}
        data-modal-focus={modal.id}
        tabIndex={-1}
        className="modal study-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="section-heading">
          <h2 id={titleId}>Choose a page</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <input
            autoFocus
            aria-label="Search your pages"
            placeholder="Search your pages…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(60);
            }}
          />
          {failed ? (
            <div role="status">
              <p>Couldn’t load pages.</p>
              <button
                className="secondary"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry
              </button>
            </div>
          ) : pages === null ? (
            <p className="muted">Loading your pages…</p>
          ) : shown.length === 0 ? (
            <p className="muted">No pages match.</p>
          ) : (
            <ul className="study-picker-list">
              {shown.slice(0, limit).map((p) => (
                <li key={p.id}>
                  <button onClick={() => onPick(p.id, p.title || "Untitled")}>
                    <FileText size={15} aria-hidden="true" />
                    <span>
                      <strong>{p.title || "Untitled"}</strong>
                      <small>{p.preview || "Empty page"}</small>
                    </span>
                    {p.imported_from && <span className="chip">Imported</span>}
                    {decks.includes(p.id) && (
                      <span className="chip chip-quiet">Has cards</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!failed && shown.length > limit && (
            <button
              className="text-button"
              onClick={() => setLimit((n) => n + 60)}
            >
              Show more pages
            </button>
          )}
          <details className="study-syntax">
            <summary>Write cards by hand</summary>
            <p className="muted">
              Writing your own: <code>Question :: Answer</code> makes a card,{" "}
              <code>A ::: B</code> asks both ways, and <code>{"{{word}}"}</code>{" "}
              hides a word.
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}

/**
 * The assistant's suggested cards from a page, to tick and edit. Nothing is
 * added until "Add" — then the ticked cards are written into the page under
 * its Cards heading, where they can be edited like any line.
 */
export function MakeCardsDialog(props: Parameters<typeof MakeCardsBody>[0]) {
  return (
    <MakeCardsBody
      key={`${authSession.get()}:${props.docId}:${props.max ?? ""}`}
      {...props}
    />
  );
}

function MakeCardsBody({
  docId,
  title,
  report,
  onClose,
  max,
}: {
  docId: string;
  title: string;
  report: (e: unknown) => void;
  onClose: (added: number) => void;
  /** How many to suggest: "Make 10 flashcards" asks for ten (AI-01). */
  max?: number;
}) {
  const currentOwner = useStudyOwner();
  const action = useAction(report);
  const saving = action.pending;
  const titleId = useId();
  const additions = useRef<{ blocks: DocBlock[]; count: number } | null>(null);
  const mutation = useRef(false);
  const close = () => {
    if (!mutation.current) onClose(0);
  };
  const modal = useModalFocus(close, saving);
  const [retry, setRetry] = useState(0);
  const [providerLabel, setProviderLabel] = useState("");
  const [cards, setCards] = useState<
    (SuggestedCard & { keep: boolean })[] | null
  >(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    client.suggestCards(docId, max).then(
      (r) => {
        if (!active || !currentOwner()) return;
        setProviderLabel(r.provider ? aiFeatureProviderLabel(r.provider) : "");
        setCards(r.cards.map((c) => ({ ...c, keep: true })));
      },
      (e: Error) => {
        if (active && currentOwner()) setError(errorText(e));
      },
    );
    return () => {
      active = false;
    };
  }, [docId, max, retry, currentOwner]);
  const update = (
    i: number,
    patch: Partial<SuggestedCard & { keep: boolean }>,
  ) =>
    setCards(
      (cs) => cs?.map((c, n) => (n === i ? { ...c, ...patch } : c)) ?? cs,
    );
  const kept = (cards ?? []).filter(
    (c) => c.keep && c.question.trim() && c.answer.trim(),
  );
  const add = async () => {
    if (mutation.current || !kept.length || !currentOwner()) return;
    mutation.current = true;
    await action.run(async () => {
      additions.current ??= {
        blocks: withCards([], kept).map((block) => ({
          ...block,
          id: block.id ?? crypto.randomUUID(),
        })),
        count: kept.length,
      };
      const adding = additions.current;
      const doc = await client.getDocForEditor(docId);
      if (!currentOwner()) return;
      const document = doc.document ?? {
        format: 1 as const,
        blocks: doc.content,
      };
      const blocks =
        document.format === 1
          ? document.blocks
          : docContainerBlocks(document.nodes);
      const ids = new Set(blocks.map((b) => b.id).filter(Boolean));
      const found = adding.blocks.filter((b) => b.id && ids.has(b.id)).length;
      if (found && found !== adding.blocks.length)
        throw new Error(
          "Some added cards changed. Review the page before adding more.",
        );
      if (!found) {
        let updated = document;
        if (document.format === 2) {
          updated = {
            format: 2,
            nodes: [
              ...document.nodes,
              ...adding.blocks.map((block) => ({
                kind: "block" as const,
                block,
              })),
            ],
          };
        } else {
          updated = {
            format: 1,
            blocks: [...document.blocks, ...adding.blocks],
          };
        }
        await client.updateDocForEditor(docId, {
          version: doc.version,
          document: updated,
        });
      }
      if (currentOwner()) onClose(adding.count);
    });
    mutation.current = false;
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={modal.ref}
        data-modal-focus={modal.id}
        tabIndex={-1}
        className="modal modal-wide study-make"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="section-heading">
          <h2 id={titleId}>Cards from {title}</h2>
          <button
            className="icon-button"
            aria-label="Close"
            disabled={saving}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <OutcomeNote outcome={action.outcome} />
          {providerLabel && (
            <small className="muted study-provider-label">
              {providerLabel}
            </small>
          )}
          {error ? (
            <div role="alert" className="error">
              {error}
              <button
                className="secondary"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry suggestions
              </button>
            </div>
          ) : cards === null ? (
            <p className="muted">
              <Sparkles size={14} /> Reading your notes…
            </p>
          ) : cards.length === 0 ? (
            <p className="muted">No new cards to suggest.</p>
          ) : (
            <>
              <p className="muted">Edit or deselect cards before adding.</p>
              <ul className="study-suggested">
                {cards.map((c, i) => (
                  <li key={i} className={c.keep ? "" : "is-off"}>
                    <input
                      type="checkbox"
                      disabled={saving || !!additions.current}
                      aria-label={`Keep card ${i + 1}`}
                      checked={c.keep}
                      onChange={(e) => update(i, { keep: e.target.checked })}
                    />
                    <div>
                      <label>
                        Question
                        <textarea
                          aria-label={`Question ${i + 1}`}
                          rows={2}
                          disabled={saving || !!additions.current}
                          value={c.question}
                          maxLength={500}
                          onChange={(e) =>
                            update(i, { question: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Answer
                        <textarea
                          aria-label={`Answer ${i + 1}`}
                          rows={3}
                          disabled={saving || !!additions.current}
                          value={c.answer}
                          maxLength={1000}
                          onChange={(e) =>
                            update(i, { answer: e.target.value })
                          }
                        />
                      </label>
                      {c.source && (
                        <details>
                          <summary>Source</summary>
                          <p className="muted">{c.source}</p>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="button-row">
            <button className="secondary" disabled={saving} onClick={close}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={saving || !kept.length}
              onClick={() => void add()}
            >
              <Check size={15} />{" "}
              {saving
                ? "Adding…"
                : additions.current
                  ? "Retry adding cards"
                  : `Add ${kept.length} card${kept.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Review sessions before an exam, proposed into free time. Untick any, then
 * apply: a "Revise for …" task with the sessions set aside on the calendar.
 */
function RevisionDialog({
  exam,
  report,
  onClose,
}: {
  exam: StudyExam;
  report: (e: unknown) => void;
  onClose: (applied: boolean) => void;
}) {
  const currentOwner = useStudyOwner();
  const action = useAction(report);
  const saving = action.pending;
  const mutation = useRef(false);
  const close = () => {
    if (!mutation.current) onClose(false);
  };
  const modal = useModalFocus(close, saving);
  const titleId = useId();
  const [retry, setRetry] = useState(0);
  const [minutes, setMinutes] = useState(30);
  const [plan, setPlan] = useState<RevisionPlan | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setPlan(null);
    setError("");
    setOff(new Set());
    client
      .planRevision({ key: exam.key, minutes, timezone: deviceTimeZone() })
      .then(
        (next) => {
          if (active && currentOwner()) setPlan(next);
        },
        (e: Error) => {
          if (active && currentOwner()) setError(errorText(e));
        },
      );
    return () => {
      active = false;
    };
  }, [exam.key, minutes, retry, currentOwner]);
  const chosen = (plan?.sessions ?? []).filter((s) => !off.has(s.start_at));
  const apply = async () => {
    if (mutation.current || !chosen.length || !currentOwner()) return;
    mutation.current = true;
    await action.run(async () => {
      await client.applyRevision({ key: exam.key, sessions: chosen });
      if (currentOwner()) onClose(true);
    });
    mutation.current = false;
  };
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={modal.ref}
        data-modal-focus={modal.id}
        tabIndex={-1}
        className="modal study-plan"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="section-heading">
          <h2 id={titleId}>Revision for {exam.title}</h2>
          <button
            className="icon-button"
            aria-label="Close"
            disabled={saving}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <OutcomeNote outcome={action.outcome} />
          <p className="muted">Choose sessions to add to your calendar.</p>
          <div
            className="study-plan-length"
            role="group"
            aria-label="Session length"
          >
            {[20, 30, 45, 60].map((m) => (
              <button
                key={m}
                type="button"
                className={minutes === m ? "active" : ""}
                aria-pressed={minutes === m}
                disabled={saving}
                onClick={() => setMinutes(m)}
              >
                {m} min
              </button>
            ))}
          </div>
          {error ? (
            <div role="alert" className="error">
              {error}
              <button
                className="secondary"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry plan
              </button>
            </div>
          ) : !plan ? (
            <p className="muted">Finding free time…</p>
          ) : plan.sessions.length === 0 ? (
            <p className="muted">
              There&apos;s no free working time before the exam for a session.
            </p>
          ) : (
            <ul className="study-sessions">
              {plan.sessions.map((s) => (
                <li key={s.start_at}>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      disabled={saving}
                      checked={!off.has(s.start_at)}
                      onChange={(e) =>
                        setOff((o) => {
                          const n = new Set(o);
                          if (e.target.checked) n.delete(s.start_at);
                          else n.add(s.start_at);
                          return n;
                        })
                      }
                    />
                    <span>
                      {new Date(s.start_at).toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      · {time(s.start_at)}–{time(s.end_at)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {plan && plan.skipped_days.length > 0 && (
            <p className="muted study-skipped">
              <Lightbulb size={14} /> No free time on{" "}
              {plan.skipped_days
                .map((d) =>
                  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  }),
                )
                .join(", ")}
              .
            </p>
          )}
          <div className="button-row">
            <button className="secondary" disabled={saving} onClick={close}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={saving || !chosen.length}
              onClick={() => void apply()}
            >
              <CalendarClock size={15} />{" "}
              {saving
                ? "Adding…"
                : `Add ${chosen.length} session${chosen.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

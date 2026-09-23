import { useCallback, useEffect, useState } from "react";
import {
  BookOpenCheck,
  CalendarClock,
  Check,
  FileText,
  Flame,
  Lightbulb,
  Plus,
  Repeat,
  Sparkles,
  X,
} from "lucide-react";
import {
  withCards,
  type Doc,
  type RevisionPlan,
  type StudyExam,
  type StudyOverview,
  type SuggestedCard,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { deviceTimeZone } from "../../lib/planning";
import { useConfirm } from "../../components/Confirm";
import { Select } from "../../components/Select";
import { ReviewSession } from "./ReviewSession";
import "./study.css";

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

const EXAMPLE = `What does CAP stand for? :: Consistency, availability, partition tolerance`;

/**
 * Study: cards written in your own pages as "Question :: Answer" lines,
 * reviewed when they're due, with the assistant suggesting cards, checking
 * answers and explaining — and revision planned around your exams. Every
 * change the assistant or the planner suggests waits for your approval.
 */
export function StudyView({ report, onOpenPage, onPlanned }: Props) {
  const { ask } = useConfirm();
  const [data, setData] = useState<StudyOverview | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [making, setMaking] = useState<{ docId: string; title: string } | null>(
    null,
  );
  const [planning, setPlanning] = useState<StudyExam | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(
    () =>
      client.study().then(setData, (e) => {
        report(e);
        setData((d) => d ?? null);
      }),
    [report],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const openPage = (docId: string) =>
    client.getDoc(docId).then(onOpenPage, report);

  const newPage = async () => {
    try {
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
      onOpenPage(doc);
    } catch (e) {
      report(e);
    }
  };

  const makeHabit = async () => {
    if (
      !(await ask({
        title: "Make a daily review a habit?",
        body: "Orbyn sets aside 15 minutes a day for reviewing cards and keeps your streak.",
        confirmLabel: "Add the habit",
      }))
    )
      return;
    try {
      await client.createHabit({
        name: "Review cards",
        cadence: 1,
        period: "day",
        duration_minutes: 15,
      });
      setNote("Added “Review cards” to your habits.");
    } catch (e) {
      report(e);
    }
  };

  const attach = async (exam: StudyExam, docIds: string[]) => {
    try {
      setData(
        await client.setExamDecks({
          key: exam.key,
          title: exam.title,
          starts_at: exam.starts_at,
          doc_ids: docIds,
        }),
      );
    } catch (e) {
      report(e);
    }
  };

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

  if (!data) return <p className="muted">Loading your cards…</p>;

  const toReview = data.due_today + data.new_cards;

  return (
    <div className="study">
      <section className="card study-today">
        <div className="study-stats">
          <Stat label="To review today" value={data.due_today} />
          <Stat label="New today" value={data.new_cards} />
          <Stat label="Reviewed today" value={data.reviewed_today} />
          <Stat
            label="Day streak"
            value={data.streak}
            icon={<Flame size={15} aria-hidden="true" />}
          />
        </div>
        <div className="study-actions">
          <button
            className="primary"
            disabled={!toReview}
            onClick={() => setSession({ title: "All your cards", quiz: false })}
          >
            <BookOpenCheck size={16} />
            {toReview ? `Review now · ${toReview}` : "All caught up"}
          </button>
          <button className="secondary" onClick={() => void makeHabit()}>
            <Repeat size={15} /> Make it a daily habit
          </button>
          <button className="text-button" onClick={() => void newPage()}>
            <Plus size={15} /> New study page
          </button>
        </div>
        {note && (
          <p className="study-note" role="status">
            {note}
          </p>
        )}
      </section>

      {data.exams.length > 0 && (
        <section className="study-section">
          <h2>Exams coming up</h2>
          <ul className="study-exams">
            {data.exams.map((exam) => (
              <li key={exam.key} className="card study-exam">
                <div className="study-exam-head">
                  <div>
                    <strong>{exam.title}</strong>
                    <small>
                      {when(exam.starts_at, exam.all_day)} · in {exam.days_left}{" "}
                      day{exam.days_left === 1 ? "" : "s"}
                      {exam.source !== "yours" ? ` · ${exam.source}` : ""}
                    </small>
                  </div>
                  {exam.readiness != null && (
                    <span className="study-ready">
                      {Math.round(exam.readiness * 100)}% known well
                    </span>
                  )}
                </div>
                {exam.readiness != null && (
                  <div
                    className="study-bar"
                    role="progressbar"
                    aria-label={`${exam.title}: known well`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(exam.readiness * 100)}
                  >
                    <i style={{ width: `${exam.readiness * 100}%` }} />
                  </div>
                )}
                <div className="study-exam-pages">
                  {exam.doc_ids.length ? (
                    exam.doc_ids.map((id) => (
                      <span key={id} className="chip">
                        {data.decks.find((d) => d.doc_id === id)?.title ??
                          "Page"}
                      </span>
                    ))
                  ) : (
                    <small className="muted">
                      No pages attached yet — choose what you&apos;re revising.
                    </small>
                  )}
                </div>
                {choosing === exam.key && (
                  <fieldset className="study-choose">
                    <legend>Pages to revise for this exam</legend>
                    {data.decks.length ? (
                      data.decks.map((d) => (
                        <label key={d.doc_id} className="check-line">
                          <input
                            type="checkbox"
                            checked={exam.doc_ids.includes(d.doc_id)}
                            onChange={(e) =>
                              void attach(
                                exam,
                                e.target.checked
                                  ? [...exam.doc_ids, d.doc_id]
                                  : exam.doc_ids.filter((x) => x !== d.doc_id),
                              )
                            }
                          />
                          {d.title}
                          <small className="muted">
                            {d.cards} card{d.cards === 1 ? "" : "s"}
                          </small>
                        </label>
                      ))
                    ) : (
                      <small className="muted">No pages with cards yet.</small>
                    )}
                  </fieldset>
                )}
                <div className="study-exam-actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      setChoosing(choosing === exam.key ? null : exam.key)
                    }
                  >
                    {choosing === exam.key ? "Done" : "Choose pages"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setPlanning(exam)}
                  >
                    <CalendarClock size={15} /> Plan my revision
                  </button>
                  {exam.doc_ids.length > 0 && (
                    <button
                      className="text-button"
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
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="study-section">
        <h2>Your pages with cards</h2>
        {data.decks.length === 0 ? (
          <div className="card study-empty">
            <strong>Cards come from your own pages.</strong>
            <p className="muted">
              In any page, write a line as <code>Question :: Answer</code> and
              it becomes a card. Or open a page of notes here and let the
              assistant suggest some for you to approve.
            </p>
            <code className="study-example">{EXAMPLE}</code>
            <button className="primary" onClick={() => void newPage()}>
              <Plus size={15} /> New study page
            </button>
          </div>
        ) : (
          <ul className="study-decks">
            {data.decks.map((d) => (
              <li key={d.doc_id} className="card study-deck">
                <button
                  className="study-deck-title"
                  onClick={() => void openPage(d.doc_id)}
                >
                  <FileText size={15} aria-hidden="true" />
                  <strong>{d.title}</strong>
                </button>
                <small className="muted">
                  {d.cards} card{d.cards === 1 ? "" : "s"} · {d.due} due ·{" "}
                  {d.new} new · {d.known} known well
                </small>
                <div className="study-deck-actions">
                  <button
                    className="secondary"
                    disabled={!d.due && !d.new}
                    onClick={() =>
                      setSession({
                        docId: d.doc_id,
                        title: d.title,
                        quiz: false,
                      })
                    }
                  >
                    Review
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      setSession({
                        docId: d.doc_id,
                        title: d.title,
                        quiz: true,
                        ahead: true,
                      })
                    }
                  >
                    Quiz me
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      setMaking({ docId: d.doc_id, title: d.title })
                    }
                  >
                    <Sparkles size={14} /> Suggest cards
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.weak.length > 0 && (
        <section className="study-section">
          <h2>Forgotten most</h2>
          <ul className="card study-weak">
            {data.weak.map((w) => (
              <li key={w.id}>
                <span>{w.question}</span>
                <small className="muted">forgotten {w.lapses}×</small>
                <button
                  className="text-button"
                  onClick={() => void openPage(w.doc_id)}
                >
                  Re-read {w.doc_title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <MakeCardsFromAnyPage
        decks={data.decks.map((d) => d.doc_id)}
        onPick={(docId, title) => setMaking({ docId, title })}
        report={report}
      />

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

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="study-stat">
      <b>
        {icon}
        {value}
      </b>
      <span>{label}</span>
    </div>
  );
}

/** Pick any page of notes (with cards or not) to have cards suggested from. */
function MakeCardsFromAnyPage({
  decks,
  onPick,
  report,
}: {
  decks: string[];
  onPick: (docId: string, title: string) => void;
  report: (e: unknown) => void;
}) {
  const [pages, setPages] = useState<{ id: string; title: string }[] | null>(
    null,
  );
  const [chosen, setChosen] = useState("");
  useEffect(() => {
    client
      .listDocs()
      .then(
        (all) =>
          setPages(
            all
              .filter((d) => d.kind !== "agenda" && !decks.includes(d.id))
              .map((d) => ({ id: d.id, title: d.title || "Untitled" })),
          ),
        report,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!pages?.length) return null;
  return (
    <section className="study-section">
      <h2>Turn notes into cards</h2>
      <div className="card study-pick">
        <p className="muted">
          Pick a page of notes. The assistant suggests cards from it — only from
          what the page says — and you choose which to add.
        </p>
        <div className="study-pick-row">
          <Select
            aria-label="Page of notes"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value="">Choose a page…</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
          <button
            className="secondary"
            disabled={!chosen}
            onClick={() =>
              onPick(chosen, pages.find((p) => p.id === chosen)?.title ?? "")
            }
          >
            <Sparkles size={14} /> Suggest cards
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The assistant's suggested cards from a page, to tick and edit. Nothing is
 * added until "Add" — then the ticked cards are written into the page under
 * its Cards heading, where they can be edited like any line.
 */
function MakeCardsDialog({
  docId,
  title,
  report,
  onClose,
}: {
  docId: string;
  title: string;
  report: (e: unknown) => void;
  onClose: (added: number) => void;
}) {
  const [cards, setCards] = useState<
    (SuggestedCard & { keep: boolean })[] | null
  >(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    client.suggestCards(docId).then(
      (r) => setCards(r.cards.map((c) => ({ ...c, keep: true }))),
      (e: Error) => setError(e.message),
    );
  }, [docId]);
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
    setSaving(true);
    try {
      const doc = await client.getDoc(docId);
      await client.updateDoc(docId, {
        version: doc.version,
        content: withCards(doc.content, kept),
      });
      onClose(kept.length);
    } catch (e) {
      report(e);
      setSaving(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(0)}
    >
      <section
        className="modal modal-wide study-make"
        role="dialog"
        aria-modal="true"
        aria-labelledby="make-cards-title"
      >
        <div className="section-heading">
          <h2 id="make-cards-title">Cards from “{title}”</h2>
          <button
            className="icon-button"
            aria-label="Close"
            onClick={() => onClose(0)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          {error ? (
            <div role="alert" className="error">
              {error}
            </div>
          ) : cards === null ? (
            <p className="muted">
              <Sparkles size={14} /> Reading your notes…
            </p>
          ) : cards.length === 0 ? (
            <p className="muted">
              No new cards to suggest from this page — everything in it may
              already be a card.
            </p>
          ) : (
            <>
              <p className="muted">
                Suggested from your notes only. Untick any you don&apos;t want
                and fix the wording before adding.
              </p>
              <ul className="study-suggested">
                {cards.map((c, i) => (
                  <li key={i} className={c.keep ? "" : "is-off"}>
                    <input
                      type="checkbox"
                      aria-label={`Keep card ${i + 1}`}
                      checked={c.keep}
                      onChange={(e) => update(i, { keep: e.target.checked })}
                    />
                    <div>
                      <input
                        aria-label={`Question ${i + 1}`}
                        value={c.question}
                        maxLength={500}
                        onChange={(e) =>
                          update(i, { question: e.target.value })
                        }
                      />
                      <input
                        aria-label={`Answer ${i + 1}`}
                        value={c.answer}
                        maxLength={1000}
                        onChange={(e) => update(i, { answer: e.target.value })}
                      />
                      {c.source && (
                        <small className="muted">From: “{c.source}”</small>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="button-row">
            <button className="secondary" onClick={() => onClose(0)}>
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
                : `Add ${kept.length} card${kept.length === 1 ? "" : "s"} to the page`}
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
  const [minutes, setMinutes] = useState(30);
  const [plan, setPlan] = useState<RevisionPlan | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setPlan(null);
    client
      .planRevision({ key: exam.key, minutes, timezone: deviceTimeZone() })
      .then(setPlan, (e: Error) => setError(e.message));
  }, [exam.key, minutes]);
  const chosen = (plan?.sessions ?? []).filter((s) => !off.has(s.start_at));
  const apply = async () => {
    setSaving(true);
    try {
      await client.applyRevision({ key: exam.key, sessions: chosen });
      onClose(true);
    } catch (e) {
      report(e);
      setSaving(false);
    }
  };
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}
    >
      <section
        className="modal study-plan"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
      >
        <div className="section-heading">
          <h2 id="plan-title">Revision for {exam.title}</h2>
          <button
            className="icon-button"
            aria-label="Close"
            onClick={() => onClose(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p className="muted">
            One session a day in your free working time, around classes and
            events, a little longer in the last three days. Nothing is added
            until you apply it.
          </p>
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
                onClick={() => setMinutes(m)}
              >
                {m} min
              </button>
            ))}
          </div>
          {error ? (
            <div role="alert" className="error">
              {error}
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
            <button className="secondary" onClick={() => onClose(false)}>
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

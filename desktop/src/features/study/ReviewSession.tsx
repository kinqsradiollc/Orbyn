import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, FileText, Lightbulb, Sparkles } from "lucide-react";
import { RATINGS, type Rating, type StudyCard } from "@orbyn/core";
import { client } from "../../lib/api";
import { Inline } from "../docs/DocBlocks";

const LABEL: Record<Rating, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

type Grade = {
  verdict: "correct" | "partly" | "wrong";
  feedback: string;
  suggested_rating: Rating;
};

/**
 * Reviewing cards one at a time. Flip: read the question, recall, show the
 * answer, rate how it went (1–4 on the keyboard, space to show). Quiz: type
 * an answer and the assistant checks it against the card and its page, then
 * you rate it. The rating sets when the card comes back.
 */
export function ReviewSession({
  docId,
  title,
  quiz,
  ahead,
  report,
  onOpenPage,
  onDone,
}: {
  docId?: string;
  title: string;
  quiz: boolean;
  ahead?: boolean;
  report: (e: unknown) => void;
  onOpenPage: (docId: string) => void;
  onDone: (reviewed: number) => void;
}) {
  const [queue, setQueue] = useState<StudyCard[] | null>(null);
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [grading, setGrading] = useState(false);
  const [explained, setExplained] = useState<{
    explanation: string;
    beyond_notes: boolean;
  } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const answerBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    client
      .studyQueue({ docId, limit: quiz ? 15 : 100, ahead })
      .then(setQueue, (e) => {
        report(e);
        setQueue([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card = queue?.[0];

  const rate = async (rating: Rating) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const next = await client.reviewCard(card.id, rating);
      setReviewed((n) => n + 1);
      // Forgotten cards come back at the end of this session too.
      setQueue((q) => {
        const rest = (q ?? []).slice(1);
        return rating === "again" && !quiz ? [...rest, next] : rest;
      });
      setShown(false);
      setAnswer("");
      setGrade(null);
      setExplained(null);
      setNote("");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!card || !answer.trim()) return;
    setGrading(true);
    try {
      setGrade(await client.gradeAnswer(card.id, answer));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setGrading(false);
      setShown(true);
    }
  };

  const explain = async () => {
    if (!card) return;
    setExplaining(true);
    try {
      setExplained(await client.explainCard(card.id));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setExplaining(false);
    }
  };

  useEffect(() => {
    if (!card || quiz) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.("input, textarea, [contenteditable]")) return;
      if (!shown && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(RATINGS[Number(e.key) - 1]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (quiz && card && !shown) answerBox.current?.focus();
  }, [quiz, card, shown]);

  const total = reviewed + (queue?.length ?? 0);

  return (
    <div className="study-review">
      <div className="study-review-head">
        <button className="text-button" onClick={() => onDone(reviewed)}>
          <ArrowLeft size={15} /> Back to Study
        </button>
        <span className="study-review-title">
          {quiz ? "Quiz" : "Review"} · {title}
        </span>
        {queue && total > 0 ? (
          <span className="study-review-count">
            {Math.min(reviewed + 1, total)} / {total}
          </span>
        ) : (
          <span />
        )}
      </div>
      {queue && total > 0 && (
        <div
          className="study-bar"
          role="progressbar"
          aria-label="Session progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={reviewed}
        >
          <i style={{ width: `${(reviewed / total) * 100}%` }} />
        </div>
      )}
      {!queue ? (
        <p className="muted">Getting your cards…</p>
      ) : !card ? (
        <div className="card study-finished">
          <span className="study-finished-icon" aria-hidden="true">
            <Check size={22} />
          </span>
          <strong>
            {reviewed
              ? `Done. ${reviewed} card${reviewed === 1 ? "" : "s"} reviewed.`
              : "Nothing to review right now."}
          </strong>
          <p className="muted">
            Each card comes back when it&apos;s about to slip. The better you
            knew it, the longer the wait.
          </p>
          <button className="primary" onClick={() => onDone(reviewed)}>
            Back to Study
          </button>
        </div>
      ) : (
        <>
          <div
            className={"card study-flash" + (shown ? " is-shown" : "")}
            aria-live="polite"
          >
            <div className="study-from">
              <button
                className="study-source"
                onClick={() => onOpenPage(card.doc_id)}
                title="Open the page"
              >
                <FileText size={12} aria-hidden="true" /> {card.doc_title}
              </button>
              {card.reps === 0 && <span className="chip">New</span>}
            </div>
            <div className="study-face">
              <span className="study-face-label">Question</span>
              <p className="study-question">
                <Inline text={card.question} />
              </p>
            </div>
            {shown && (
              <div className="study-face study-face-answer">
                <span className="study-face-label">Answer</span>
                <p className="study-answer">
                  <Inline text={card.answer} />
                </p>
              </div>
            )}
          </div>

          {quiz && !shown && (
            <form
              className="study-quiz"
              onSubmit={(e) => {
                e.preventDefault();
                void check();
              }}
            >
              <textarea
                ref={answerBox}
                aria-label="Your answer"
                rows={3}
                value={answer}
                placeholder="Type your answer…"
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void check();
                  }
                }}
              />
              <div className="study-quiz-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShown(true)}
                >
                  I don&apos;t know
                </button>
                <button
                  className="primary"
                  disabled={grading || !answer.trim()}
                >
                  <Sparkles size={14} /> {grading ? "Checking…" : "Check"}
                </button>
              </div>
            </form>
          )}

          {!quiz && !shown && (
            <div className="study-controls">
              <button
                className="primary study-show"
                onClick={() => setShown(true)}
              >
                Show answer
              </button>
              <small className="study-hint">Press space to show</small>
            </div>
          )}

          {shown && (
            <div className="study-controls">
              {grade && (
                <p className={`study-grade is-${grade.verdict}`}>
                  <strong>
                    {grade.verdict === "correct"
                      ? "Right."
                      : grade.verdict === "partly"
                        ? "Partly right."
                        : "Not quite."}
                  </strong>{" "}
                  {grade.feedback}
                </p>
              )}
              {explained && (
                <p className="study-explain">
                  <Lightbulb size={14} aria-hidden="true" />
                  <span>
                    {explained.explanation}
                    {explained.beyond_notes && (
                      <small className="muted"> Goes beyond your notes.</small>
                    )}
                  </span>
                </p>
              )}
              <span className="study-rate-label">
                How well did you know it?
              </span>
              <div
                className="study-rate"
                role="group"
                aria-label="How well did you know it?"
              >
                {RATINGS.map((r) => (
                  <button
                    key={r}
                    className={
                      "study-rate-" +
                      r +
                      (grade?.suggested_rating === r ? " is-suggested" : "")
                    }
                    disabled={busy}
                    onClick={() => void rate(r)}
                  >
                    <strong>{LABEL[r]}</strong>
                    <small>{card.next[r]}</small>
                  </button>
                ))}
              </div>
              <div className="study-after">
                {!quiz && (
                  <small className="study-hint">Keys 1–4 to rate</small>
                )}
                {!explained && (
                  <button
                    className="text-button"
                    disabled={explaining}
                    onClick={() => void explain()}
                  >
                    <Lightbulb size={14} />{" "}
                    {explaining ? "Explaining…" : "Explain this"}
                  </button>
                )}
              </div>
            </div>
          )}
          {note && (
            <p className="muted study-note" role="status">
              {note}
            </p>
          )}
        </>
      )}
    </div>
  );
}

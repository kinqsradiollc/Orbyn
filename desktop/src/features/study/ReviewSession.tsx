import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, FileText, Lightbulb, Sparkles } from "lucide-react";
import {
  aiFeatureProviderLabel,
  type AiFeatureProvider,
  RATINGS,
  type Rating,
  type StudyCard,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Inline } from "../docs/DocBlocks";
import { ImageBlock } from "../docs/RichBlocks";
import { errorText } from "../../lib/errors";
import { session as authSession } from "../../lib/session";
import { useElementWidth } from "../../hooks/useElementWidth";

const LABEL: Record<Rating, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

type Grade = {
  provider?: AiFeatureProvider;
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
export function ReviewSession(props: Parameters<typeof ReviewBody>[0]) {
  return (
    <ReviewBody
      key={`${authSession.get()}:${props.docId ?? "all"}:${props.quiz}:${props.ahead}`}
      {...props}
    />
  );
}

function ReviewBody({
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
  const owner = useRef(authSession.get()).current;
  const { ref: pageRef, width } = useElementWidth();
  const root = useRef<HTMLDivElement>(null);
  const [queue, setQueue] = useState<StudyCard[] | null>(null);
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [grading, setGrading] = useState(false);
  const [explained, setExplained] = useState<{
    provider?: AiFeatureProvider;
    explanation: string;
    beyond_notes: boolean;
  } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const answerBox = useRef<HTMLTextAreaElement>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const action = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pending = busy || grading || explaining;
  const currentOwner = () => mounted.current && authSession.get() === owner;

  useEffect(() => {
    const request = ++generation.current;
    setQueue(null);
    setLoadError("");
    setShown(false);
    setReviewed(0);
    setAnswer("");
    setGrade(null);
    setExplained(null);
    setNote("");
    void client.studyQueue({ docId, limit: quiz ? 15 : 100, ahead }).then(
      (cards) => {
        if (currentOwner() && request === generation.current) setQueue(cards);
      },
      (error) => {
        if (!currentOwner() || request !== generation.current) return;
        setLoadError(errorText(error));
        report(error);
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [docId, quiz, ahead, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = queue?.[0];

  const rate = async (rating: Rating) => {
    if (!currentOwner() || !card || action.current) return;
    action.current = true;
    const request = generation.current;
    setBusy(true);
    try {
      const next = await client.reviewCard(card.id, rating);
      if (!currentOwner() || request !== generation.current) return;
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
      if (currentOwner() && request === generation.current) {
        setNote(errorText(e));
        report(e);
      }
    } finally {
      action.current = false;
      if (currentOwner() && request === generation.current) setBusy(false);
    }
  };

  const check = async () => {
    if (!currentOwner() || !card || !answer.trim() || action.current) return;
    action.current = true;
    const request = generation.current;
    setGrading(true);
    setNote("");
    try {
      const result = await client.gradeAnswer(card.id, answer);
      if (!currentOwner() || request !== generation.current) return;
      setGrade(result);
      setShown(true);
    } catch (e) {
      if (currentOwner() && request === generation.current)
        setNote(errorText(e));
    } finally {
      action.current = false;
      if (currentOwner() && request === generation.current) setGrading(false);
    }
  };

  const explain = async () => {
    if (!currentOwner() || !card || action.current) return;
    action.current = true;
    const request = generation.current;
    setExplaining(true);
    setNote("");
    try {
      const result = await client.explainCard(card.id);
      if (currentOwner() && request === generation.current)
        setExplained(result);
    } catch (e) {
      if (currentOwner() && request === generation.current)
        setNote(errorText(e));
    } finally {
      action.current = false;
      if (currentOwner() && request === generation.current)
        setExplaining(false);
    }
  };

  useEffect(() => {
    if (!card || quiz) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const pane = root.current?.closest(
        ".workspace-duo-primary, .workspace-duo-secondary",
      );
      if (
        !currentOwner() ||
        (pane?.closest(".workspace-duo.is-paired") &&
          !pane.contains(document.activeElement))
      )
        return;
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        action.current ||
        document.querySelector(
          'dialog[open], [aria-modal="true"], .popover, .select-list.is-floating',
        ) ||
        target.closest?.("input, textarea, button, a, [contenteditable]")
      )
        return;
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
    <div
      ref={(node) => {
        root.current = node;
        pageRef(node);
      }}
      className={"study-review" + (width < 640 ? " is-small" : "")}
    >
      <div className="study-review-head">
        <button
          className="text-button"
          disabled={pending}
          onClick={() => {
            if (!action.current && currentOwner()) onDone(reviewed);
          }}
        >
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
      {loadError ? (
        <div className="error" role="alert">
          {loadError}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry cards
          </button>
        </div>
      ) : !queue ? (
        <p className="muted" role="status">
          Loading cards…
        </p>
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
                disabled={pending}
                onClick={() => onOpenPage(card.doc_id)}
                title="Open the page"
              >
                <FileText size={12} aria-hidden="true" /> {card.doc_title}
              </button>
              {card.reps === 0 && <span className="chip">New</span>}
            </div>
            <div className="study-face">
              <span className="study-face-label">Question</span>
              {card.picture && (
                <ImageBlock
                  block={{ type: "image", file: card.picture, text: "" }}
                />
              )}
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
                {card.source && (
                  <button
                    className="study-source study-from-line"
                    disabled={pending}
                    onClick={() => onOpenPage(card.source!.doc_id)}
                    title="Open the notes this card came from"
                  >
                    from: {card.source.doc_title}
                    {card.source.text ? ` › ${card.source.text}` : ""}
                  </button>
                )}
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
                disabled={pending}
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
                  disabled={pending}
                  onClick={() => setShown(true)}
                >
                  I don&apos;t know
                </button>
                <button
                  className="primary"
                  disabled={pending || !answer.trim()}
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
                  {grade.provider && (
                    <small className="muted study-provider-label">
                      {" "}
                      {aiFeatureProviderLabel(grade.provider)}
                    </small>
                  )}
                </p>
              )}
              {explained && (
                <p className="study-explain">
                  <Lightbulb size={14} aria-hidden="true" />
                  <span>
                    {explained.explanation}
                    {explained.provider && (
                      <small className="muted study-provider-label">
                        {" "}
                        {aiFeatureProviderLabel(explained.provider)}
                      </small>
                    )}
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
                    disabled={pending}
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
                    disabled={pending}
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
            <p className="error study-note" role="alert">
              {note}
            </p>
          )}
        </>
      )}
    </div>
  );
}

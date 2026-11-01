import {
  aiFeatureProviderLabel,
  RATINGS,
  type AiFeatureProvider,
  type Rating,
  type StudyCard,
} from "@orbyn/core";
import { ArrowLeft, Check, FileText, Lightbulb, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Empty,
  ErrorNotice,
  Loading,
  Pill,
  TextArea,
} from "../../ui/kit";
import { Inline } from "../library/page/Inline";
import { useStudyOwner } from "./lifetime";

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
type Explained = {
  explanation: string;
  provider?: AiFeatureProvider;
  beyond_notes?: boolean;
};

export type Session = {
  docId?: string;
  title: string;
  quiz: boolean;
  ahead?: boolean;
};

/** One card at a time: recall, show, rate. A quiz checks what was typed. */
export function Review({
  session,
  onDone,
}: {
  session: Session;
  onDone: (reviewed: number) => void;
}) {
  const [cards, setCards] = useState<StudyCard[] | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [explained, setExplained] = useState<Explained | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);
  const generation = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const answerBox = useRef<HTMLTextAreaElement>(null);
  const current = useStudyOwner();
  useEffect(() => {
    const read = ++generation.current;
    setCards(null);
    setError("");
    setReviewed(0);
    setShown(false);
    setAnswer("");
    setGrade(null);
    setExplained(null);
    client
      .studyQueue({
        docId: session.docId,
        limit: session.quiz ? 15 : 100,
        ahead: session.ahead,
      })
      .then(
        (next) => {
          if (current() && read === generation.current) setCards(next);
        },
        (failure) => {
          if (current() && read === generation.current)
            setError(messageOf(failure, "Couldn't load cards."));
        },
      );
    return () => {
      generation.current++;
    };
  }, [session.docId, session.quiz, session.ahead, attempt, current]);
  const card = cards?.[0];
  const total = reviewed + (cards?.length ?? 0);
  const rate = useCallback(
    async (rating: Rating) => {
      if (!card || lock.current || !current()) return;
      lock.current = true;
      const read = generation.current;
      setBusy(true);
      setError("");
      try {
        const next = await client.reviewCard(card.id, rating);
        if (!current() || read !== generation.current) return;
        setCards((all) => {
          const remaining = (all ?? []).slice(1);
          return rating === "again" && !session.quiz
            ? [...remaining, next]
            : remaining;
        });
        setReviewed((n) => n + 1);
        setShown(false);
        setAnswer("");
        setGrade(null);
        setExplained(null);
      } catch (failure) {
        if (current() && read === generation.current)
          setError(messageOf(failure, "Couldn't save this rating. Try again."));
      } finally {
        lock.current = false;
        if (current() && read === generation.current) setBusy(false);
      }
    },
    [card, current, session.quiz],
  );
  const check = async () => {
    if (!card || !answer.trim() || lock.current || !current()) return;
    lock.current = true;
    const read = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await client.gradeAnswer(card.id, answer.trim());
      if (!current() || read !== generation.current) return;
      setGrade(result);
      setShown(true);
    } catch (failure) {
      if (current() && read === generation.current)
        setError(
          messageOf(
            failure,
            "Couldn't check this answer. You can still show the card.",
          ),
        );
    } finally {
      lock.current = false;
      if (current() && read === generation.current) setBusy(false);
    }
  };
  const explain = async () => {
    if (!card || lock.current || !current()) return;
    lock.current = true;
    const read = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await client.explainCard(card.id);
      if (current() && read === generation.current) setExplained(result);
    } catch (failure) {
      if (current() && read === generation.current)
        setError(messageOf(failure, "Couldn't explain this card."));
    } finally {
      lock.current = false;
      if (current() && read === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (
        !card ||
        session.quiz ||
        !current() ||
        lock.current ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !root.current?.getClientRects().length ||
        (active &&
          active !== document.body &&
          !root.current.contains(active)) ||
        document.querySelector(
          'dialog[open], [aria-modal="true"], [role="menu"]',
        ) ||
        (event.target as HTMLElement)?.closest(
          "textarea, input, button, a, select, [contenteditable]",
        )
      )
        return;
      if (!shown && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setShown(true);
      } else if (shown && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        void rate(RATINGS[Number(event.key) - 1]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shown, rate, card, current, session.quiz]);
  useEffect(() => {
    if (session.quiz && card && !shown) answerBox.current?.focus();
  }, [card, session.quiz, shown]);

  const head = (
    <div className="study-review-head">
      <Button variant="ghost" disabled={busy} onClick={() => onDone(reviewed)}>
        <ArrowLeft /> Back
      </Button>
      <span className="row-main small muted" dir="auto">
        {session.title}
      </span>
      {cards && !!cards.length && (
        <span className="small muted">
          {Math.min(reviewed + 1, total)} / {total}
        </span>
      )}
    </div>
  );
  if (!cards)
    return (
      <div ref={root} className="page study">
        {head}
        {error ? (
          <ErrorNotice
            message={error}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : (
          <Loading label="Loading cards" />
        )}
      </div>
    );
  if (!card)
    return (
      <div ref={root} className="page study">
        {head}
        <Empty
          title={
            reviewed
              ? `${reviewed} card${reviewed === 1 ? "" : "s"} reviewed`
              : "Nothing to review"
          }
        >
          <Button variant="primary" onClick={() => onDone(reviewed)}>
            <Check /> Done
          </Button>
        </Empty>
      </div>
    );
  return (
    <div ref={root} className="page study">
      {head}
      <progress
        className="study-progress"
        aria-label="Session progress"
        value={reviewed}
        max={total}
      />
      {error && <ErrorNotice message={error} />}
      <article className="study-card">
        {card.reps === 0 && <Pill tone="blue">New</Pill>}
        <p className="small muted">Question</p>
        <div className="study-face" dir="auto">
          <Inline text={card.question} />
        </div>
        {session.quiz && !shown && (
          <form
            className="study-answer"
            onSubmit={(event) => {
              event.preventDefault();
              void check();
            }}
          >
            <TextArea
              ref={answerBox}
              autoFocus
              disabled={busy}
              aria-label="Your answer"
              dir="auto"
              value={answer}
              onChange={(event) => setAnswer(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="study-actions">
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={!answer.trim()}
              >
                <Sparkles /> Check answer
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setShown(true)}
              >
                Show answer
              </Button>
            </div>
          </form>
        )}
        {shown && (
          <>
            <p className="small muted">Answer</p>
            <div className="study-face" dir="auto">
              <Inline text={card.answer} />
            </div>
          </>
        )}
        {grade && (
          <p className={`study-grade is-${grade.verdict} small`} dir="auto">
            <strong>
              {grade.verdict === "correct"
                ? "Correct"
                : grade.verdict === "partly"
                  ? "Partly right"
                  : "Not quite"}
              .{" "}
            </strong>
            {grade.feedback}
            {grade.provider && (
              <small className="muted">
                {" "}
                {aiFeatureProviderLabel(grade.provider)}
              </small>
            )}
          </p>
        )}
        {explained && (
          <p className="study-explain small" dir="auto">
            <Lightbulb aria-hidden="true" /> {explained.explanation}
            {explained.provider && (
              <small className="muted">
                {" "}
                {aiFeatureProviderLabel(explained.provider)}
              </small>
            )}
            {explained.beyond_notes && (
              <small className="muted"> This goes beyond your notes.</small>
            )}
          </p>
        )}
      </article>
      {!shown && !session.quiz && (
        <div className="study-actions">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => setShown(true)}
          >
            Show answer
          </Button>
          <span className="small muted">Press space to show</span>
        </div>
      )}
      {shown && (
        <>
          <div
            className="study-rates"
            role="group"
            aria-label="How well did you know it?"
          >
            {RATINGS.map((rating, index) => (
              <Button
                key={rating}
                variant={
                  grade?.suggested_rating === rating ? "primary" : "secondary"
                }
                disabled={busy}
                onClick={() => void rate(rating)}
              >
                {LABEL[rating]} <kbd className="small">{index + 1}</kbd>
              </Button>
            ))}
          </div>
          <div className="study-actions">
            {!explained && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void explain()}
              >
                <Lightbulb /> Explain this
              </Button>
            )}
            {card.doc_id && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  navigate(
                    `/app/doc/${card.doc_id}${card.block_id ? `#${card.block_id}` : ""}`,
                  )
                }
              >
                <FileText /> Open the page
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

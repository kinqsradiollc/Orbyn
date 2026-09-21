import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { DocAnswer } from "@orbyn/core";
import { client } from "../../lib/api";

/**
 * Ask something about this page, answered from this page.
 *
 * Nothing else is read — not your other pages, not your schedule — so the
 * answer can be checked against the lines it names. Clicking a line takes
 * you to it, which is the point: the answer is a way into the page rather
 * than a replacement for reading it.
 */
export function DocAskPanel({
  docId,
  onGoToBlock,
}: {
  docId: string;
  onGoToBlock: (blockId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<DocAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const ask = () => {
    const asked = question.trim();
    if (!asked || busy) return;
    setBusy(true);
    setProblem("");
    setAnswer(null);
    client
      .askDoc(docId, asked)
      .then(setAnswer)
      .catch((e: Error) => setProblem(e.message || "No answer."))
      .finally(() => setBusy(false));
  };

  if (!open)
    return (
      <button
        className="text-button doc-ask-open"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={14} aria-hidden="true" /> Ask about this page
      </button>
    );

  return (
    <section className="doc-ask" aria-label="Ask about this page">
      <div className="doc-ask-head">
        <h3>
          <Sparkles size={14} aria-hidden="true" /> Ask about this page
        </h3>
        <button className="text-button" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <textarea
        id="doc-ask-question"
        value={question}
        rows={2}
        maxLength={1000}
        placeholder="What did we decide about pricing?"
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            ask();
          }
        }}
      />
      <div className="doc-card-actions">
        <button
          className="primary"
          disabled={busy || !question.trim()}
          onClick={ask}
        >
          {busy ? "Reading…" : "Ask"}
        </button>
      </div>
      {!!problem && <p className="doc-ask-problem">{problem}</p>}
      {answer && (
        <div className="doc-ask-answer">
          <p>{answer.answer}</p>
          {answer.sources.length > 0 && (
            <ul className="doc-ask-sources">
              {answer.sources.map((s) => (
                <li key={s.block_id}>
                  <button
                    className="doc-ask-source"
                    onClick={() => onGoToBlock(s.block_id)}
                  >
                    “{s.quote}”
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

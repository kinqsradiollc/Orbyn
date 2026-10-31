import {
  aiFeatureProviderLabel,
  blockText,
  DOC_AI_ACTIONS,
  DOC_AI_LABELS,
  docSelectionContext,
  type AiFeatureProvider,
  type DocAnswer,
  type DocAiAction,
  type DocBlock,
  type DocSelection,
  type DocSuggestion,
} from "@orbyn/core";
import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { Button, TextArea } from "../../../ui/kit";
import { BlockTarget } from "./BlockTarget";

type Turn = {
  id: number;
  role: "you" | "orbyn";
  text: string;
  sources?: DocAnswer["sources"];
  provider?: AiFeatureProvider;
  proposed?: DocSuggestion;
  failed?: boolean;
};

const QUICK = DOC_AI_ACTIONS.filter((action) => action !== "custom");
let next = 0;

/**
 * A conversation about one page. Pointed at the page it answers from the page;
 * pointed at a line it proposes new words. Nothing reaches the page unreviewed.
 */
export function Ask({
  docId,
  blocks,
  canWrite,
  seed,
  ensureSaved,
  version,
  onGoTo,
  onSuggested,
  onClose,
}: {
  docId: string;
  blocks: DocBlock[];
  canWrite: boolean;
  seed: DocSelection | null;
  ensureSaved: () => Promise<boolean>;
  version: () => number;
  onGoTo: (blockId: string) => void;
  onSuggested: (made: DocSuggestion) => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [excerpt, setExcerpt] = useState(seed);
  useEffect(() => setExcerpt(seed), [seed]);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [turns.length, busy]);
  const say = (turn: Omit<Turn, "id">) =>
    setTurns((list) => [...list, { ...turn, id: ++next }]);
  const line = target === null ? null : blocks[target];

  const ask = async () => {
    const question = message.trim();
    if (!question || busy) return;
    setBusy(true);
    setMessage("");
    say({ role: "you", text: question });
    try {
      const answer = await client.askDoc(
        docId,
        question,
        excerpt ? docSelectionContext(excerpt, version()) : undefined,
      );
      if (alive.current)
        say({
          role: "orbyn",
          text: answer.answer,
          sources: answer.sources,
          provider: answer.provider,
        });
    } catch (failure) {
      if (alive.current) {
        setMessage(question);
        say({
          role: "orbyn",
          text: messageOf(failure, "Couldn't answer that."),
          failed: true,
        });
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const propose = async (action: DocAiAction, instruction = "") => {
    if (!line?.id || !("text" in line) || busy) return;
    setBusy(true);
    say({ role: "you", text: instruction || DOC_AI_LABELS[action].name });
    try {
      if (!(await ensureSaved()))
        throw new Error("Save your edits before asking for a change.");
      const made = await client.assistDoc(docId, {
        block_id: line.id,
        range_start: 0,
        range_end: line.text.length,
        action,
        instruction,
        quote: line.text,
        version: version(),
      });
      onSuggested(made);
      if (alive.current)
        say({
          role: "orbyn",
          text: "Suggested. Review it on the page.",
          proposed: made,
          provider: made.provider,
        });
    } catch (failure) {
      if (alive.current)
        say({
          role: "orbyn",
          text: messageOf(failure, "Couldn't suggest a change."),
          failed: true,
        });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="page-panel-body doc-ask">
      <div className="page-panel-head">
        <h2>Talk about this page</h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {excerpt ? (
        <div className="page-note small">
          <span className="row-main doc-ask-quote" dir="auto">
            {excerpt.quote}
          </span>
          <Button variant="ghost" onClick={() => setExcerpt(null)}>
            Clear
          </Button>
        </div>
      ) : canWrite ? (
        <BlockTarget blocks={blocks} value={target} onChange={setTarget} />
      ) : null}
      <div ref={thread} className="doc-ask-thread" aria-live="polite">
        {!turns.length && (
          <p className="small muted">
            {line
              ? "Pick a change, or say what you want. It comes back as a proposal."
              : "Ask a question. Answers use this page and cite their sources."}
          </p>
        )}
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={`doc-turn is-${turn.role}${turn.failed ? " is-failed" : ""}`}
            dir="auto"
          >
            <p>{turn.text}</p>
            {turn.sources?.map((source) => (
              <button
                key={source.block_id}
                type="button"
                className="doc-textlink small"
                dir="auto"
                onClick={() => onGoTo(source.block_id)}
              >
                {blockText(
                  blocks.find((block) => block.id === source.block_id) ?? {
                    type: "paragraph",
                    text: source.quote ?? "Source",
                  },
                ).slice(0, 80)}
              </button>
            ))}
            {turn.provider && (
              <small className="muted">
                {aiFeatureProviderLabel(turn.provider)}
              </small>
            )}
          </div>
        ))}
        {busy && (
          <p className="small muted" role="status">
            Working…
          </p>
        )}
      </div>
      {line && (
        <div className="doc-select-chips">
          {QUICK.map((action) => (
            <button
              key={action}
              type="button"
              disabled={busy}
              onClick={() => void propose(action)}
            >
              {DOC_AI_LABELS[action].name}
            </button>
          ))}
        </div>
      )}
      <form
        className="doc-ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (line) {
            const words = message.trim();
            if (words) {
              setMessage("");
              void propose("custom", words);
            }
          } else void ask();
        }}
      >
        <TextArea
          aria-label={line ? "Say what to change" : "Ask about this page"}
          placeholder={line ? "Say what to change" : "Ask about this page"}
          value={message}
          rows={2}
          onChange={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !message.trim()}
          aria-label="Send"
        >
          <ArrowUp />
        </Button>
      </form>
    </div>
  );
}

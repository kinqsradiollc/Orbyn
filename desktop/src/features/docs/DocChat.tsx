import "./doc-chat-selection.css";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, X } from "lucide-react";
import {
  aiFeatureProviderLabel,
  type AiFeatureProvider,
  DOC_AI_ACTIONS,
  DOC_AI_LABELS,
  blockText,
  plainText,
  serializeBlock,
  type DocAiAction,
  type DocAnswer,
  type DocAskExcerpt,
  type DocBlock,
  type DocSuggestion,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session as authSession } from "../../lib/session";
import { Select } from "../../components/Select";
import { errorText } from "../../lib/errors";

export function DocChat(props: Parameters<typeof DocChatBody>[0]) {
  return <DocChatBody key={props.docId} {...props} />;
}

/** The actions worth one click; "custom" is whatever gets typed instead. */
const QUICK = DOC_AI_ACTIONS.filter((a) => a !== "custom");

type Turn = {
  id: string;
  role: "you" | "orbyn";
  text: string;
  sources?: DocAnswer["sources"];
  provider?: AiFeatureProvider;
  /** Set when this turn proposed a change rather than said something. */
  proposed?: DocSuggestion;
};

let seq = 0;
const nextId = () => `t${++seq}`;

/**
 * A conversation about one page, in a panel that floats over it.
 *
 * It does two things, and which one depends on what it is pointed at. Pointed
 * at the page it answers questions from that page alone, naming the lines it
 * leant on. Pointed at a line it changes the words — rewriting, shortening,
 * carrying on from where they stop, or whatever gets typed — and what comes
 * back is a proposal, reviewed beside every other proposal. Nothing it writes
 * reaches the page without someone taking it.
 */
function DocChatBody({
  docId,
  blocks,
  canWrite,
  onGoToBlock,
  onNameBlock,
  onSuggested,
  onClose,
  excerpt,
  isSelectionCurrent,
}: {
  docId: string;
  excerpt?: DocAskExcerpt | null;
  isSelectionCurrent?: () => boolean;
  blocks: DocBlock[];
  /** Whether a proposal can be made at all from here. */
  canWrite: boolean;
  onGoToBlock: (blockId: string) => void;
  /** Gives a line a name so a proposal can point at it, and returns it. */
  onNameBlock: (index: number) => string;
  onSuggested: (made: DocSuggestion) => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which line the conversation is about; null is the page as a whole. */
  const [target, setTarget] = useState<number | null>(null);
  const selectionOwner = useRef({ excerpt, isSelectionCurrent });
  selectionOwner.current = { excerpt, isSelectionCurrent };
  const explained = useRef<number | null>(null);
  useEffect(() => {
    if (excerpt) setTarget(null);
  }, [excerpt?.requestId]);
  const mutation = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The lines worth offering: the ones with words in them.
  const lines = blocks
    .map((block, index) => ({ index, text: blockText(block).trim() }))
    .filter((l) => l.text);
  const line = target === null ? null : blocks[target];

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);

  // A line that goes away takes the conversation back to the page.
  useEffect(() => {
    if (target !== null && (!blocks[target] || !canWrite)) setTarget(null);
  }, [blocks, target, canWrite]);

  const say = (turn: Omit<Turn, "id">) =>
    setTurns((list) => [...list, { ...turn, id: nextId() }]);

  const fail = (e: unknown) =>
    say({
      role: "orbyn",
      text: errorText(e),
    });

  /** Ask something of the page, answered from the page alone. */
  const ask = async (question: string) => {
    if (mutation.current) return;
    const owner = excerpt;
    const account = authSession.get();
    const current = () =>
      mounted.current &&
      authSession.get() === account &&
      selectionOwner.current.excerpt?.requestId === owner?.requestId;
    mutation.current = true;
    setBusy(true);
    try {
      if (owner && isSelectionCurrent && !isSelectionCurrent())
        throw new Error(
          "The selection or page changed. Select the excerpt again.",
        );
      const answer = await client.askDoc(docId, question, owner?.selection);
      if (!current()) return;
      if (owner && selectionOwner.current.isSelectionCurrent?.() === false)
        throw new Error(
          "The selection or page changed. Select the excerpt again.",
        );
      say({
        role: "orbyn",
        text: answer.answer,
        sources: answer.sources,
        provider: answer.provider,
      });
    } catch (e) {
      if (current()) {
        fail(e);
        setMessage(question);
      }
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  /** Ask for the targeted line to be changed. What comes back is a proposal. */
  const change = async (action: DocAiAction, instruction = "") => {
    if (excerpt || target === null || !line || !canWrite || mutation.current)
      return;
    mutation.current = true;
    setBusy(true);
    try {
      const blockId = onNameBlock(target);
      const source = serializeBlock(line);
      const made = await client.assistDoc(docId, {
        block_id: blockId,
        range_start: 0,
        range_end: source.length,
        action,
        instruction,
      });
      if (!mounted.current) return;
      onSuggested(made);
      say({
        role: "orbyn",
        text: "Proposal ready for review.",
        proposed: made,
        provider: made.provider,
      });
    } catch (e) {
      if (mounted.current) fail(e);
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const send = () => {
    const said = message.trim();
    if (!said || mutation.current || (target !== null && !canWrite)) return;
    setMessage("");
    say({ role: "you", text: said });
    if (excerpt || target === null) void ask(said);
    else void change("custom", said);
  };

  useEffect(() => {
    if (
      !excerpt?.explain ||
      explained.current === excerpt.requestId ||
      mutation.current
    )
      return;
    explained.current = excerpt.requestId;
    const question = "Explain this selected text.";
    say({ role: "you", text: question });
    void ask(question);
    // One explicit Explain action per retained selection request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excerpt?.requestId, busy]);

  return (
    <aside className="doc-chat" aria-label="Page assistant">
      <header className="doc-chat-head">
        <h3>
          <Sparkles size={14} aria-hidden="true" /> Page assistant
        </h3>
        <button
          className="icon-button"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>

      {/* What the conversation is pointed at. The page answers questions;
          a line is something that can be changed. */}
      {excerpt && (
        <div className="doc-chat-excerpt">
          <small>Selected text · {excerpt.selection.format}</small>
          <blockquote>{excerpt.selection.quote}</blockquote>
        </div>
      )}
      {!excerpt && (
        <div className="doc-chat-target">
          <label htmlFor="doc-chat-about">About</label>
          <Select
            id="doc-chat-about"
            disabled={busy}
            value={target === null ? "" : String(target)}
            onChange={(e) =>
              setTarget(e.target.value === "" ? null : Number(e.target.value))
            }
          >
            <option value="">The whole page</option>
            {canWrite &&
              lines.map((l) => (
                <option key={l.index} value={l.index} title={plainText(l.text)}>
                  {plainText(l.text).slice(0, 60)}
                  {plainText(l.text).length > 60 ? "…" : ""}
                </option>
              ))}
          </Select>
        </div>
      )}

      <div className="doc-chat-thread" ref={threadRef} aria-live="polite">
        {turns.length === 0 && (
          <p className="doc-chat-empty">
            {excerpt
              ? "Ask about the selected text. Your document stays unchanged."
              : target === null
                ? "Ask a question. Answers use this page and cite their sources."
                : "Request a change. Review the proposal before applying it."}
          </p>
        )}
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={
              "doc-chat-turn" +
              (turn.role === "you" ? " is-you" : " is-orbyn") +
              (turn.proposed ? " is-proposed" : "")
            }
          >
            <p>{turn.text}</p>
            {turn.provider && (
              <small className="doc-chat-provider">
                {aiFeatureProviderLabel(turn.provider)}
              </small>
            )}
            {turn.proposed && (
              <p className="doc-chat-proposed">
                “{plainText(turn.proposed.quote)}” →{" "}
                <strong>{plainText(turn.proposed.text)}</strong>
              </p>
            )}
            {turn.sources?.map((s) => (
              <button
                key={s.block_id}
                className="doc-chat-source"
                onClick={() => onGoToBlock(s.block_id)}
              >
                “{plainText(s.quote)}”
              </button>
            ))}
          </div>
        ))}
        {busy && <p className="doc-chat-empty">Reading…</p>}
      </div>

      {/* One tap each, when there is a line to point them at. */}
      {!excerpt && target !== null && canWrite && (
        <div className="doc-chat-quick">
          {QUICK.map((action) => (
            <button
              key={action}
              className="text-button"
              disabled={busy}
              title={DOC_AI_LABELS[action].asks}
              onClick={() => void change(action)}
            >
              {DOC_AI_LABELS[action].name}
            </button>
          ))}
        </div>
      )}

      <form
        className="doc-chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={2}
          maxLength={1000}
          disabled={busy}
          aria-label={
            excerpt
              ? "Question about selected text"
              : target === null
                ? "Question about this page"
                : "Requested change"
          }
          value={message}
          placeholder={
            excerpt
              ? "Ask about the selected text…"
              : target === null
                ? "What did we decide about pricing?"
                : "Say what this line should become…"
          }
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="doc-chat-send"
          aria-label={target === null ? "Ask" : "Ask for this change"}
          disabled={busy || !message.trim() || (target !== null && !canWrite)}
        >
          <ArrowUp size={16} />
        </button>
      </form>
    </aside>
  );
}

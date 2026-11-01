import { useRouteInput, useRouteActivity } from "../../lib/route-scope";
import {
  assistantDateLabel,
  assistantExcerptMatches,
  type AssistantConversationEntry,
} from "@orbyn/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, ErrorNotice } from "../../ui/kit";
import { useOwned } from "../agents-shared/hooks";
import { Evidence, More } from "../agents-shared/parts";
import {
  ProposalReview,
  useProposalLinks,
} from "../agents-shared/ProposalReview";
import { ReplyText } from "../agents-shared/ReplyText";
import { replyWords, traceWords, updateWords } from "../agents-shared/words";
import { MessageDetails } from "./History";
import { Reminder } from "./Reminder";
import { TurnChanges } from "./TurnChanges";
import type { useAssistant } from "./useAssistant";

type Assistant = ReturnType<typeof useAssistant>;
export function Transcript({
  assistant,
  timezone,
  onOpenChat,
  covered,
}: {
  assistant: Assistant;
  timezone: string;
  onOpenChat: (id: string) => void;
  covered: boolean;
}) {
  const inputAllowed = useRouteInput(),
    activity = useRouteActivity();
  const links = useProposalLinks();
  const owned = useOwned(),
    node = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    prepend = useRef<{ height: number; top: number } | null>(null);
  const [reading, setReading] = useState(false),
    [details, setDetails] = useState<string | null>(null),
    [selection, setSelection] = useState<{ id: string; text: string } | null>(
      null,
    ),
    [copyError, setCopyError] = useState("");
  const [copyDone, setCopyDone] = useState<string | null>(null);
  const entries = assistant.conversation.entries;
  const currentDetails = entries.find((entry) => entry.id === details);
  useEffect(() => {
    setDetails(null);
    setSelection(null);
    setReading(false);
    follow.current = true;
  }, [assistant.chat?.id]);
  useLayoutEffect(() => {
    const el = node.current;
    if (!activity.visible || !el) return;
    if (prepend.current && !assistant.conversation.loading) {
      el.scrollTop =
        prepend.current.top + el.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (follow.current) el.scrollTop = el.scrollHeight;
  }, [assistant.display, assistant.progress, activity.visible]);
  useEffect(() => {
    const el = node.current;
    if (
      !el ||
      covered ||
      details ||
      document.hidden ||
      !assistant.conversation.destination
    )
      return;
    const observe = () => {
      if (
        document.querySelector("dialog[open],.menu") ||
        (document.activeElement instanceof Element &&
          !!document.activeElement.closest(".st-panel")) ||
        !inputAllowed() ||
        !owned() ||
        document.hidden ||
        !document.hasFocus()
      )
        return;
      const box = el.getBoundingClientRect();
      let through = "0";
      for (const message of el.querySelectorAll<HTMLElement>(
        "[data-sequence]",
      )) {
        const rect = message.getBoundingClientRect();
        if (
          rect.bottom > box.top &&
          rect.top < box.bottom &&
          Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) >=
            Math.min(44, rect.height) &&
          message.dataset.sequence &&
          BigInt(message.dataset.sequence) > BigInt(through)
        )
          through = message.dataset.sequence;
      }
      if (through !== "0") void assistant.store.acknowledge(through);
    };
    const observer = new IntersectionObserver(observe, {
      root: el,
      threshold: [0, 0.1, 0.5, 1],
    });
    el.querySelectorAll("[data-sequence]").forEach((message) =>
      observer.observe(message),
    );
    window.addEventListener("focus", observe);
    document.addEventListener("visibilitychange", observe);
    el.addEventListener("scroll", observe, { passive: true });
    observe();
    return () => {
      observer.disconnect();
      window.removeEventListener("focus", observe);
      document.removeEventListener("visibilitychange", observe);
      el.removeEventListener("scroll", observe);
    };
  }, [
    entries,
    assistant.conversation.destination?.id,
    covered,
    details,
    owned,
    assistant.store,
  ]);
  useEffect(() => {
    if (!inputAllowed() || !assistant.focused) return;
    const el = node.current?.querySelector<HTMLElement>(
      `[data-entry="${CSS.escape(assistant.focused)}"]`,
    );
    if (el) {
      follow.current = false;
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
      setReading(true);
    }
  }, [
    assistant.focused,
    entries,
    inputAllowed,
    activity.visible,
    activity.focused,
  ]);
  const earlier = async () => {
    const el = node.current;
    if (!owned() || !el) return;
    follow.current = false;
    prepend.current = { height: el.scrollHeight, top: el.scrollTop };
    await assistant.store.loadEarlier();
    if (owned()) setReading(true);
  };
  const selected = () => {
    const range = window.getSelection();
    if (!range || range.isCollapsed) {
      setSelection(null);
      return;
    }
    const element = (one: Node | null) =>
      one instanceof Element ? one : one?.parentElement;
    const start = element(range.anchorNode)?.closest<HTMLElement>(
        "[data-entry]",
      ),
      end = element(range.focusNode)?.closest<HTMLElement>("[data-entry]"),
      text = range.toString().trim();
    if (
      !start ||
      start !== end ||
      !node.current?.contains(start) ||
      !text ||
      text.length > 2000
    ) {
      setSelection(null);
      return;
    }
    const entry = entries.find((one) => one.id === start.dataset.entry),
      source = entry?.kind === "turn" ? entry.turn.text : entry?.text;
    setSelection(
      entry && source && assistantExcerptMatches(source, text)
        ? { id: entry.id, text }
        : null,
    );
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (inputAllowed() && owned()) selected();
      }, 120);
    };
    document.addEventListener("selectionchange", settle);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", settle);
    };
  }, [entries, assistant.chat?.id, owned]);
  const copy = async (id: string, text: string) => {
    if (!owned()) return;
    try {
      await navigator.clipboard.writeText(text);
      if (owned()) {
        setCopyDone(id);
        setCopyError("");
      }
    } catch {
      if (owned())
        setCopyError(
          "Couldn't copy. Select the text and copy it with your device.",
        );
    }
  };
  let previous: string | undefined;
  return (
    <div className="assistant-transcript-wrap">
      {assistant.conversation.error && (
        <ErrorNotice
          message="Couldn't refresh the authorized conversation. Retry before acting on retained messages."
          onRetry={() => void assistant.store.refresh()}
        />
      )}
      {copyError && <ErrorNotice message={copyError} />}
      <div
        className="assistant-transcript"
        ref={node}
        role="region"
        aria-label="Conversation"
        tabIndex={0}
        onMouseUp={selected}
        onKeyUp={selected}
        onTouchEnd={selected}
        onScroll={() => {
          const el = node.current;
          if (!el) return;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setReading(!follow.current);
        }}
      >
        {assistant.conversation.hasEarlier && (
          <Button
            disabled={assistant.conversation.loading}
            onClick={() => void earlier()}
          >
            Earlier messages
          </Button>
        )}
        {!assistant.display.length && !assistant.loading && (
          <section className="assistant-empty">
            <h2>What would you like to work on?</h2>
            <p className="muted">Ask a question or draft work to review.</p>
            <div className="agents-buttons">
              {[
                "What needs my attention today?",
                "Help me plan this week",
                "What should I study next?",
              ].map((text) => (
                <Button
                  key={text}
                  disabled={assistant.sending}
                  onClick={() => assistant.setMessage(text)}
                >
                  {text}
                </Button>
              ))}
            </div>
          </section>
        )}
        {assistant.display.map((item, index) => {
          const entry = entries.find((one) => one.id === item.id),
            date = entry?.created_at,
            label = date ? assistantDateLabel(date, previous, timezone) : null;
          if (date) previous = date;
          const turn = item.kind === "turn" ? item.turn : null,
            text =
              item.kind === "update" ? item.entry.text : (turn?.text ?? "");
          return (
            <div key={item.id}>
              {label && <p className="assistant-date">{label}</p>}
              <article
                className={`assistant-message ${turn?.role === "user" ? "assistant-message-user" : ""}`}
                data-entry={item.id}
                data-sequence={item.sequence ?? undefined}
                tabIndex={-1}
              >
                <div className="agents-row">
                  <strong>
                    {item.kind === "update"
                      ? updateWords(item.entry)
                      : turn?.role === "user"
                        ? "You"
                        : "Assistant"}
                  </strong>
                  {turn?.role === "assistant" && (
                    <span className="muted small">
                      {replyWords({
                        state: turn.state ?? "info",
                        trace: turn.trace ?? [],
                        executionOutcome:
                          turn.executionOutcome ??
                          turn.saved?.execution_outcome,
                        execution: turn.execution,
                      })}
                    </span>
                  )}
                </div>
                {turn?.proposal ? (
                  <ProposalReview
                    proposal={turn.proposal}
                    before={turn.before}
                    state={turn.state}
                    busy={assistant.sending}
                    onApply={(deadlines) =>
                      assistant.decide(turn, true, deadlines)
                    }
                    onDismiss={() => assistant.decide(turn, false)}
                    onFollowUp={
                      index === assistant.display.length - 1
                        ? (text) => assistant.send(text)
                        : undefined
                    }
                    {...links}
                  />
                ) : (
                  <ReplyText text={text} />
                )}
                {(turn?.executionOutcome ?? turn?.saved?.execution_outcome) && (
                  <Evidence
                    receipt={
                      (turn.executionOutcome ?? turn.saved?.execution_outcome)!
                    }
                  />
                )}
                {turn?.saved?.nudge && assistant.chat && turn.turnId && (
                  <Reminder
                    key={turn.saved.nudge.id}
                    card={turn.saved.nudge}
                    chat={assistant.chat.id}
                    turn={turn.turnId}
                    skipped={turn.state === "discarded"}
                  />
                )}
                {(turn?.changesJob ?? turn?.saved?.changes_job) && (
                  <TurnChanges
                    key={turn.changesJob ?? turn.saved?.changes_job}
                    job={(turn.changesJob ?? turn.saved?.changes_job)!}
                  />
                )}
                {!!turn?.trace?.length && (
                  <More summary="Execution trace">
                    <ol>
                      {turn.trace.map((trace, i) => (
                        <li key={`${trace.step}:${i}`}>
                          {traceWords([trace]).join(" · ")} ·{" "}
                          {new Date(trace.at).toLocaleTimeString()}
                        </li>
                      ))}
                    </ol>
                  </More>
                )}
                {item.kind === "update" && item.entry.execution_chat_id && (
                  <Button
                    onClick={() =>
                      owned() && onOpenChat(item.entry.execution_chat_id!)
                    }
                  >
                    View work
                  </Button>
                )}
                <div className="agents-buttons">
                  <Button
                    variant="ghost"
                    onClick={() => void copy(item.id, text)}
                  >
                    {copyDone === item.id ? "Copied" : "Copy"}
                  </Button>
                  {entry && (
                    <>
                      <Button
                        variant="ghost"
                        disabled={
                          assistant.sending || assistant.conversation.error
                        }
                        onClick={() => assistant.setReply({ id: entry.id })}
                      >
                        {entry.kind === "update" &&
                        entry.event === "question" &&
                        entry.waiting_kind === "person" &&
                        entry.actionable !== false
                          ? "Answer"
                          : "Reply"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setDetails(entry.id)}
                      >
                        Details
                      </Button>
                    </>
                  )}
                </div>
              </article>
            </div>
          );
        })}
      </div>
      {selection && (
        <div className="assistant-selection">
          <span>Selected {selection.text.length} characters</span>
          <Button
            disabled={assistant.sending}
            onClick={() => {
              assistant.setReply({ id: selection.id, excerpt: selection.text });
              window.getSelection()?.removeAllRanges();
              setSelection(null);
            }}
          >
            Ask about selection
          </Button>
          <Button variant="ghost" onClick={() => setSelection(null)}>
            Cancel
          </Button>
        </div>
      )}
      {reading && (
        <Button
          className="assistant-latest"
          onClick={() => {
            if (node.current) {
              follow.current = true;
              node.current.scrollTop = node.current.scrollHeight;
              setReading(false);
            }
          }}
        >
          Latest messages
        </Button>
      )}
      {currentDetails && assistant.conversation.destination && (
        <MessageDetails
          key={`${currentDetails.id}:${currentDetails.revision}`}
          destination={assistant.conversation.destination.id}
          entry={currentDetails}
          onClose={() => setDetails(null)}
          onOpenChat={onOpenChat}
        />
      )}
    </div>
  );
}

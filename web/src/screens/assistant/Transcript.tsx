import { useRouteInput, useRouteActivity } from "../../lib/route-scope";
import {
  assistantDateLabel,
  assistantExcerptMatches,
  type AssistantConversationEntry,
} from "@orbyn/core";
import { Bot, Check, Copy, Info, Reply } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, ErrorNotice, IconButton } from "../../ui/kit";
import { useOwned } from "../agents-shared/hooks";
import { Evidence } from "../agents-shared/parts";
import {
  ProposalReview,
  useProposalLinks,
} from "../agents-shared/ProposalReview";
import { ReplyText } from "../agents-shared/ReplyText";
import { replyWords, updateWords } from "../agents-shared/words";
import { LiveWork, TurnTrace, useReveal } from "./Activity";
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
  emptyState,
}: {
  assistant: Assistant;
  timezone: string;
  onOpenChat: (id: string) => void;
  covered: boolean;
  emptyState: ReactNode;
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
  const [work, setWork] = useState<{ started: number; steps: string[] }>({
      started: 0,
      steps: [],
    }),
    [fresh, setFresh] = useState<string | null>(null),
    wasSending = useRef(false);
  const reveal = useReveal(fresh);
  useEffect(() => {
    setDetails(null);
    setSelection(null);
    setReading(false);
    setFresh(null);
    follow.current = true;
  }, [assistant.chat?.id]);
  useEffect(() => {
    if (assistant.sending && !wasSending.current)
      setWork({ started: Date.now(), steps: [] });
    if (!assistant.sending && wasSending.current) {
      // Only the answer that arrived while this page watched is revealed.
      const last = assistant.display[assistant.display.length - 1];
      if (
        last?.kind === "turn" &&
        last.turn.role === "assistant" &&
        !last.turn.proposal &&
        last.turn.text
      )
        setFresh(last.turn.text);
    }
    wasSending.current = assistant.sending;
  }, [assistant.sending, assistant.display]);
  useEffect(() => {
    const label = assistant.progress?.label?.trim();
    if (!label) return;
    setWork((old) =>
      old.steps[old.steps.length - 1] === label
        ? old
        : { ...old, steps: [...old.steps, label] },
    );
  }, [assistant.progress?.label]);
  useLayoutEffect(() => {
    const el = node.current;
    if (!activity.visible || !el) return;
    if (prepend.current && !assistant.conversation.loading) {
      el.scrollTop =
        prepend.current.top + el.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (follow.current) el.scrollTop = el.scrollHeight;
  }, [
    assistant.display,
    assistant.progress,
    activity.visible,
    reveal.text,
    work.steps.length,
  ]);
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
        {!assistant.display.length && !assistant.loading && emptyState}
        {assistant.display.map((item, index) => {
          const entry = entries.find((one) => one.id === item.id),
            date = entry?.created_at,
            label = date ? assistantDateLabel(date, previous, timezone) : null;
          if (date) previous = date;
          const turn = item.kind === "turn" ? item.turn : null,
            text =
              item.kind === "update" ? item.entry.text : (turn?.text ?? "");
          if (turn?.role === "user")
            return (
              <div key={item.id} className="assistant-turn">
                {label && <p className="assistant-date">{label}</p>}
                <article
                  className="assistant-message assistant-message-user"
                  data-entry={item.id}
                  data-sequence={item.sequence ?? undefined}
                  tabIndex={-1}
                  aria-label="You"
                >
                  <ReplyText text={text} />
                </article>
              </div>
            );
          const status = turn
            ? replyWords({
                state: turn.state ?? "info",
                trace: turn.trace ?? [],
                executionOutcome:
                  turn.executionOutcome ?? turn.saved?.execution_outcome,
                execution: turn.execution,
              })
            : undefined;
          const revealing =
            !!turn && !turn.proposal && !reveal.done && text === fresh;
          return (
            <div key={item.id} className="assistant-turn">
              {label && <p className="assistant-date">{label}</p>}
              <article
                className="assistant-message"
                data-entry={item.id}
                data-sequence={item.sequence ?? undefined}
                tabIndex={-1}
                aria-label={
                  item.kind === "update" ? updateWords(item.entry) : "Assistant"
                }
                aria-busy={revealing || undefined}
              >
                <span className="assistant-avatar" aria-hidden="true">
                  <Bot />
                </span>
                <div className="assistant-message-body">
                  {item.kind === "update" && (
                    <p className="assistant-update-label">
                      {updateWords(item.entry)}
                    </p>
                  )}
                  {turn && (
                    <TurnTrace
                      trace={turn.trace ?? []}
                      status={status === "Response ready" ? undefined : status}
                    />
                  )}
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
                  ) : revealing ? (
                    <div className="assistant-revealing">
                      <ReplyText text={reveal.text ?? ""} />
                      <span className="assistant-caret" aria-hidden="true" />
                    </div>
                  ) : (
                    <ReplyText text={text} />
                  )}
                  {(turn?.executionOutcome ??
                    turn?.saved?.execution_outcome) && (
                    <Evidence
                      receipt={
                        (turn.executionOutcome ??
                          turn.saved?.execution_outcome)!
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
                  {item.kind === "update" && item.entry.execution_chat_id && (
                    <Button
                      onClick={() =>
                        owned() && onOpenChat(item.entry.execution_chat_id!)
                      }
                    >
                      View work
                    </Button>
                  )}
                  {!revealing && (
                    <div className="assistant-actions">
                      <IconButton
                        label={copyDone === item.id ? "Copied" : "Copy"}
                        onClick={() => void copy(item.id, text)}
                      >
                        {copyDone === item.id ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Copy aria-hidden="true" />
                        )}
                      </IconButton>
                      {entry && (
                        <>
                          <IconButton
                            label={
                              entry.kind === "update" &&
                              entry.event === "question" &&
                              entry.waiting_kind === "person" &&
                              entry.actionable !== false
                                ? "Answer"
                                : "Reply"
                            }
                            disabled={
                              assistant.sending || assistant.conversation.error
                            }
                            onClick={() => assistant.setReply({ id: entry.id })}
                          >
                            <Reply aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            label="Details"
                            onClick={() => setDetails(entry.id)}
                          >
                            <Info aria-hidden="true" />
                          </IconButton>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </article>
            </div>
          );
        })}
        {assistant.sending && work.started > 0 && (
          <div className="assistant-turn">
            <div className="assistant-message">
              <span className="assistant-avatar" aria-hidden="true">
                <Bot />
              </span>
              <div className="assistant-message-body">
                <LiveWork
                  started={work.started}
                  steps={work.steps}
                  waiting={assistant.progress?.state === "waiting"}
                />
              </div>
            </div>
          </div>
        )}
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

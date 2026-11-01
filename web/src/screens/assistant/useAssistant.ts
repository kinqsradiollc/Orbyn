import { useConfirm } from "../../ui/kit";
import {
  AssistantConversationStore,
  AssistantWaitingReplyLifecycle,
  conversationDisplayItems,
  type AssistantReplyDraft,
  type AssistantRunProgress,
  type ChatResult,
} from "@orbyn/api-client";
import {
  assistantExcerptMatches,
  HttpError,
  newId,
  savedReply,
  readAssistantOutcome,
  type Item,
  type AssistantOutcomeReceipt,
  type AiChat,
  type AssistantConversationDestination,
  type AssistantConversationEntry,
  type ChatScope,
  type ChatTraceEntry,
  type Proposal,
  type SavedChatTurn,
} from "@orbyn/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { client, getSessionVersion, getToken } from "../../lib/session";
import { useNavigate, useBeforeNavigate } from "../../lib/router";
import { useItems, refreshPlanner } from "../shared-task";
import { messageOf } from "../../lib/resource";
import { onForeground, onLive, useOwned } from "../agents-shared/hooks";
import type { ProposalState } from "../agents-shared/ProposalReview";
import { timezone, unclear } from "./state";

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  turnId?: string;
  proposal?: Proposal;
  state?: ProposalState;
  trace?: ChatTraceEntry[];
  saved?: SavedChatTurn;
  before?: Item[];
  changesJob?: string;
  executionOutcome?: AssistantOutcomeReceipt;
  execution?: "stopped" | "timed_out";
};
type Reply = { id: string; excerpt?: string };
const ASK_TOO_LONG =
  "This link contains more than 4,000 characters. Shorten its ask text or type a message; your current draft is unchanged.";
const fromSaved = (saved: SavedChatTurn): Turn => ({
  id: `saved-${saved.turn_id ?? newId()}-${saved.role}`,
  role: saved.role,
  text: saved.text,
  turnId: saved.turn_id,
  saved,
  ...(saved.role === "assistant"
    ? {
        proposal: savedReply(saved, 0),
        state: saved.outcome === "pending" ? "info" : (saved.outcome ?? "info"),
      }
    : {}),
});

function restoredTurns(value: AiChat, retained: Turn[]): Turn[] {
  return value.turns.map((saved) => {
    const cached = retained.find(
      (one) => one.turnId === saved.turn_id && one.role === saved.role,
    );
    return cached
      ? {
          ...cached,
          ...(saved.outcome === "applied" || saved.outcome === "discarded"
            ? { state: saved.outcome }
            : {}),
        }
      : {
          ...fromSaved(saved),
          trace: value.trace.filter((one) => one.turn_id === saved.turn_id),
        };
  });
}

/** Canonical retained history stays in the shared store; this hook owns only the active view and transient drafts. */
export function useAssistant(query: string) {
  const navigate = useNavigate();
  const confirm = useConfirm(),
    normalizing = useRef<string | null>(null);
  const normalizeChat = async (id: string) => {
    const href = `/app/assistant?chat=${encodeURIComponent(id)}`;
    if (normalizing.current === href) return;
    normalizing.current = href;
    try {
      const result = await navigate(href, true);
      if (result.kind === "refused" && owned()) setError(result.reason);
    } finally {
      if (normalizing.current === href) normalizing.current = null;
    }
  };
  const routeQuery = useRef(query);
  routeQuery.current = query;
  const owned = useOwned();
  const items = useItems();
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const liveTurns = useRef(new Map<string, Turn[]>());
  const [store] = useState(
    () => new AssistantConversationStore(client, getSessionVersion),
  );
  const conversation = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [chat, setChat] = useState<AiChat | null>(null);
  const [scope, setScope] = useState<
    (ChatScope & { name: string; disabled?: boolean }) | null
  >(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessageState] = useState("");
  const [reply, setReplyState] = useState<Reply | null>(null);
  const [replyEntry, setReplyEntry] =
    useState<AssistantConversationEntry | null>(null);
  const [replyError, setReplyError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [canonicalEnabled, setCanonicalEnabled] = useState(false);
  const canonical = useRef(false);
  const legacyHome = useRef<string | null>(null);
  const writeRevision = useRef(0);
  const [sending, setSending] = useState(false);
  const [projectUncertain, setProjectUncertain] = useState(false);
  const [progress, setProgress] = useState<AssistantRunProgress | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const drafts = useRef(new Map<string, AssistantReplyDraft>());
  const current = useRef({ chat, message, reply, scope, turns });
  current.current = { chat, message, reply, scope, turns };
  const generation = useRef(0);
  const editing = useRef(0);
  const openingEdit = useRef(0);
  const stagedAsk = useRef(new Set<string>());
  const lock = useRef(false);
  const poll = useRef<AbortController | null>(null);
  const newChatIds = useRef(new Map<string, string>());
  const [persisted, setPersisted] = useState(false);
  const durable = useRef<{
    key: string;
    chatId: string;
    turnId: string;
  } | null>(null);
  const [waiting] = useState(
    () =>
      new AssistantWaitingReplyLifecycle(client, store, {
        binding: () => (owned() && getToken() ? getSessionVersion() : null),
        generation: () => generation.current,
        chatId: () => current.current.chat?.id ?? null,
        drafts: () => drafts.current,
        composer: () => ({
          message: current.current.message,
          replyId: current.current.reply?.id ?? null,
          excerpt: current.current.reply?.excerpt,
        }),
        restoreReply: (id, text) => {
          if (owned()) {
            setMessageState(text);
            setReplyState({ id });
          }
        },
        appendUser: (turnId, text) => {
          const id = `turn-${newId()}`;
          if (owned())
            setTurns((old) => [...old, { id, role: "user", text, turnId }]);
          return id;
        },
        removeUser: (id) => {
          if (owned()) setTurns((old) => old.filter((one) => one.id !== id));
        },
        updateMessage: (update) => {
          if (owned()) setMessageState(update);
        },
        clearReply: (id) => {
          if (owned()) setReplyState((old) => (old?.id === id ? null : old));
        },
        setSending: (value) => {
          lock.current = value;
          if (owned()) setSending(value);
        },
      }),
  );
  const failedAnswers = useSyncExternalStore(
    waiting.subscribe,
    waiting.getSnapshot,
  );
  const setMessage = (value: string) => {
    if (owned()) {
      editing.current++;
      current.current.message = value;
      setMessageState(value);
    }
  };
  const setReply = (value: Reply | null) => {
    if (owned()) {
      current.current.reply = value;
      setReplyState(value);
    }
  };
  const saveDraft = () => {
    const value = current.current;
    if (value.chat) liveTurns.current.set(value.chat.id, value.turns);
    if (value.chat)
      waiting.saveDraft(value.chat.id, {
        message: value.message,
        replyId: value.reply?.id ?? null,
        excerpt: value.reply?.excerpt,
      });
  };
  const accept = (result: ChatResult) => {
    if (!owned()) return;
    const touched = new Set(
      result.proposal.actions.map((action) => action.item_id).filter(Boolean),
    );
    const next: Turn = {
      id: `turn-${newId()}`,
      role: "assistant",
      turnId: result.turn_id,
      text: result.proposal.summary,
      proposal: result.proposal,
      state:
        result.proposal.actions.length || result.proposal.session_change
          ? "pending"
          : "info",
      trace: result.trace.filter((one) => one.turn_id === result.turn_id),
      before: itemsRef.current.filter((item) => touched.has(item.id)),
      changesJob:
        result.assistant_run?.outcome === "applied" &&
        typeof result.assistant_run.plan_job === "string"
          ? result.assistant_run.plan_job
          : undefined,
      executionOutcome: readAssistantOutcome(
        result.assistant_run?.execution_outcome,
      ),
      execution:
        result.assistant_run?.stopped === true
          ? "stopped"
          : result.assistant_run?.timed_out === true
            ? "timed_out"
            : undefined,
    };
    setTurns((old) => {
      const value = [
        ...old.filter(
          (one) => !(one.role === "assistant" && one.turnId === result.turn_id),
        ),
        next,
      ];
      liveTurns.current.set(result.chat_id, value);
      return value;
    });
    // Keep a completed rich proposal across normalization to its durable chat URL.
    liveTurns.current.set(result.chat_id, [
      ...(liveTurns.current.get(result.chat_id) ?? []).filter(
        (one) => !(one.role === "assistant" && one.turnId === result.turn_id),
      ),
      next,
    ]);
    if (canonical.current) void store.refresh();
  };
  const attach = (value: AiChat, mine: number) => {
    const job = value.active_job;
    if (!job || !owned() || mine !== generation.current) return;
    const controller = new AbortController();
    poll.current = controller;
    lock.current = true;
    setSending(true);
    void client
      .pollAssistantRun(
        job.id,
        {
          chatId: value.id,
          turnId:
            [...value.turns].reverse().find((one) => one.role === "user")
              ?.turn_id ?? newId(),
        },
        (p) => {
          if (owned() && mine === generation.current)
            setProgress(p.state === "done" ? null : p);
        },
        controller.signal,
      )
      .then((result) => {
        if (owned() && mine === generation.current) accept(result);
      })
      .catch((failure) => {
        if (
          owned() &&
          mine === generation.current &&
          !controller.signal.aborted
        )
          setError(
            messageOf(
              failure,
              "Couldn't reconnect to this run. Reload to check its saved status.",
            ),
          );
      })
      .finally(() => {
        if (owned() && mine === generation.current) {
          lock.current = false;
          setSending(false);
          setProgress(null);
        }
        if (poll.current === controller) poll.current = null;
      });
  };
  const params = new URLSearchParams(query);
  const destinationKey = JSON.stringify([
    params.get("conversation"),
    params.get("entry"),
    params.get("chat"),
    params.get("task"),
    params.get("project"),
    params.get("fresh"),
  ]);
  useEffect(() => {
    saveDraft();
    const mine = ++generation.current;
    const edit = editing.current;
    openingEdit.current = edit;
    const prior = current.current;
    canonical.current = false;
    setCanonicalEnabled(false);
    poll.current?.abort();
    lock.current = false;
    setPersisted(false);
    setChat(null);
    setScope(null);
    setTurns([]);
    setReplyState(null);
    setReplyEntry(null);
    setReplyError("");
    setProgress(null);
    setSending(false);
    setError("");
    setLoading(true);
    setReady(false);
    setFocused(null);
    store.select(null);
    const abort = new AbortController();
    const valid = () =>
      owned() && mine === generation.current && !abort.signal.aborted;
    void (async () => {
      try {
        if (!valid()) return;
        const q = new URLSearchParams(query),
          destinationId = q.get("conversation"),
          entryId = q.get("entry"),
          chatId = q.get("chat"),
          task = q.get("task"),
          project = q.get("project");
        if (!!destinationId !== !!entryId)
          throw new Error(
            "A conversation link needs both its conversation and entry.",
          );
        if (task && project)
          throw new Error(
            "Choose a task or project destination, rather than combining both.",
          );
        // Capability discovery is separate from resolving an actual destination.
        // Older/default servers retain native chats while canonical delivery is off.
        let home: Awaited<ReturnType<typeof client.assistantConversation>>;
        try {
          home = await client.assistantConversation(abort.signal);
        } catch (failure) {
          if (!valid()) return;
          if (failure instanceof HttpError && failure.statusCode === 404)
            home = { enabled: false, destination: null };
          else throw failure;
        }
        if (!valid()) return;
        canonical.current = home.enabled;
        setCanonicalEnabled(home.enabled);
        if (destinationId && entryId && !home.enabled)
          throw new Error(
            "This conversation-entry link is unavailable on this server. Open a saved chat or start a message instead.",
          );
        let targetChat = chatId,
          sequence: string | null = null,
          destination: AssistantConversationDestination | null = null;
        if (destinationId && entryId) {
          const entry = await client.assistantConversationEntry(
            destinationId,
            entryId,
            abort.signal,
          );
          if (!valid()) return;
          destination = entry.destination;
          if (targetChat && targetChat !== destination.chat_id)
            throw new Error(
              "The chat and conversation links point to different conversations.",
            );
          targetChat = destination.chat_id;
          sequence = entry.sequence;
        }
        let nextScope: typeof scope = null;
        if (task) {
          const item = await client.getItem(task);
          if (!valid()) return;
          nextScope = { kind: "task", id: item.id, name: item.title };
        }
        if (project) {
          const item = await client.getProject(project);
          if (!valid()) return;
          nextScope = {
            kind: "project",
            id: item.id,
            name: item.name,
            disabled: item.assistant_off,
          };
        }
        if (!targetChat && !nextScope && !q.has("fresh")) {
          if (home.enabled) {
            destination =
              home.destination ??
              (await client.openAssistantConversation(abort.signal));
            if (!valid()) return;
            targetChat = destination.chat_id;
          } else targetChat = legacyHome.current;
        }
        if (targetChat) {
          const value = await client.aiChat(targetChat, abort.signal);
          if (!valid()) return;
          if (
            nextScope &&
            (value.scope?.kind !== nextScope.kind ||
              value.scope.id !== nextScope.id)
          )
            throw new Error(
              "This chat belongs to a different scope. Open one destination at a time.",
            );
          if (!nextScope && value.scope) {
            if (value.scope.kind === "project") {
              const p = await client.getProject(value.scope.id);
              if (!valid()) return;
              nextScope = {
                ...value.scope,
                name: p.name,
                disabled: p.assistant_off,
              };
            } else {
              const t = await client.getItem(value.scope.id);
              if (!valid()) return;
              nextScope = { ...value.scope, name: t.title };
            }
          }
          if (home.enabled && !destination) {
            destination = await client.assistantConversationForChat(
              value.id,
              abort.signal,
            );
            if (!valid()) return;
          }
          current.current.chat = value;
          setPersisted(true);
          setChat(value);
          if (!home.enabled && !value.scope) legacyHome.current = value.id;
          setTurns(restoredTurns(value, liveTurns.current.get(value.id) ?? []));
          const draft = drafts.current.get(value.id);
          if (editing.current === edit) {
            setMessageState(
              draft?.message ?? (!prior.chat ? prior.message : ""),
            );
            setReplyState(
              draft?.replyId
                ? { id: draft.replyId, excerpt: draft.excerpt }
                : null,
            );
          }
          if (home.enabled) store.select(destination);
          if (sequence) {
            const revealed = await store.reveal(sequence);
            if (!valid()) return;
            if (!revealed)
              throw new Error(
                "This message is unavailable. Reload or open its current work.",
              );
            setFocused(entryId);
          }
          attach(value, mine);
        } else {
          let id = newChatIds.current.get(destinationKey);
          if (!id) {
            id = newId();
            newChatIds.current.set(destinationKey, id);
          }
          const value: AiChat = {
            id,
            project_id: nextScope?.kind === "project" ? nextScope.id : null,
            project_name: nextScope?.kind === "project" ? nextScope.name : null,
            title: "New chat",
            pinned: false,
            turn_count: 0,
            created_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
            summary_doc_id: null,
            swept_at: null,
            scope: nextScope
              ? { kind: nextScope.kind, id: nextScope.id }
              : null,
            turns: [],
            trace: [],
          };
          current.current.chat = value;
          setChat(value);
          if (editing.current === edit) setMessageState(prior.message);
        }
        if (valid()) {
          setScope(nextScope);
          setReady(true);
        }
      } catch (failure) {
        if (valid())
          setError(
            messageOf(failure, "Couldn't open this conversation. Try again."),
          );
      } finally {
        if (valid()) setLoading(false);
      }
    })();
    return () => {
      abort.abort();
      poll.current?.abort();
      generation.current++;
      waiting.reset();
    };
    // The parsed destination identity, not unrelated panel/ask changes, owns the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationKey, attempt]);
  useEffect(() => {
    if (!ready || !owned()) return;
    const ask = new URLSearchParams(query).get("ask");
    if (ask && ask.length > 4000) {
      setError(ASK_TOO_LONG);
      return;
    }
    setError((old) => (old === ASK_TOO_LONG ? "" : old));
    const key = JSON.stringify([destinationKey, ask]);
    if (ask && !stagedAsk.current.has(key)) {
      stagedAsk.current.add(key);
      if (
        editing.current === openingEdit.current &&
        !current.current.message.trim() &&
        ask.length <= 4000
      )
        setMessage(ask);
    }
  }, [query, ready, owned]);
  useEffect(() => {
    let ticket = 0;
    setReplyEntry(null);
    setReplyError("");
    if (!reply) return;
    if (!canonicalEnabled) {
      setReplyError(
        "Linked replies are unavailable on this server. Cancel this reply to send your retained message without its old target.",
      );
      return;
    }
    if (!conversation.destination) return;
    if (conversation.error) {
      setReplyError(
        "Refresh the conversation before replying to this message.",
      );
      return;
    }
    const id = ++ticket,
      destination = conversation.destination.id;
    void client.assistantConversationDetails(destination, reply.id).then(
      (value) => {
        if (!owned() || id !== ticket) return;
        const text =
          value.entry.kind === "turn"
            ? value.entry.turn.text
            : value.entry.text;
        if (reply.excerpt && !assistantExcerptMatches(text, reply.excerpt)) {
          setReplyError(
            "The selected words changed. Select a current excerpt or cancel this reply.",
          );
          return;
        }
        setReplyEntry(value.entry);
      },
      () => {
        if (owned() && id === ticket)
          setReplyError(
            "This reply target is unavailable. Retry or cancel the reply.",
          );
      },
    );
    return () => {
      ticket++;
    };
  }, [
    reply,
    canonicalEnabled,
    conversation.destination?.id,
    conversation.error,
    conversation.entries.find((one) => one.id === reply?.id)?.revision,
    attempt,
    owned,
  ]);
  useEffect(() => {
    const refresh = () => {
      if (owned() && canonical.current && !document.hidden)
        void store.refresh();
    };
    const off = onLive((news) => {
      if (news.kind === "changed") refresh();
    });
    const fg = onForeground(refresh),
      timer = setInterval(refresh, 15000);
    return () => {
      off();
      fg();
      clearInterval(timer);
      store.reset();
    };
  }, [store, owned]);
  useEffect(() => {
    if (!canonicalEnabled || !chat || !persisted) return;
    const stop = waiting.follow(chat.id, {
      isActive: () => owned() && canonical.current && !document.hidden,
      onNews: onLive,
      onForeground,
      every: (fn, ms) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
    });
    return () => {
      stop();
      waiting.reset();
    };
  }, [canonicalEnabled, chat?.id, persisted, owned, waiting]);
  useEffect(() => {
    if (canonicalEnabled || !chat || !persisted) return;
    const id = chat.id,
      mine = generation.current;
    let live = true,
      pending = false;
    const refresh = async () => {
      if (
        !live ||
        !owned() ||
        canonical.current ||
        document.hidden ||
        lock.current ||
        pending
      )
        return;
      pending = true;
      const revision = writeRevision.current;
      try {
        const value = await client.aiChat(id);
        if (
          !live ||
          !owned() ||
          mine !== generation.current ||
          canonical.current ||
          lock.current ||
          revision !== writeRevision.current
        )
          return;
        setChat(value);
        setTurns(restoredTurns(value, current.current.turns));
      } catch (failure) {
        if (
          !live ||
          !owned() ||
          mine !== generation.current ||
          revision !== writeRevision.current ||
          lock.current
        )
          return;
        saveDraft();
        setChat(null);
        setTurns([]);
        setReady(false);
        setError(
          messageOf(
            failure,
            "Couldn't refresh this saved chat. Your message draft is kept. Reload to check its current access.",
          ),
        );
      } finally {
        pending = false;
      }
    };
    const fg = onForeground(() => void refresh()),
      off = onLive((news) => {
        if (news.kind === "changed") void refresh();
      }),
      timer = setInterval(() => void refresh(), 15000);
    return () => {
      live = false;
      fg();
      off();
      clearInterval(timer);
    };
  }, [canonicalEnabled, chat?.id, persisted, owned]);
  const send = async (text = current.current.message, projectDraft = false) => {
    if (
      !owned() ||
      !ready ||
      lock.current ||
      !current.current.chat ||
      !text.trim() ||
      text.trim().length > 4000 ||
      scope?.disabled ||
      replyError ||
      (reply && !replyEntry)
    )
      return;
    const selected = replyEntry
      ? { ...replyEntry, excerpt: reply?.excerpt }
      : null;
    if (waiting.isQuestion(selected)) {
      try {
        await waiting.answer(selected, text.trim());
      } catch (failure) {
        if (owned())
          setError(
            messageOf(
              failure,
              "Couldn't send this answer. Your draft is kept.",
            ),
          );
      }
      return;
    }
    if (projectDraft && (scope || projectUncertain)) return;
    lock.current = true;
    writeRevision.current++;
    setSending(true);
    setError("");
    const mine = generation.current,
      value = current.current,
      trimmed = text.trim();
    const key = JSON.stringify([
      value.chat!.id,
      trimmed,
      value.reply,
      projectDraft,
    ]);
    if (durable.current?.key !== key)
      durable.current = { key, chatId: value.chat!.id, turnId: newId() };
    const ids = durable.current;
    const userId = `turn-${newId()}`,
      controller = new AbortController();
    poll.current = controller;
    const edit = editing.current;
    setTurns((old) => [
      ...old,
      { id: userId, role: "user", text: trimmed, turnId: ids.turnId },
    ]);
    setMessageState("");
    setReplyState(null);
    try {
      let result: ChatResult;
      if (projectDraft) {
        const proposal = await client.draftProject(trimmed, timezone());
        result = {
          proposal,
          chat_id: ids.chatId,
          turn_id: ids.turnId,
          trace: [],
        };
      } else
        result = await client.chat(
          trimmed,
          timezone(),
          value.turns.slice(-12).map((one) => ({
            role: one.role,
            content: (one.saved?.history_text ?? one.text).slice(0, 12000),
          })),
          value.scope ? { kind: value.scope.kind, id: value.scope.id } : null,
          {
            chatId: ids.chatId,
            turnId: ids.turnId,
            replyToEntryId: value.reply?.id,
            replyExcerpt: value.reply?.excerpt,
          },
          (p) => {
            if (owned() && mine === generation.current) {
              setProgress(p.state === "done" ? null : p);
              if (
                p.state !== "done" &&
                new URLSearchParams(routeQuery.current).get("chat") !==
                  ids.chatId
              )
                void normalizeChat(ids.chatId);
            }
          },
          controller.signal,
        );
      if (!owned() || mine !== generation.current) return;
      accept(result);
      if (!projectDraft) setPersisted(true);
      durable.current = null;
      if (!projectDraft) {
        if (
          new URLSearchParams(routeQuery.current).get("chat") !== result.chat_id
        ) {
          await normalizeChat(result.chat_id);
          return;
        }
        if (canonical.current) {
          const dest = await client.assistantConversationForChat(
            result.chat_id,
          );
          if (!owned() || mine !== generation.current) return;
          store.select(dest);
        }
      }
    } catch (failure) {
      if (!owned() || mine !== generation.current) return;
      setTurns((old) => old.filter((one) => one.id !== userId));
      setMessageState((draft) =>
        editing.current === edit && !draft ? trimmed : `${trimmed}\n\n${draft}`,
      );
      setReplyState((old) => old ?? value.reply);
      if (projectDraft && unclear(failure)) {
        setProjectUncertain(true);
        setError(
          "The project draft outcome is unconfirmed. Your text is kept. Check Review before requesting another draft.",
        );
      } else
        setError(
          messageOf(
            failure,
            projectDraft
              ? "Couldn't draft the project. Your text is kept."
              : "Couldn't send. Your draft is kept; retry checks the same turn.",
          ),
        );
    } finally {
      if (poll.current === controller) poll.current = null;
      if (owned() && mine === generation.current) {
        lock.current = false;
        setSending(false);
        setProgress(null);
      }
    }
  };
  const runAction = async (
    action: "stop" | "answer" | "approve" | "decline",
    answer = "",
    approval: "once" | "goal" | "routine" | "always" = "once",
  ) => {
    const run = progress;
    if (!owned() || !run || run.state === "done") return;
    const mine = generation.current;
    // The transport's send lock stays held while waiting; action has its own exact identity lock.
    if (actionLock.current) return;
    actionLock.current = true;
    writeRevision.current++;
    try {
      if (action === "stop") await client.stopAssistantRun(run.job_id);
      else if (run.waiting) {
        if (action === "answer" && run.waiting.kind === "person")
          await client.answerAssistantRun(run.job_id, answer, run.waiting.id);
        else if (run.waiting.kind === "approval")
          await client.approveAssistantRun(
            run.job_id,
            action === "approve",
            run.waiting.id,
            approval,
          );
      }
      if (owned() && mine === generation.current)
        setProgress({
          ...run,
          label:
            action === "stop"
              ? "Cancellation requested"
              : "Response sent · Waiting for current status",
        });
    } catch (failure) {
      if (owned() && mine === generation.current)
        setError(
          messageOf(
            failure,
            "Couldn't confirm this response. Refresh the run before trying again.",
          ),
        );
      throw failure;
    } finally {
      actionLock.current = false;
    }
  };
  const actionLock = useRef(false);
  const decide = async (turn: Turn, apply: boolean, deadlines = true) => {
    if (
      !owned() ||
      !turn.proposal ||
      turn.state !== "pending" ||
      !current.current.chat
    )
      throw new Error("This reply is no longer pending.");
    const mine = generation.current,
      chatId = current.current.chat.id;
    writeRevision.current++;
    if (apply) {
      await client.applyProposal(turn.proposal.id, {
        give_tasks_deadlines: deadlines,
      });
      if (!owned() || mine !== generation.current) return;
      setTurns((old) =>
        old.map((one) =>
          one.id === turn.id ? { ...one, state: "applied" } : one,
        ),
      );
      try {
        await client.updateAiChat(chatId, {
          turn_id: turn.turnId,
          outcome: "applied",
        });
      } catch {
        if (owned() && mine === generation.current)
          setError(
            "Changes were applied. The saved chat outcome could not be updated; refresh before another decision.",
          );
      }
      if (owned() && mine === generation.current) await refreshPlanner();
    } else {
      await client.updateAiChat(chatId, {
        turn_id: turn.turnId,
        outcome: "discarded",
      });
      if (!owned() || mine !== generation.current) return;
      setTurns((old) =>
        old.map((one) =>
          one.id === turn.id ? { ...one, state: "discarded" } : one,
        ),
      );
    }
    if (!owned() || mine !== generation.current) return;
    if (canonical.current) await store.refresh();
  };
  const exitState = useRef({ sending, projectUncertain, failedAnswers });
  exitState.current = { sending, projectUncertain, failedAnswers };
  const checkingLeave = useRef(false);
  const prepareLeave = useCallback(
    async (to: string) => {
      if (!owned()) return false;
      if (normalizing.current === to) return true;
      const state = exitState.current;
      if (
        lock.current ||
        actionLock.current ||
        state.sending ||
        state.projectUncertain ||
        checkingLeave.current
      )
        return false;
      // Same mounted Assistant keeps its per-chat draft/failed-answer owners when selecting history.
      if (to.split(/[?#]/)[0] === "/app/assistant") return true;
      if (state.failedAnswers.length) return false;
      const hasDraft = () =>
        !!current.current.message.trim() ||
        !!current.current.reply ||
        [...drafts.current.values()].some(
          (draft) => draft.message.trim() || draft.replyId,
        );
      if (!hasDraft()) return true;
      checkingLeave.current = true;
      try {
        return (
          (await confirm({
            title: "Discard unsent Assistant drafts?",
            body: "Saved conversations and their outcomes stay available.",
            action: "Discard drafts",
            danger: true,
          })) &&
          owned() &&
          !lock.current &&
          !actionLock.current &&
          !exitState.current.sending &&
          !exitState.current.projectUncertain &&
          !exitState.current.failedAnswers.length
        );
      } finally {
        checkingLeave.current = false;
      }
    },
    [owned, confirm],
  );
  useBeforeNavigate(prepareLeave);
  return {
    chat,
    scope,
    message,
    setMessage,
    reply,
    setReply,
    replyEntry,
    replyError,
    turns,
    conversation,
    store,
    loading,
    ready,
    canonicalEnabled,
    error,
    setError,
    sending,
    projectUncertain,
    progress,
    focused,
    failedAnswers,
    waiting,
    send,
    runAction,
    decide,
    reload: () => setAttempt((n) => n + 1),
    display: conversationDisplayItems(conversation, turns, fromSaved),
  };
}

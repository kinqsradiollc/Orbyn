import { useEffect, useRef, useState } from "react";
import {
  HttpError,
  newId,
  proposalNote,
  savedReply,
  type ChatTurn,
  type ChatScope,
  type ChatTraceEntry,
  type ReminderNudgeCard,
  type Item,
  type Proposal,
  type AiChatSummary,
  type PersonalAgentSettings,
} from "@orbyn/core";
import { client } from "../lib/api";
import { onLive } from "../lib/live";
import type { AssistantRunProgress, ChatResult } from "@orbyn/api-client";
import type { Planner } from "./usePlanner";

/** What happened to an assistant reply's proposed changes. */
export type TurnState = "pending" | "applied" | "discarded" | "info";

export type Turn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      proposal: Proposal;
      nudge?: ReminderNudgeCard;
      state: TurnState;
      /** The items this reply changes, as they were when it arrived. */
      before: Item[];
      /** Stable server key for this user/assistant turn pair. */
      turnId: string;
      /** Content-free steps the assistant took to answer. */
      trace: ChatTraceEntry[];
      /**
       * The job id of what this reply applied directly (from the server's
       * `assistant_run.plan_job`), for listing and undoing it; null otherwise.
       */
      changesJob: string | null;
    };

export type AssistantScope = ChatScope & { name: string };

/** How long the chat search waits for typing to pause before asking. */
const SEARCH_DELAY_MS = 250;

/** The job a finished run applied, from the reply's `assistant_run`. */
function appliedJob(run: Record<string, unknown> | undefined): string | null {
  return run?.outcome === "applied" && typeof run.plan_job === "string"
    ? run.plan_job
    : null;
}

const CHAT_STORAGE_KEY = "orbyn-assistant-chat";
const saveAssistantChat = (id: string | null) => {
  try {
    if (id) localStorage.setItem(CHAT_STORAGE_KEY, id);
    else localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    /* The chat remains usable without browser storage. */
  }
};
const loadAssistantChat = async () => {
  try {
    return localStorage.getItem(CHAT_STORAGE_KEY);
  } catch {
    return null;
  }
};

let sequence = 0;
const nextId = () => `turn-${++sequence}`;

/**
 * A conversation with the assistant. Earlier turns are sent back as history so
 * follow-ups ("and tomorrow?") have context. Each reply's proposed changes are
 * approved or discarded on their own.
 */
export function useAssistant({
  token,
  act,
  refresh,
  items,
}: Pick<Planner, "token" | "act" | "refresh" | "items">) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [runProgress, setRunProgress] = useState<AssistantRunProgress | null>(
    null,
  );
  const [scope, setScopeState] = useState<AssistantScope | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const sending = useRef(false);
  const generation = useRef(0);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Every assistant conversation has a durable id from its first question.
  const chatId = useRef<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [savedChats, setSavedChats] = useState<AiChatSummary[] | null>(null);
  const [chatSearch, setChatSearch] = useState("");
  const chatSearchRef = useRef(chatSearch);
  chatSearchRef.current = chatSearch;
  // Only the newest chat list request may set the list.
  const chatsRequest = useRef(0);
  // The running question's poll, stopped when the conversation is left.
  const poll = useRef<AbortController | null>(null);
  const [identity, setIdentity] = useState<PersonalAgentSettings | null>(null);

  const loadChats = () => {
    const request = ++chatsRequest.current;
    return client.aiChats({ search: chatSearchRef.current }).then(
      (list) => {
        if (request === chatsRequest.current) setSavedChats(list);
      },
      () => {
        if (request === chatsRequest.current) setSavedChats([]);
      },
    );
  };

  useEffect(() => {
    if (!token) return;
    return onLive((news) => {
      if (news.kind !== "changed" || (news.area && news.area !== "assistant"))
        return;
      void loadChats();
      const id = chatId.current;
      const request = generation.current;
      if (!id) return;
      void client
        .aiChat(id)
        .then((chat) => {
          if (chatId.current !== id || generation.current !== request) return;
          setTurns((current) => {
            const seen = new Set(
              current
                .filter((t) => t.role === "assistant")
                .map((t) => t.turnId),
            );
            const added = chat.turns.flatMap((t, n): Turn[] =>
              t.role === "assistant" &&
              t.nudge &&
              t.turn_id &&
              !seen.has(t.turn_id)
                ? [
                    {
                      id: t.turn_id + "-assistant",
                      role: "assistant",
                      proposal: savedReply(t, n) as Proposal,
                      nudge: t.nudge,
                      state:
                        t.outcome === "pending"
                          ? "info"
                          : (t.outcome ?? "info"),
                      before: [],
                      turnId: t.turn_id,
                      trace: [],
                      changesJob: null,
                    },
                  ]
                : [],
            );
            return added.length ? [...current, ...added] : current;
          });
        })
        .catch(() => {});
    });
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setSavedChats(null);
        void loadChats();
      },
      chatSearch ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      chatsRequest.current += 1;
    };
  }, [chatSearch, token]);

  const stopPolling = () => {
    poll.current?.abort();
    poll.current = null;
  };

  /** Leave the conversation: stop its poll and start an empty one. */
  const clearConversation = (forget = true) => {
    if (forget) void saveAssistantChat(null);
    generation.current += 1;
    stopPolling();
    sending.current = false;
    setThinking(false);
    setRunProgress(null);
    setTurns([]);
    setMessage("");
    chatId.current = null;
    setActiveChatId(null);
  };

  useEffect(() => {
    let live = true;
    setIdentity(null);
    if (!token) return;
    void client
      .agentSettings()
      .then((value) => live && setIdentity(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token]);

  const previousToken = useRef(token);
  // A cleared session (sign out or 401) also drops the conversation.
  useEffect(() => {
    clearConversation(!!previousToken.current && !token);
    previousToken.current = token;
    setScopeState(null);
    scopeRef.current = null;
    return () => {
      generation.current += 1;
      stopPolling();
    };
  }, [token]);

  const history = (): ChatTurn[] =>
    turnsRef.current
      .map((t): ChatTurn =>
        t.role === "user"
          ? { role: "user", content: t.text }
          : {
              role: "assistant",
              // Tell the model what happened to this reply's changes so it
              // never re-proposes them (chat turns are capped at 12,000 chars).
              content: [
                t.proposal.summary,
                proposalNote(
                  t.proposal.actions,
                  t.state,
                  Object.fromEntries(t.before.map((i) => [i.id, i.title])),
                ),
              ]
                .filter(Boolean)
                .join("\n\n")
                .slice(0, 12000),
            },
      )
      .slice(-12);

  const acceptResult = (result: ChatResult) => {
    const { proposal } = result;
    const touched = new Set(
      proposal.actions.map((a) => a.item_id).filter((id): id is string => !!id),
    );
    const state =
      proposal.actions.length || proposal.session_change ? "pending" : "info";
    const reply: Turn = {
      id: nextId(),
      role: "assistant",
      proposal,
      state,
      before: itemsRef.current.filter((i) => touched.has(i.id)),
      turnId: result.turn_id,
      // The chat's trace covers every turn; keep this reply's steps only.
      trace: result.trace.filter((entry) => entry.turn_id === result.turn_id),
      changesJob: appliedJob(result.assistant_run),
    };
    setTurns((t) => [
      ...t.filter(
        (turn) => turn.role !== "assistant" || turn.turnId !== result.turn_id,
      ),
      reply,
    ]);
    if (state !== "pending")
      void client
        .updateAiChat(result.chat_id, {
          turn_id: result.turn_id,
          outcome: state,
        })
        .then(loadChats)
        .catch(() => undefined);
    else void loadChats();
  };

  const ask = (text: string = message) => {
    const trimmed = text.trim();
    if (!trimmed || sending.current) return Promise.resolve();
    sending.current = true;
    const request = generation.current;
    const prior = history();
    chatId.current ??= newId();
    const requestedChatId = chatId.current;
    setActiveChatId(requestedChatId);
    void saveAssistantChat(requestedChatId);
    const requestedTurnId = newId();
    stopPolling();
    const controller = new AbortController();
    poll.current = controller;
    const userTurn: Turn = { id: nextId(), role: "user", text: trimmed };
    setTurns((t) => [...t, userTurn]);
    setMessage("");
    setThinking(true);
    return (async () => {
      try {
        const result = await client.chat(
          trimmed,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          prior,
          scopeRef.current && {
            kind: scopeRef.current.kind,
            id: scopeRef.current.id,
          },
          { chatId: requestedChatId, turnId: requestedTurnId },
          (progress) => {
            // A run left behind (new scope, chat or session) stays out of view.
            if (request !== generation.current) return;
            setRunProgress(progress.state === "done" ? null : progress);
            setThinking(progress.state === "running");
          },
          controller.signal,
        );
        if (request !== generation.current) return;
        chatId.current = result.chat_id;
        acceptResult(result);
      } catch (error) {
        if (request !== generation.current) return;
        // Nothing typed is lost: the message goes back in the box and act() shows the error.
        setTurns((t) => t.filter((x) => x.id !== userTurn.id));
        setMessage((draft) => (draft ? `${trimmed}\n\n${draft}` : trimmed));
        await act(async () => {
          throw error;
        });
      } finally {
        if (poll.current === controller) poll.current = null;
        if (request === generation.current) {
          sending.current = false;
          setThinking(false);
          setRunProgress(null);
        }
      }
    })();
  };

  const answerWaiting = (answer: string) => {
    const run = runProgress;
    if (!run || run.state !== "waiting" || run.waiting?.kind !== "person")
      return Promise.resolve();
    return act(async () => {
      await client.answerAssistantRun(run.job_id, answer);
      setTurns((current) => [
        ...current,
        { id: nextId(), role: "user", text: answer },
      ]);
      setRunProgress({
        ...run,
        state: "running",
        label: "Continuing with your answer",
      });
      setThinking(true);
    });
  };

  const approveWaiting = (
    approved: boolean,
    scope: "once" | "goal" | "routine" | "always" = "once",
  ) => {
    const run = runProgress;
    if (!run || run.state !== "waiting" || run.waiting?.kind !== "approval")
      return Promise.resolve();
    return act(async () => {
      await client.approveAssistantRun(run.job_id, approved, scope);
      setRunProgress({
        ...run,
        state: "running",
        label: approved
          ? scope === "once"
            ? "Applying the approved plan"
            : "Saving approval and applying the plan"
          : "Holding the plan",
      });
      setThinking(true);
    });
  };

  const stopRun = () => {
    const run = runProgress;
    if (!run || run.state === "done") return Promise.resolve();
    return act(async () => {
      await client.stopAssistantRun(run.job_id);
      setRunProgress({ ...run, state: "running", label: "Stopping the run" });
      setThinking(true);
    });
  };

  /** Draft a project (subtasks) from the prompt, as a reviewable proposal. */
  const draftProject = (text: string = message) => {
    const trimmed = text.trim();
    if (!trimmed || sending.current) return Promise.resolve();
    sending.current = true;
    const request = generation.current;
    const userTurn: Turn = {
      id: nextId(),
      role: "user",
      text: `Draft a project: ${trimmed}`,
    };
    setTurns((t) => [...t, userTurn]);
    setMessage("");
    setThinking(true);
    return act(async () => {
      try {
        const proposal = await client.draftProject(
          trimmed,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
        if (request !== generation.current) return;
        setTurns((t) => [
          ...t,
          {
            id: nextId(),
            role: "assistant",
            proposal,
            state:
              proposal.actions.length || proposal.session_change
                ? "pending"
                : "info",
            before: [],
            turnId: newId(),
            trace: [],
            changesJob: null,
          },
        ]);
      } catch (error) {
        if (request !== generation.current) return;
        setTurns((t) => t.filter((x) => x.id !== userTurn.id));
        setMessage((draft) => (draft ? `${trimmed}\n\n${draft}` : trimmed));
        throw error;
      } finally {
        if (request === generation.current) {
          sending.current = false;
          setThinking(false);
        }
      }
    });
  };

  const latestPending = () =>
    [...turnsRef.current]
      .reverse()
      .find((t) => t.role === "assistant" && t.state === "pending");

  const setState = (id: string, state: TurnState) =>
    setTurns((t) =>
      t.map((x) =>
        x.id === id && x.role === "assistant" ? { ...x, state } : x,
      ),
    );

  /** Approve a reply's changes; defaults to the most recent pending one. */
  const apply = (turnId?: unknown, giveTasksDeadlines = true) => {
    const id = typeof turnId === "string" ? turnId : latestPending()?.id;
    const turn = turnsRef.current.find((t) => t.id === id);
    if (!turn || turn.role !== "assistant" || turn.state !== "pending")
      return Promise.resolve();
    return act(async () => {
      await client.applyProposal(turn.proposal.id, {
        give_tasks_deadlines: giveTasksDeadlines,
      });
      setState(turn.id, "applied");
      if (chatId.current)
        await client
          .updateAiChat(chatId.current, {
            turn_id: turn.turnId,
            outcome: "applied",
          })
          .catch(() => undefined);
      await refresh();
    });
  };

  /** Discard a reply's changes; defaults to the most recent pending one. */
  const dismiss = (turnId?: unknown) => {
    const id = typeof turnId === "string" ? turnId : latestPending()?.id;
    if (!id) return;
    const turn = turnsRef.current.find((t) => t.id === id);
    setState(id, "discarded");
    if (turn?.role === "assistant" && chatId.current)
      void client
        .updateAiChat(chatId.current, {
          turn_id: turn.turnId,
          outcome: "discarded",
        })
        .then(loadChats)
        .catch(() => undefined);
  };

  /** Start a new chat; does nothing while a question is still running. */
  const reset = () => {
    if (sending.current) return;
    clearConversation();
  };

  /** Pick up any saved assistant chat where it was left. */
  const openChat = async (id: string) => {
    clearConversation(false);
    const request = generation.current;
    let chat: Awaited<ReturnType<typeof client.aiChat>> | undefined;
    while (request === generation.current) {
      try {
        chat = await client.aiChat(id);
        break;
      } catch (error) {
        const transient =
          error instanceof HttpError
            ? error.statusCode === 429 || error.statusCode >= 500
            : error instanceof Error &&
              ["TypeError", "TimeoutError", "AbortError"].includes(error.name);
        if (!transient) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
    if (!chat || request !== generation.current) return;
    chatId.current = chat.id;
    setActiveChatId(chat.id);
    void saveAssistantChat(chat.id);
    const nextScope = chat.scope
      ? {
          ...chat.scope,
          name:
            chat.scope.kind === "project"
              ? (chat.project_name ?? chat.title)
              : chat.title,
        }
      : null;
    scopeRef.current = nextScope;
    setScopeState(nextScope);
    setMessage("");
    setTurns(
      chat.turns.map((t, n): Turn =>
        t.role === "user"
          ? { id: `${t.turn_id ?? nextId()}-user`, role: "user", text: t.text }
          : {
              id: `${t.turn_id ?? nextId()}-assistant`,
              role: "assistant",
              proposal: savedReply(t, n) as Proposal,
              nudge: t.nudge,
              state: t.outcome === "pending" ? "info" : (t.outcome ?? "info"),
              before: [],
              turnId: t.turn_id ?? newId(),
              trace: chat.trace.filter((entry) => entry.turn_id === t.turn_id),
              changesJob: t.changes_job ?? null,
            },
      ),
    );
    if (chat.active_job) {
      const job = chat.active_job;
      const controller = new AbortController();
      poll.current = controller;
      sending.current = true;
      setThinking(job.state !== "waiting");
      void client
        .pollAssistantRun(
          job.id,
          {
            chatId: chat.id,
            turnId:
              [...chat.turns].reverse().find((turn) => turn.role === "user")
                ?.turn_id ?? newId(),
          },
          (progress) => {
            if (request !== generation.current) return;
            setRunProgress(progress.state === "done" ? null : progress);
            setThinking(progress.state === "running");
          },
          controller.signal,
        )
        .then((result) => {
          if (request === generation.current) acceptResult(result);
        })
        .catch((error) => {
          if (request === generation.current && !controller.signal.aborted)
            void act(async () => {
              throw error;
            });
        })
        .finally(() => {
          if (poll.current === controller) poll.current = null;
          if (request === generation.current) {
            sending.current = false;
            setThinking(false);
            setRunProgress(null);
          }
        });
    }
    void loadChats();
  };

  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request = generation.current;
    const restore = async (id: string) => {
      if (disposed || request !== generation.current) return;
      const opening = openChat(id);
      request = generation.current;
      try {
        await opening;
      } catch (error) {
        if (disposed || request !== generation.current) return;
        if (
          error instanceof HttpError &&
          [403, 404].includes(error.statusCode)
        ) {
          void saveAssistantChat(null);
          return;
        }
        // A temporary outage must not forget the person's running chat.
        timer = setTimeout(() => void restore(id), 10000);
      }
    };
    void loadAssistantChat().then((id) => {
      if (id) void restore(id);
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const deleteChat = async (id: string) => {
    await client.deleteProjectChat(id);
    // Deleting the open chat starts a new, empty one, so its turns aren't
    // shown or sent as history with the next question.
    if (chatId.current === id) clearConversation();
    setSavedChats((list) => list?.filter((c) => c.id !== id) ?? null);
  };

  /** What a reply applied directly (see `Turn.changesJob`). */
  const turnChanges = (job: string) =>
    client.assistantJobChanges(job).then((r) => r.changes);

  /** Undo everything a reply applied, then reload the planner. */
  const undoTurnChanges = async (job: string) => {
    const { grantId } = await client.assistantJobChanges(job);
    if (!grantId) throw new Error("There is nothing here to undo.");
    const { undone } = await client.undoAgentJob(grantId, job);
    await refresh();
    return undone;
  };

  const renameChat = async (id: string, title: string) => {
    await client.updateAiChat(id, { title });
    await loadChats();
  };

  const pinChat = async (id: string, pinned: boolean) => {
    await client.updateAiChat(id, { pinned });
    await loadChats();
  };

  const keepChatAsNote = async (id: string) => {
    const note = await client.saveChatAsNote(id);
    await loadChats();
    return note;
  };

  const setScope = (next: AssistantScope | null) => {
    if (
      scopeRef.current?.kind === next?.kind &&
      scopeRef.current?.id === next?.id
    )
      return;
    clearConversation();
    scopeRef.current = next;
    setScopeState(next);
    void loadChats();
  };

  const pending = latestPending();
  return {
    message,
    setMessage,
    turns,
    thinking,
    runProgress,
    answerWaiting,
    approveWaiting,
    stopRun,
    scope,
    setScope,
    /** The most recent reply still awaiting approval, if any. */
    proposal: pending && pending.role === "assistant" ? pending.proposal : null,
    ask,
    draftProject,
    apply,
    dismiss,
    reset,
    /** Saved chats about the scoped project, newest first (null: loading). */
    savedChats,
    activeChatId,
    chatSearch,
    searchChats: setChatSearch,
    openChat,
    deleteChat,
    renameChat,
    pinChat,
    keepChatAsNote,
    turnChanges,
    undoTurnChanges,
    /** The person's assistant settings (null until loaded). */
    identity,
    setIdentity,
    /** The name the person gave their assistant. */
    agentName: identity?.name || "Orbyn",
  };
}

export type Assistant = ReturnType<typeof useAssistant>;

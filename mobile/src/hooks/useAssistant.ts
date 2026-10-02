import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  HttpError,
  characterState,
  newId,
  planOutcome,
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
import { loadAssistantChat, saveAssistantChat } from "../lib/session";
import type { AssistantRunProgress, ChatResult } from "@orbyn/api-client";

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
      /** Whether the schedule in `proposal.plan` has been applied. */
      planApplied: boolean;
      /**
       * What applying it did, in words ("Planned 3 tasks today · Moved 1
       * session before its deadline."), once applied here.
       */
      planResult?: string;
      /** Where the applied plan's first changed session starts, for "Show on calendar". */
      planAt?: string | null;
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

type Options = {
  /** Current session token; the conversation is dropped when it clears. */
  token: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  /** Current planner items, snapshotted when a reply arrives. */
  items: Item[];
};

/** How long the chat search waits for typing to pause before asking. */
const SEARCH_DELAY_MS = 250;

/** The job a finished run applied, from the reply's `assistant_run`. */
function appliedJob(run: Record<string, unknown> | undefined): string | null {
  return run?.outcome === "applied" && typeof run.plan_job === "string"
    ? run.plan_job
    : null;
}

let sequence = 0;
const nextId = () => `turn-${++sequence}`;

/**
 * A conversation with the assistant. Earlier turns are sent back as history so
 * follow-ups have context; each reply's changes are approved or discarded on
 * their own.
 */
export function useAssistant({ token, act, refresh, items }: Options) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [restoringChat, setRestoringChat] = useState<string | null>(null);
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
  const [characterOutcome, setCharacterOutcome] = useState<
    "done" | "error" | "interrupted" | null
  >(null);
  const [customizingCharacter, setCustomizingCharacter] = useState(false);
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
                      planApplied: false,
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
    setRestoringChat(null);
    poll.current?.abort();
    poll.current = null;
  };

  /** Leave the conversation: stop its poll and start an empty one. */
  const clearConversation = (forget = true) => {
    setCharacterOutcome(null);
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
    let revision = 0;
    setIdentity(null);
    setCustomizingCharacter(false);
    if (!token) return;
    const load = () => {
      const current = ++revision;
      void client
        .agentSettings({ fresh: true })
        .then((value) => {
          if (live && current === revision) setIdentity(value);
        })
        .catch(() => undefined);
    };
    const unsubscribe = client.onAgentSettings((value) => {
      revision += 1;
      if (live) setIdentity(value);
    });
    load();
    const foreground = AppState.addEventListener("change", (next) => {
      if (next === "active") load();
    });
    return () => {
      live = false;
      unsubscribe();
      foreground.remove();
    };
  }, [token]);

  const previousToken = useRef(token);
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
    setCharacterOutcome(
      result.assistant_run?.stopped
        ? "interrupted"
        : result.assistant_run?.timed_out
          ? "error"
          : "done",
    );
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
      planApplied: !!proposal.plan?.applied,
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
    const request = ++generation.current;
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
    setCharacterOutcome(null);
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
        setCharacterOutcome("error");
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
    const request = generation.current;
    const waitingId = run.waiting.id;
    return act(async () => {
      try {
        await client.answerAssistantRun(run.job_id, answer, waitingId);
      } catch (error) {
        if (request === generation.current) {
          setCharacterOutcome("error");
          throw error;
        }
        return;
      }
      if (request !== generation.current) return;
      setTurns((current) => [
        ...current,
        { id: nextId(), role: "user", text: answer },
      ]);
      setRunProgress({
        ...run,
        state: "running",
        label: "Continuing with your answer",
      });
      setCharacterOutcome(null);
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
    const request = generation.current;
    const waitingId = run.waiting.id;
    return act(async () => {
      try {
        await client.approveAssistantRun(
          run.job_id,
          approved,
          waitingId,
          scope,
        );
      } catch (error) {
        if (request === generation.current) {
          setCharacterOutcome("error");
          throw error;
        }
        return;
      }
      if (request !== generation.current) return;
      setRunProgress({
        ...run,
        state: "running",
        label: approved
          ? scope === "once"
            ? "Applying the approved plan"
            : "Saving approval and applying the plan"
          : "Holding the plan",
      });
      setCharacterOutcome(null);
      setThinking(true);
    });
  };

  const stopRun = () => {
    const run = runProgress;
    if (!run || run.state === "done") return Promise.resolve();
    const request = generation.current;
    return act(async () => {
      try {
        await client.stopAssistantRun(run.job_id);
      } catch (error) {
        if (request === generation.current) {
          setCharacterOutcome("error");
          throw error;
        }
        return;
      }
      if (request !== generation.current) return;
      setRunProgress({ ...run, state: "running", label: "Stopping the run" });
      setCharacterOutcome(null);
      setThinking(true);
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
  const discard = (turnId?: unknown) => {
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

  /**
   * Save the schedule a reply planned (its sessions) to the calendar, moving
   * the late sessions ticked (`moves`; the planner's choice when omitted).
   */
  const applyPlan = (turnId: string, moves?: string[]) => {
    const turn = turnsRef.current.find((t) => t.id === turnId);
    if (!turn || turn.role !== "assistant" || !turn.proposal.plan)
      return Promise.resolve();
    const plan = turn.proposal.plan;
    return act(async () => {
      const result = await client.applyPlan(plan.id, moves ? { moves } : {});
      const planResult = planOutcome(result, plan.at_risk);
      const planAt =
        [...result.blocks, ...result.moved].map((b) => b.start_at).sort()[0] ??
        null;
      setTurns((t) =>
        t.map((x) =>
          x.id === turnId && x.role === "assistant"
            ? { ...x, planApplied: true, planResult, planAt }
            : x,
        ),
      );
      await refresh();
    });
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
    const restoring = new AbortController();
    poll.current = restoring;
    setRestoringChat("Opening your saved chat…");
    let chat: Awaited<ReturnType<typeof client.aiChat>> | undefined;
    while (request === generation.current) {
      try {
        chat = await client.aiChat(id, restoring.signal);
        break;
      } catch (error) {
        if (restoring.signal.aborted || request !== generation.current) return;
        const transient =
          error instanceof HttpError
            ? error.statusCode === 429 || error.statusCode >= 500
            : error instanceof Error &&
              ["TypeError", "TimeoutError", "AbortError"].includes(error.name);
        if (!transient) {
          setRestoringChat(null);
          throw error;
        }
        setRestoringChat("Your chat could not be loaded. Retrying…");
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            restoring.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 10000);
          restoring.signal.addEventListener("abort", finish, { once: true });
          if (restoring.signal.aborted) finish();
        });
      }
    }
    if (!chat || request !== generation.current) return;
    setRestoringChat(null);
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
              planApplied: false,
              turnId: t.turn_id ?? newId(),
              trace: chat.trace.filter((entry) => entry.turn_id === t.turn_id),
              changesJob: t.changes_job ?? null,
            },
      ),
    );
    if (chat.active_job) {
      const job = chat.active_job;
      stopPolling();
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
          if (request === generation.current && !controller.signal.aborted) {
            setCharacterOutcome("error");
            void act(async () => {
              throw error;
            });
          }
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
    if (poll.current === restoring) poll.current = null;
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
    restoringChat,
    runProgress,
    answerWaiting,
    approveWaiting,
    stopRun,
    scope,
    setScope,
    /** The most recent reply still awaiting approval, if any. */
    proposal: pending && pending.role === "assistant" ? pending.proposal : null,
    ask,
    apply,
    applyPlan,
    discard,
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
    customizingCharacter,
    setCustomizingCharacter,
    characterState: characterState({
      thinking,
      runState: runProgress?.state,
      needsApproval: !!pending,
      outcome: characterOutcome,
    }),
    /** The name the person gave their assistant. */
    agentName: identity?.name || "Orbyn",
  };
}

export type Assistant = ReturnType<typeof useAssistant>;

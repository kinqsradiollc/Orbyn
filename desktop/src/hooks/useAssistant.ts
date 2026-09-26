import { useEffect, useRef, useState } from "react";
import {
  proposalNote,
  type ChatTurn,
  type ChatScope,
  type Item,
  type Proposal,
} from "@orbyn/core";
import { client } from "../lib/api";
import type { Planner } from "./usePlanner";

/** What happened to an assistant reply's proposed changes. */
export type TurnState = "pending" | "applied" | "discarded" | "info";

export type Turn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      proposal: Proposal;
      state: TurnState;
      /** The items this reply changes, as they were when it arrived. */
      before: Item[];
    };

export type AssistantScope = ChatScope & { name: string };

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
  const [scope, setScopeState] = useState<AssistantScope | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const sending = useRef(false);
  const generation = useRef(0);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // A cleared session (sign out or 401) also drops the conversation.
  useEffect(() => {
    generation.current += 1;
    sending.current = false;
    setThinking(false);
    setTurns([]);
    setMessage("");
    setScopeState(null);
    scopeRef.current = null;
    return () => {
      generation.current += 1;
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

  const ask = (text: string = message) => {
    const trimmed = text.trim();
    if (!trimmed || sending.current) return Promise.resolve();
    sending.current = true;
    const request = generation.current;
    const prior = history();
    const userTurn: Turn = { id: nextId(), role: "user", text: trimmed };
    setTurns((t) => [...t, userTurn]);
    setMessage("");
    setThinking(true);
    return act(async () => {
      try {
        const proposal = await client.chat(
          trimmed,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          prior,
          scopeRef.current && {
            kind: scopeRef.current.kind,
            id: scopeRef.current.id,
          },
        );
        if (request !== generation.current) return;
        const touched = new Set(
          proposal.actions
            .map((a) => a.item_id)
            .filter((id): id is string => !!id),
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
            before: itemsRef.current.filter((i) => touched.has(i.id)),
          },
        ]);
      } catch (error) {
        if (request !== generation.current) return;
        // Nothing typed is lost: the message goes back in the box and act() shows the error.
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
      await refresh();
    });
  };

  /** Discard a reply's changes; defaults to the most recent pending one. */
  const dismiss = (turnId?: unknown) => {
    const id = typeof turnId === "string" ? turnId : latestPending()?.id;
    if (id) setState(id, "discarded");
  };

  const reset = () => {
    if (sending.current) return;
    setTurns([]);
    setMessage("");
  };

  const setScope = (next: AssistantScope | null) => {
    if (
      scopeRef.current?.kind === next?.kind &&
      scopeRef.current?.id === next?.id
    )
      return;
    generation.current += 1;
    sending.current = false;
    setThinking(false);
    scopeRef.current = next;
    setScopeState(next);
    setTurns([]);
    setMessage("");
  };

  const pending = latestPending();
  return {
    message,
    setMessage,
    turns,
    thinking,
    scope,
    setScope,
    /** The most recent reply still awaiting approval, if any. */
    proposal: pending && pending.role === "assistant" ? pending.proposal : null,
    ask,
    draftProject,
    apply,
    dismiss,
    reset,
  };
}

export type Assistant = ReturnType<typeof useAssistant>;

import { useEffect, useRef, useState } from "react";
import {
  planOutcome,
  proposalNote,
  type ChatTurn,
  type ChatScope,
  type Item,
  type Proposal,
} from "@orbyn/core";
import { client } from "../lib/api";

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
      /** Whether the schedule in `proposal.plan` has been applied. */
      planApplied: boolean;
      /**
       * What applying it did, in words ("Planned 3 tasks today · Moved 1
       * session before its deadline."), once applied here.
       */
      planResult?: string;
      /** Where the applied plan's first changed session starts, for "Show on calendar". */
      planAt?: string | null;
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
  const [scope, setScopeState] = useState<AssistantScope | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const sending = useRef(false);
  const generation = useRef(0);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
            planApplied: !!proposal.plan?.applied,
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
  const discard = (turnId?: unknown) => {
    const id = typeof turnId === "string" ? turnId : latestPending()?.id;
    if (id) setState(id, "discarded");
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
    apply,
    applyPlan,
    discard,
    reset,
  };
}

export type Assistant = ReturnType<typeof useAssistant>;

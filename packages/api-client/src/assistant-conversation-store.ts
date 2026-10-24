import type {
  AssistantConversationDestination,
  AssistantConversationEntry,
  SavedChatTurn,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";

type Client = Pick<
  OrbynClient,
  "assistantConversationFeed" | "acknowledgeAssistantConversation"
>;
export type AssistantConversationSnapshot = {
  destination: AssistantConversationDestination | null;
  entries: AssistantConversationEntry[];
  confirmedTurnKeys: ReadonlySet<string>;
  loading: boolean;
  error: boolean;
  hasEarlier: boolean;
};
const turnKey = (role: string, id: string) => `${role}:${id}`;

/** Account-bound, ephemeral display history; foreground polling has separate ownership. */
export class AssistantConversationStore {
  private state: AssistantConversationSnapshot = {
    destination: null,
    entries: [],
    confirmedTurnKeys: new Set(),
    loading: false,
    error: false,
    hasEarlier: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private binding: unknown;
  private lower = "0";
  private pending: Promise<void> | null = null;
  private ackPending: Promise<void> | null = null;
  private abort: AbortController | null = null;
  constructor(
    private client: Client,
    private sessionBinding: () => unknown = () => null,
  ) {
    this.binding = sessionBinding();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: AssistantConversationSnapshot) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  reset = () => {
    this.generation++;
    this.binding = this.sessionBinding();
    this.abort?.abort();
    this.abort = null;
    this.pending = null;
    this.ackPending = null;
    this.lower = "0";
    this.publish({
      destination: null,
      entries: [],
      confirmedTurnKeys: new Set(),
      loading: false,
      error: false,
      hasEarlier: false,
    });
  };
  select = (destination: AssistantConversationDestination | null) => {
    if (this.binding !== this.sessionBinding()) this.reset();
    if (destination?.id === this.state.destination?.id) return;
    this.reset();
    if (!destination) return;
    this.lower = (
      BigInt(destination.last_sequence) > 50n
        ? BigInt(destination.last_sequence) - 50n
        : 0n
    ).toString();
    this.publish({
      ...this.state,
      destination,
      hasEarlier: this.lower !== "0",
    });
    void this.refresh();
  };
  refresh = (): Promise<void> => {
    if (this.binding !== this.sessionBinding()) {
      this.reset();
      return Promise.resolve();
    }
    if (this.pending) return this.pending;
    const destination = this.state.destination;
    if (!destination) return Promise.resolve();
    const generation = this.generation,
      binding = this.binding;
    const abort = (this.abort = new AbortController());
    const valid = () =>
      generation === this.generation && binding === this.sessionBinding();
    this.publish({ ...this.state, loading: true });
    this.pending = (async () => {
      try {
        let after = this.lower,
          upper: string | undefined;
        let current = destination;
        const entries: AssistantConversationEntry[] = [];
        for (;;) {
          const page = await this.client.assistantConversationFeed(
            destination.id,
            after,
            100,
            abort.signal,
            upper,
          );
          if (!valid()) {
            if (generation === this.generation) this.reset();
            return;
          }
          upper ??= page.destination.last_sequence;
          current = page.destination;
          entries.push(...page.entries);
          if (!page.has_more) break;
          if (BigInt(page.cursor) <= BigInt(after))
            throw new Error("Conversation page did not advance.");
          after = page.cursor;
        }
        const confirmed = new Set(this.state.confirmedTurnKeys);
        for (const entry of entries)
          if (entry.kind === "turn")
            confirmed.add(turnKey(entry.turn.role, entry.turn_id));
        // Replace rather than merge: revoked entries and changed summaries disappear/update.
        this.publish({
          destination: current,
          entries,
          confirmedTurnKeys: confirmed,
          loading: false,
          error: false,
          hasEarlier: this.lower !== "0",
        });
      } catch {
        if (valid())
          this.publish({
            ...this.state,
            entries: [],
            loading: false,
            error: true,
          });
      } finally {
        if (generation === this.generation) {
          this.pending = null;
          this.abort = null;
        }
      }
    })();
    return this.pending;
  };
  loadEarlier = async () => {
    const generation = this.generation;
    await this.pending;
    if (
      generation !== this.generation ||
      !this.state.destination ||
      this.binding !== this.sessionBinding()
    )
      return;
    this.lower = (
      BigInt(this.lower) > 50n ? BigInt(this.lower) - 50n : 0n
    ).toString();
    return this.refresh();
  };
  reveal = async (sequence: string) => {
    const generation = this.generation;
    await this.pending;
    if (
      generation !== this.generation ||
      !this.state.destination ||
      this.binding !== this.sessionBinding()
    )
      return false;
    if (BigInt(sequence) <= BigInt(this.lower))
      this.lower = (BigInt(sequence) - 1n).toString();
    await this.refresh();
    return (
      generation === this.generation &&
      !this.state.error &&
      this.state.entries.some((entry) => entry.sequence === sequence)
    );
  };
  /** Call only for a sequence actually displayed in the active conversation. */
  acknowledge = async (through: string): Promise<void> => {
    const destination = this.state.destination;
    if (!destination || BigInt(through) <= BigInt(destination.read_sequence))
      return;
    if (this.binding !== this.sessionBinding()) {
      this.reset();
      return;
    }
    if (this.ackPending) {
      const generation = this.generation;
      await this.ackPending;
      if (generation !== this.generation) return;
      return this.acknowledge(through);
    }
    const generation = this.generation,
      binding = this.binding;
    this.ackPending = this.client
      .acknowledgeAssistantConversation(destination.id, through)
      .then((updated) => {
        if (
          generation === this.generation &&
          binding === this.sessionBinding()
        ) {
          const current = this.state.destination;
          if (!current || updated.id !== current.id) return;
          this.publish({
            ...this.state,
            destination: {
              ...current,
              last_sequence:
                BigInt(updated.last_sequence) > BigInt(current.last_sequence)
                  ? updated.last_sequence
                  : current.last_sequence,
              read_sequence:
                BigInt(updated.read_sequence) > BigInt(current.read_sequence)
                  ? updated.read_sequence
                  : current.read_sequence,
            },
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (generation === this.generation) this.ackPending = null;
      });
    await this.ackPending;
  };
}

export type ConversationDisplayItem<T> =
  | { kind: "turn"; id: string; sequence: string | null; turn: T }
  | {
      kind: "update";
      id: string;
      sequence: string;
      entry: Extract<AssistantConversationEntry, { kind: "update" }>;
    };
/** Keep live proposals/optimistic turns without letting stale local copies restore a revoked entry. */
export function conversationDisplayItems<
  T extends { id: string; role: "user" | "assistant"; turnId?: string },
>(
  snapshot: AssistantConversationSnapshot,
  local: T[],
  fromSaved: (turn: SavedChatTurn) => T,
): ConversationDisplayItem<T>[] {
  if (!snapshot.destination)
    return local.map((turn) => ({
      kind: "turn",
      id: turn.id,
      sequence: null,
      turn,
    }));
  // Foreground turns are owned by their independently authorized submit/poll
  // transport. A failed background feed must not erase those unconfirmed turns,
  // or restore committed history whose current permissions could not be checked.
  if (snapshot.error)
    return local
      .filter(
        (turn) =>
          turn.id.startsWith("turn-") &&
          !snapshot.confirmedTurnKeys.has(
            turn.turnId ? turnKey(turn.role, turn.turnId) : turn.id,
          ),
      )
      .map((turn) => ({
        kind: "turn" as const,
        id: turn.id,
        sequence: null,
        turn,
      }));
  const byKey = new Map(
    local
      .filter((turn) => turn.turnId)
      .map((turn) => [turnKey(turn.role, turn.turnId!), turn]),
  );
  const visible = new Set<string>();
  const items: ConversationDisplayItem<T>[] = snapshot.entries.map((entry) => {
    if (entry.kind === "update")
      return { kind: "update", id: entry.id, sequence: entry.sequence, entry };
    const key = turnKey(entry.turn.role, entry.turn_id);
    visible.add(key);
    const live = byKey.get(key);
    const terminal =
      entry.turn.outcome === "applied" || entry.turn.outcome === "discarded";
    return {
      kind: "turn",
      id: entry.id,
      sequence: entry.sequence,
      // Another device may have resolved this proposal since the local chat loaded.
      turn: live
        ? terminal && "state" in live
          ? { ...live, state: entry.turn.outcome }
          : live
        : fromSaved(entry.turn),
    };
  });
  for (const turn of local) {
    const key = turn.turnId ? turnKey(turn.role, turn.turnId) : turn.id;
    if (
      turn.id.startsWith("turn-") &&
      !visible.has(key) &&
      !snapshot.confirmedTurnKeys.has(key)
    )
      items.push({ kind: "turn", id: turn.id, sequence: null, turn });
  }
  return items;
}

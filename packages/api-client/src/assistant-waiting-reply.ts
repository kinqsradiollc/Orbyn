import { newId, type AssistantConversationEntry } from "@orbyn/core";
import type { OrbynClient, LiveNews } from "./client.js";
import type { AssistantConversationStore } from "./assistant-conversation-store.js";

export type AssistantReplyDraft = {
  message: string;
  replyId: string | null;
  excerpt?: string;
};
export type AssistantFailedAnswer = {
  id: string;
  chatId: string;
  questionId: string;
  text: string;
};
const NO_FAILURES: readonly AssistantFailedAnswer[] = [];
type Reply = AssistantConversationEntry & { excerpt?: string };
type Question = Extract<AssistantConversationEntry, { kind: "update" }> & {
  excerpt?: string;
};
type Ports = {
  binding(): unknown | null;
  generation(): unknown;
  chatId(): string | null;
  drafts(): Map<string, AssistantReplyDraft>;
  composer(): AssistantReplyDraft;
  restoreReply(questionId: string, text: string): void;
  appendUser(turnId: string, text: string): string;
  removeUser(id: string): void;
  updateMessage(update: (draft: string) => string): void;
  clearReply(id: string): void;
  setSending(sending: boolean): void;
};
type Follow = {
  isActive(): boolean;
  onNews(listener: (news: LiveNews) => void): () => void;
  onForeground?(listener: () => void): () => void;
  every?(listener: () => void, milliseconds: number): () => void;
};

/** Ephemeral answer attempts and reconnect leases. The conversation store owns history. */
export class AssistantWaitingReplyLifecycle {
  private attempts = new Map<string, string>();
  private accepted = new Set<string>();
  private pending = new Map<unknown, Promise<void>>();
  private epoch = 0;
  private account: unknown = null;
  private failures = new Map<string, AssistantFailedAnswer>();
  private failuresSnapshot: readonly AssistantFailedAnswer[] = NO_FAILURES;
  private listeners = new Set<() => void>();
  private draftRevisions = new Map<string, number>();
  private draftOwners = new Map<
    string,
    { chatId: string; questionId: string; revision?: number }
  >();
  private stopFollow: (() => void) | null = null;
  constructor(
    private client: Pick<
      OrbynClient,
      "answerAssistantConversationQuestion" | "assistantConversationForChat"
    >,
    private conversation: AssistantConversationStore,
    private ports: Ports,
    private id = newId,
  ) {
    this.account = ports.binding();
  }
  getSnapshot = () =>
    this.ports.binding() === this.account ? this.failuresSnapshot : NO_FAILURES;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publishFailures() {
    this.failuresSnapshot = [...this.failures.values()];
    for (const listener of this.listeners) listener();
  }
  /** Capture a platform draft without giving a pending answer ownership of later edits. */
  saveDraft(chatId: string, draft: AssistantReplyDraft) {
    const revision = (this.draftRevisions.get(chatId) ?? 0) + 1;
    this.draftRevisions.set(chatId, revision);
    this.ports.drafts().set(chatId, draft);
    for (const owner of this.draftOwners.values())
      if (
        owner.chatId === chatId &&
        owner.revision === undefined &&
        draft.replyId === owner.questionId &&
        !draft.excerpt
      )
        owner.revision = revision;
  }
  canRestore = (id: string) => {
    const failed = this.failures.get(id);
    const composer = this.ports.composer();
    return (
      !!failed &&
      this.account != null &&
      this.account === this.ports.binding() &&
      this.ports.chatId() === failed.chatId &&
      !composer.message.trim() &&
      !composer.excerpt &&
      (!composer.replyId || composer.replyId === failed.questionId)
    );
  };
  restore = (id: string) => {
    if (!this.canRestore(id)) return false;
    const failed = this.failures.get(id)!;
    // Resolve the source again through the existing authorized reply lookup.
    this.saveDraft(failed.chatId, {
      message: failed.text,
      replyId: failed.questionId,
    });
    this.ports.restoreReply(failed.questionId, failed.text);
    this.failures.delete(id);
    this.publishFailures();
    return true;
  };
  isQuestion(reply: Reply | null): reply is Question {
    return (
      reply?.kind === "update" && reply.event === "question" && !reply.excerpt
    );
  }
  reset() {
    this.epoch++;
    this.attempts.clear();
    this.accepted.clear();
    this.pending.clear();
    this.draftOwners.clear();
    this.draftRevisions.clear();
    this.failures.clear();
    this.publishFailures();
    this.stopFollow?.();
  }
  answer(question: Question, text: string): Promise<void> {
    const binding = this.ports.binding();
    if (binding !== this.account) {
      this.reset();
      this.account = binding;
    }
    const view = this.ports.generation();
    if (binding == null) return Promise.resolve();
    const pending = this.pending.get(view);
    if (pending) return pending;
    const destination = this.conversation.getSnapshot().destination;
    if (!destination || destination.chat_id !== this.ports.chatId())
      return Promise.resolve();
    const key = JSON.stringify([destination.id, question.id, text]);
    const previous = this.attempts.get(key);
    if (
      !previous &&
      (question.actionable === false || question.waiting_kind !== "person")
    )
      return Promise.reject(
        new Error(
          question.waiting_kind === "approval"
            ? "Open this request in Review."
            : "This question changed or was answered. Refresh before answering.",
        ),
      );
    const turnId = previous ?? this.id();
    this.attempts.set(key, turnId);
    const draftOwner = {
      chatId: destination.chat_id,
      questionId: question.id,
      revision: undefined as number | undefined,
    };
    this.draftOwners.set(turnId, draftOwner);
    const epoch = this.epoch;
    const current = () =>
      epoch === this.epoch && binding === this.ports.binding();
    const user = this.ports.appendUser(turnId, text);
    this.ports.setSending(true);
    this.ports.updateMessage(() => "");
    const prepend = (draft: string) => (draft ? `${text}\n\n${draft}` : text);
    const promise = Promise.resolve().then(async () => {
      try {
        // Dispatch may be deferred by the caller; recheck the live session here too.
        if (!current()) return;
        await this.client.answerAssistantConversationQuestion(
          destination.id,
          question.id,
          text,
          turnId,
        );
        if (!current()) return;
        this.accepted.add(turnId);
        if (this.failures.delete(turnId)) this.publishFailures();
        this.attempts.delete(key);
        if (view !== this.ports.generation()) {
          const draft = this.ports.drafts().get(destination.chat_id);
          if (
            draft?.replyId === question.id &&
            !draft.excerpt &&
            draftOwner.revision !== undefined &&
            this.draftRevisions.get(destination.chat_id) === draftOwner.revision
          )
            this.ports
              .drafts()
              .set(destination.chat_id, { ...draft, replyId: null });
          return;
        }
        this.ports.clearReply(question.id);
        await this.conversation.refresh();
      } catch (error) {
        if (!current() || this.accepted.has(turnId)) return;
        const composer = this.ports.composer();
        const sameDraft =
          view === this.ports.generation() &&
          this.ports.chatId() === destination.chat_id &&
          composer.replyId === question.id &&
          !composer.excerpt;
        if (!sameDraft) {
          // A later chat capture must never overwrite this recovery, nor may
          // a late failure replace a newer target, excerpt or composer.
          this.failures.set(turnId, {
            id: turnId,
            chatId: destination.chat_id,
            questionId: question.id,
            text,
          });
          this.publishFailures();
          if (view === this.ports.generation()) this.ports.removeUser(user);
          return;
        }
        this.ports.removeUser(user);
        this.ports.updateMessage(prepend);
        throw error;
      } finally {
        if (this.draftOwners.get(turnId) === draftOwner)
          this.draftOwners.delete(turnId);
        if (this.pending.get(view) === promise) this.pending.delete(view);
        if (current() && view === this.ports.generation())
          this.ports.setSending(false);
      }
    });
    this.pending.set(view, promise);
    return promise;
  }
  follow(chatId: string, adapters: Follow): () => void {
    this.stopFollow?.();
    const binding = this.ports.binding();
    if (binding !== this.account) {
      this.reset();
      this.account = binding;
    }
    const epoch = this.epoch;
    const abort = new AbortController();
    let live = true;
    let looking = false;
    const current = () =>
      live &&
      binding != null &&
      binding === this.ports.binding() &&
      epoch === this.epoch &&
      chatId === this.ports.chatId();
    const update = () => {
      if (!current() || !adapters.isActive()) return;
      const destination = this.conversation.getSnapshot().destination;
      if (destination?.chat_id === chatId) {
        void this.conversation.refresh();
        return;
      }
      if (looking) return;
      looking = true;
      void this.client
        .assistantConversationForChat(chatId, abort.signal)
        .then((destination) => {
          if (current()) this.conversation.select(destination);
        })
        .catch(() => undefined)
        .finally(() => {
          looking = false;
        });
    };
    const stopTimer = adapters.every
      ? adapters.every(update, 3000)
      : (() => {
          const timer = setInterval(update, 3000);
          return () => clearInterval(timer);
        })();
    const stopNews = adapters.onNews((news) => {
      if (news.kind === "changed" && (!news.area || news.area === "assistant"))
        update();
    });
    const stopForeground = adapters.onForeground?.(update);
    const stop = () => {
      if (!live) return;
      live = false;
      abort.abort();
      stopTimer();
      stopNews();
      stopForeground?.();
      if (this.stopFollow === stop) {
        this.stopFollow = null;
        this.conversation.reset();
      }
    };
    this.stopFollow = stop;
    update();
    return stop;
  }
}

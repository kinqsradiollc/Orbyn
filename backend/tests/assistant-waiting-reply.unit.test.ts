import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  AssistantWaitingReplyLifecycle,
  AssistantConversationStore,
  type OrbynClient,
  type LiveNews,
  type AssistantReplyDraft,
} from "@orbyn/api-client";
import type { AssistantConversationEntry } from "@orbyn/core";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const destination = {
    id: randomUUID(),
    chat_id: randomUUID(),
    personal: true,
    last_sequence: "1",
    read_sequence: "0",
  };
  const question = {
    id: randomUUID(),
    kind: "update",
    event: "question",
    actionable: true,
    waiting_kind: "person",
  } as Extract<AssistantConversationEntry, { kind: "update" }>;
  let binding: string | null = "A:1",
    generation = 0,
    chat: string | null = destination.chat_id;
  let message = "answer",
    sending = false,
    selected: string | null = question.id;
  let excerpt: string | undefined;
  let entries: AssistantConversationEntry[] = [],
    feedCalls = 0,
    lookupCalls = 0;
  const turns: { id: string; turnId: string; text: string }[] = [];
  const drafts = new Map<string, AssistantReplyDraft>();
  const requests: {
    turnId: string;
    answer: string;
    pending: ReturnType<typeof deferred>;
  }[] = [];
  const lookup = deferred<typeof destination>();
  let news: ((news: LiveNews) => void) | undefined,
    foreground: (() => void) | undefined;
  const client = {
    assistantConversationFeed: async () => {
      feedCalls++;
      return { destination, entries, cursor: "1", has_more: false };
    },
    acknowledgeAssistantConversation: async () => destination,
    assistantConversationForChat: () => {
      lookupCalls++;
      return lookup.promise;
    },
    answerAssistantConversationQuestion: (
      _d: string,
      _q: string,
      answer: string,
      turnId: string,
    ) => {
      const pending = deferred();
      requests.push({ turnId, answer, pending });
      return pending.promise;
    },
  } as unknown as OrbynClient;
  const store = new AssistantConversationStore(client, () => binding);
  store.select(destination);
  const ports = {
    binding: () => binding,
    generation: () => generation,
    chatId: () => chat,
    drafts: () => drafts,
    composer: () => ({ message, replyId: selected, excerpt }),
    restoreReply: (questionId: string, text: string) => {
      selected = questionId;
      message = text;
      excerpt = undefined;
    },
    appendUser: (turnId: string, text: string) => {
      const id = randomUUID();
      turns.push({ id, turnId, text });
      return id;
    },
    removeUser: (id: string) => {
      const at = turns.findIndex((turn) => turn.id === id);
      if (at >= 0) turns.splice(at, 1);
    },
    updateMessage: (update: (draft: string) => string) => {
      message = update(message);
    },
    clearReply: (id: string) => {
      if (selected === id) selected = null;
    },
    setSending: (value: boolean) => {
      sending = value;
    },
  };
  const lifecycle = new AssistantWaitingReplyLifecycle(client, store, ports);
  return {
    lifecycle,
    client,
    store,
    question,
    destination,
    requests,
    drafts,
    turns,
    lookup,
    get message() {
      return message;
    },
    get sending() {
      return sending;
    },
    get selected() {
      return selected;
    },
    get feedCalls() {
      return feedCalls;
    },
    get lookupCalls() {
      return lookupCalls;
    },
    switchAccount(value: string | null) {
      binding = value;
    },
    setComposer(text: string, target: string | null, quote?: string) {
      message = text;
      selected = target;
      excerpt = quote;
    },
    open(id: string) {
      if (chat)
        lifecycle.saveDraft(chat, { message, replyId: selected, excerpt });
      generation++;
      chat = id;
      const draft = drafts.get(id);
      message = draft?.message ?? "";
      selected = draft?.replyId ?? null;
      excerpt = draft?.excerpt;
    },
    advanceTurn() {
      generation++;
    },
    leave() {
      generation++;
      chat = randomUUID();
    },
    entries(value: AssistantConversationEntry[]) {
      entries = value;
    },
    restart() {
      const restoredStore = new AssistantConversationStore(
        client,
        () => binding,
      );
      return {
        store: restoredStore,
        lifecycle: new AssistantWaitingReplyLifecycle(
          client,
          restoredStore,
          ports,
        ),
      };
    },
    follow() {
      return lifecycle.follow(destination.chat_id, {
        isActive: () => true,
        onNews: (listener) => {
          news = listener;
          return () => {
            news = undefined;
          };
        },
        onForeground: (listener) => {
          foreground = listener;
          return () => {
            foreground = undefined;
          };
        },
      });
    },
    news(value: LiveNews) {
      news?.(value);
    },
    foreground() {
      foreground?.();
    },
  };
}
test("double answer coalesces; optimistic turn settles through the existing store", async () => {
  const f = fixture();
  await tick();
  const first = f.lifecycle.answer(f.question, "answer");
  assert.equal(f.lifecycle.answer(f.question, "different"), first);
  assert.equal(f.turns.length, 1);
  assert.equal(f.message, "");
  assert.equal(f.sending, true);
  await tick();
  assert.equal(f.requests.length, 1);
  f.requests[0].pending.resolve();
  await first;
  assert.equal(f.selected, null);
  assert.equal(f.sending, false);
  assert.equal(f.feedCalls, 2);
});
test("lost response restores draft; retry keeps its exact answer identity even if feed marks question answered", async () => {
  const f = fixture();
  const first = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.requests[0].pending.reject(new Error("lost response"));
  await assert.rejects(first, /lost response/);
  assert.equal(f.message, "answer");
  assert.equal(f.turns.length, 0);
  const retry = f.lifecycle.answer(
    { ...f.question, actionable: false, waiting_kind: null },
    "answer",
  );
  await tick();
  assert.equal(f.requests[1].turnId, f.requests[0].turnId);
  f.requests[1].pending.resolve();
  await retry;
});
test("account switch before render/effect blocks dispatch and late success/error cannot mutate new account", async () => {
  for (const rejected of [false, true]) {
    const f = fixture();
    const pending = f.lifecycle.answer(f.question, "answer");
    await tick();
    f.switchAccount("B:2");
    if (rejected) f.requests[0].pending.reject(new Error("old account"));
    else f.requests[0].pending.resolve();
    await pending;
    assert.equal(f.selected, f.question.id);
    assert.equal(f.message, "");
    assert.equal(f.feedCalls, 1);
  }
  const f = fixture();
  f.switchAccount(null);
  await f.lifecycle.answer(f.question, "answer");
  assert.equal(f.turns.length, 0);
  assert.equal(f.requests.length, 0);
});
test("same-account detached success clears reply only; detached failure recovers original chat draft", async () => {
  for (const rejected of [false, true]) {
    const f = fixture();
    const pending = f.lifecycle.answer(f.question, "answer");
    await tick();
    f.lifecycle.saveDraft(f.destination.chat_id, {
      message: "next",
      replyId: f.question.id,
    });
    f.leave();
    if (rejected) f.requests[0].pending.reject(new Error("interrupted"));
    else f.requests[0].pending.resolve();
    await pending;
    assert.deepEqual(f.drafts.get(f.destination.chat_id), {
      message: "next",
      replyId: rejected ? f.question.id : null,
    });
    assert.equal(f.selected, f.question.id);
  }
});
test("unmount reset fences interrupted callbacks and clears ephemeral retry ownership", async () => {
  const f = fixture();
  const pending = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.lifecycle.reset();
  f.requests[0].pending.reject(new Error("late"));
  await pending;
  assert.equal(f.message, "");
  assert.equal(f.drafts.size, 0);
});
test("reconnect refreshes authorized feed; old events and lookup results cannot select after account switch", async () => {
  const f = fixture();
  await tick();
  const stop = f.follow();
  await tick();
  const before = f.feedCalls;
  f.news({ kind: "changed", area: "assistant" } as LiveNews);
  await tick();
  assert.equal(f.feedCalls, before + 1);
  f.foreground();
  await tick();
  assert.equal(f.feedCalls, before + 2);
  f.switchAccount("B:2");
  f.news({ kind: "changed" } as LiveNews);
  await tick();
  assert.equal(f.feedCalls, before + 2);
  stop();
  const g = fixture();
  g.store.reset();
  const finish = g.follow();
  await tick();
  assert.equal(g.lookupCalls, 1);
  g.foreground();
  await tick();
  assert.equal(g.lookupCalls, 1);
  g.switchAccount("B:2");
  g.lookup.resolve(g.destination);
  await tick();
  assert.equal(g.store.getSnapshot().destination, null);
  finish();
});
test("restart uses server feed as authority and never automatically replays an answer", async () => {
  const f = fixture();
  await tick();
  f.entries([
    { ...f.question, actionable: false, waiting_kind: null },
    {
      kind: "turn",
      id: randomUUID(),
      turn_id: randomUUID(),
      turn: { role: "user", text: "answer" },
      sequence: "2",
    } as AssistantConversationEntry,
  ]);
  const restarted = f.restart();
  f.lookup.resolve(f.destination);
  const stop = restarted.lifecycle.follow(f.destination.chat_id, {
    isActive: () => true,
    onNews: () => () => {},
  });
  await tick();
  const restored = restarted.store.getSnapshot().entries[0];
  assert.equal(restored.id, f.question.id);
  const recovered = restarted.store.getSnapshot().entries[1];
  assert.equal(recovered.kind === "turn" && recovered.turn.text, "answer");
  await assert.rejects(
    restarted.lifecycle.answer(restored as typeof f.question, "answer"),
    /changed or was answered/,
  );
  assert.equal(f.requests.length, 0);
  stop();
});
test("platform hooks delegate complete answer and reconnect flow with authoritative session adapters", async () => {
  for (const platform of ["desktop", "mobile"]) {
    const source = await readFile(
      new URL(`../../${platform}/src/hooks/useAssistant.ts`, import.meta.url),
      "utf8",
    );
    assert.match(source, /waitingReply\.answer\(question, trimmed\)/);
    assert.match(source, /waitingReply\.follow\(activeChatId/);
    assert.doesNotMatch(
      source,
      /answerAttempts|answerAssistantConversationQuestion\(/,
    );
    assert.match(
      source,
      /value\.token === tokenRef\.current|liveSession\.token === tokenRef\.current/,
    );
    assert.match(
      source,
      /new AssistantConversationStore\(client, liveBinding\)/,
    );
  }
});

for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform}: actual ask callback uses live session at dispatch and settlement, with duplicate and retry preservation`, async () => {
    const source = await readFile(
      new URL(`../../${platform}/src/hooks/useAssistant.ts`, import.meta.url),
      "utf8",
    );
    const ast = ts.createSourceFile(
      "useAssistant.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const expressions = new Map<string, string>();
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer)
        expressions.set(node.name.getText(ast), node.initializer.getText(ast));
      ts.forEachChild(node, visit);
    };
    visit(ast);
    const f = fixture();
    await tick();
    let token = "A",
      sessionGeneration = 1,
      message = "answer",
      turns: { id: string }[] = [];
    const replyTargetRef = { current: f.question as typeof f.question | null };
    const tokenRef = { current: "A" };
    const messageRef = { current: message };
    const context = vm.createContext({
      AssistantWaitingReplyLifecycle,
      client: f.client,
      conversationStore: f.store,
      liveSession: {
        get token() {
          return token;
        },
        get generation() {
          return sessionGeneration;
        },
        binding: () => ({ token, generation: sessionGeneration }),
      },
      tokenRef,
      messageRef,
      pendingExcerpt: { current: undefined },
      replyLookupId: { current: null },
      setReplyStatus: () => {},
      generation: { current: 0 },
      chatId: { current: f.destination.chat_id },
      drafts: { current: f.drafts },
      sending: { current: false },
      replyTargetRef,
      pendingReplyId: { current: null },
      conversationReady: true,
      message,
      useMemo: (factory: () => unknown) => factory(),
      nextId: randomUUID,
      setTurns: (update: (old: typeof turns) => typeof turns) => {
        turns = update(turns);
      },
      setMessage: (update: string | ((old: string) => string)) => {
        message = typeof update === "function" ? update(message) : update;
        messageRef.current = message;
      },
      setReplyTarget: (
        update: (
          old: typeof replyTargetRef.current,
        ) => typeof replyTargetRef.current,
      ) => {
        replyTargetRef.current =
          typeof update === "function"
            ? update(replyTargetRef.current)
            : update;
      },
      act: (work: () => Promise<void>) => work(),
    });
    const evaluate = (text: string) =>
      vm.runInContext(
        ts.transpileModule(text, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText,
        context,
      );
    evaluate(
      `var liveBinding = ${expressions.get("liveBinding")}; var waitingReply = ${expressions.get("waitingReply")}; var ask = ${expressions.get("ask")};`,
    );
    token = "B"; // authoritative login changes before React's token prop/effect
    await evaluate('ask("answer")');
    assert.equal(f.requests.length, 0);
    assert.equal(turns.length, 0);
    token = "A";
    const first = evaluate('ask("answer")');
    await tick();
    await evaluate('ask("answer")');
    assert.equal(f.requests.length, 1);
    assert.equal(turns.length, 1);
    f.requests[0].pending.reject(new Error("lost"));
    await assert.rejects(first, /lost/);
    assert.equal(message, "answer");
    const retry = evaluate('ask("answer")');
    await tick();
    assert.equal(f.requests[1].turnId, f.requests[0].turnId);
    sessionGeneration++;
    token = "B";
    f.requests[1].pending.resolve();
    await retry;
    assert.equal(replyTargetRef.current?.id, f.question.id); // no late success on account B
  });
}

test("account changes between optimistic admission and transport dispatch send no request", async () => {
  const f = fixture();
  const pending = f.lifecycle.answer(f.question, "answer");
  f.switchAccount("B:2");
  await pending;
  assert.equal(f.requests.length, 0);
});
test("same-account token ABA fences late settlement and reconnect survives ordinary turn generations", async () => {
  const f = fixture();
  const pending = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.switchAccount("A:3");
  f.requests[0].pending.resolve();
  await pending;
  assert.equal(f.selected, f.question.id);
  const g = fixture();
  await tick();
  const stop = g.follow();
  await tick();
  const before = g.feedCalls;
  g.advanceTurn();
  g.foreground();
  await tick();
  assert.equal(g.feedCalls, before + 1);
  stop();
});

test("cancelled lookup and stale cleanup cannot replace a new reconnect lease", async () => {
  const f = fixture();
  f.store.reset();
  const oldStop = f.follow();
  await tick();
  oldStop();
  const newStop = f.follow();
  f.lookup.resolve(f.destination);
  await tick();
  assert.equal(f.store.getSnapshot().destination?.id, f.destination.id);
  oldStop();
  assert.equal(f.store.getSnapshot().destination?.id, f.destination.id);
  newStop();
  assert.equal(f.store.getSnapshot().destination, null);
});

test("injected reconnect clock polls only while active and is released on cancellation", async () => {
  const f = fixture();
  await tick();
  let active = false,
    released = false;
  let poll!: () => void;
  const stop = f.lifecycle.follow(f.destination.chat_id, {
    isActive: () => active,
    onNews: () => () => {},
    every: (listener, interval) => {
      assert.equal(interval, 3000);
      poll = listener;
      return () => {
        released = true;
      };
    },
  });
  const before = f.feedCalls;
  poll();
  await tick();
  assert.equal(f.feedCalls, before);
  active = true;
  poll();
  await tick();
  assert.equal(f.feedCalls, before + 1);
  stop();
  assert.equal(released, true);
  poll();
  await tick();
  assert.equal(f.feedCalls, before + 1);
});

test("failed answer survives A→B→A before rejection and later draft captures; contextual restore is reachable", async () => {
  const f = fixture();
  const pending = f.lifecycle.answer(f.question, "answer");
  await tick();
  const other = randomUUID();
  f.open(other);
  f.open(f.destination.chat_id);
  f.requests[0].pending.reject(new Error("late failure"));
  await pending;
  assert.equal(f.message, "");
  assert.equal(f.lifecycle.getSnapshot().length, 1);
  f.open(other);
  f.open(f.destination.chat_id);
  const failed = f.lifecycle.getSnapshot()[0];
  assert.equal(f.lifecycle.canRestore(failed.id), true);
  assert.equal(f.lifecycle.restore(failed.id), true);
  assert.equal(f.message, "answer");
  assert.equal(f.selected, f.question.id);
  assert.equal(f.lifecycle.getSnapshot().length, 0);
});
test("newer detached target/text/excerpt survives late failure and older answer stays separately recoverable", async () => {
  const f = fixture();
  const pending = f.lifecycle.answer(f.question, "old answer");
  await tick();
  const other = randomUUID(),
    newer = randomUUID();
  f.open(other);
  f.lifecycle.saveDraft(f.destination.chat_id, {
    message: "new draft",
    replyId: newer,
    excerpt: "new excerpt",
  });
  f.requests[0].pending.reject(new Error("late failure"));
  await pending;
  assert.deepEqual(f.drafts.get(f.destination.chat_id), {
    message: "new draft",
    replyId: newer,
    excerpt: "new excerpt",
  });
  f.open(f.destination.chat_id);
  const failed = f.lifecycle.getSnapshot()[0];
  assert.equal(f.lifecycle.canRestore(failed.id), false);
  assert.equal(f.lifecycle.restore(failed.id), false);
  assert.equal(f.message, "new draft");
  f.setComposer("", null);
  assert.equal(f.lifecycle.restore(failed.id), true);
  assert.equal(f.message, "old answer");
  assert.equal(f.selected, f.question.id);
});
test("draft revision fences detached successful answers from clearing a newer excerpt", async () => {
  const f = fixture();
  const pending = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.open(randomUUID());
  f.lifecycle.saveDraft(f.destination.chat_id, {
    message: "new text",
    replyId: f.question.id,
    excerpt: "new excerpt",
  });
  f.requests[0].pending.resolve();
  await pending;
  assert.deepEqual(f.drafts.get(f.destination.chat_id), {
    message: "new text",
    replyId: f.question.id,
    excerpt: "new excerpt",
  });
});
test("account reset discards failed-answer recovery and stale restore cannot affect another account", async () => {
  const f = fixture();
  const pending = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.open(randomUUID());
  f.requests[0].pending.reject(new Error("late"));
  await pending;
  const failed = f.lifecycle.getSnapshot()[0];
  f.switchAccount("B:2");
  assert.equal(f.lifecycle.canRestore(failed.id), false);
  assert.equal(f.lifecycle.getSnapshot().length, 0);
  f.lifecycle.reset();
  f.switchAccount("A:1");
  assert.equal(f.lifecycle.getSnapshot().length, 0);
});

for (const platform of ["desktop", "mobile"] as const) {
  for (const replaced of [false, true])
    test(`${platform}: actual openChat captures cannot lose a late failed answer (newer target=${replaced})`, async () => {
      const source = await readFile(
        new URL(`../../${platform}/src/hooks/useAssistant.ts`, import.meta.url),
        "utf8",
      );
      const ast = ts.createSourceFile(
        "hook.ts",
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const expressions = new Map<string, string>();
      const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.initializer)
          expressions.set(
            node.name.getText(ast),
            node.initializer.getText(ast),
          );
        if (
          ts.isPropertyAssignment(node) &&
          ["clearReply", "selectReply", "selectExcerpt"].includes(
            node.name.getText(ast),
          )
        )
          expressions.set(
            node.name.getText(ast),
            node.initializer.getText(ast),
          );
        ts.forEachChild(node, visit);
      };
      visit(ast);
      const f = fixture();
      await tick();
      const messageRef = { current: "old answer" };
      const replyTargetRef = {
        current: f.question as
          (typeof f.question & { excerpt?: string }) | null,
      };
      const pendingReplyId = { current: null as string | null },
        pendingExcerpt = { current: undefined as string | undefined };
      const generation = { current: 0 },
        chatId = { current: f.destination.chat_id as string | null };
      let turns: unknown[] = [];
      const state: Record<string, unknown> = {
        AssistantWaitingReplyLifecycle,
        AbortController,
        client: {
          ...f.client,
          aiChat: async (id: string) => ({ id, turns: [], trace: [] }),
        },
        conversationStore: f.store,
        liveSession: {
          token: "A",
          generation: 1,
          binding: () => ({ token: "A", generation: 1 }),
        },
        tokenRef: { current: "A" },
        messageRef,
        replyTargetRef,
        pendingReplyId,
        pendingExcerpt,
        replyLookupId: { current: null },
        generation,
        chatId,
        drafts: { current: f.drafts },
        sending: { current: false },
        poll: { current: null },
        scopeRef: { current: null },
        conversationReady: true,
        message: "old answer",
        useMemo: (factory: () => unknown) => factory(),
        nextId: randomUUID,
        act: (work: () => Promise<void>) => work(),
        saveAssistantChat: () => {},
        loadChats: () => {},
        stopPolling: () => {},
        setMessage: (update: string | ((old: string) => string)) => {
          messageRef.current =
            typeof update === "function" ? update(messageRef.current) : update;
        },
        setReplyTarget: (
          update:
            | typeof replyTargetRef.current
            | ((
                old: typeof replyTargetRef.current,
              ) => typeof replyTargetRef.current),
        ) => {
          replyTargetRef.current =
            typeof update === "function"
              ? update(replyTargetRef.current)
              : update;
        },
        setTurns: (update: unknown[] | ((old: unknown[]) => unknown[])) => {
          turns = typeof update === "function" ? update(turns) : update;
        },
        assistantExcerptMatches: (text: string, excerpt: string) =>
          text.includes(excerpt),
      };
      for (const setter of [
        "setCharacterOutcome",
        "setThinking",
        "setRunProgress",
        "setReplyStatus",
        "setFocusedConversationSequence",
        "setLegacyHistoryAvailable",
        "setLegacyHistoryTarget",
        "setActiveChatId",
        "setRestoringChat",
        "setConversationReady",
        "setConversationIssue",
        "setScopeState",
      ])
        state[setter] = () => {};
      const context = vm.createContext(state);
      const evaluate = (text: string) =>
        vm.runInContext(
          ts.transpileModule(text, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
          }).outputText,
          context,
        );
      evaluate(
        `var liveBinding=${expressions.get("liveBinding")};var waitingReply=${expressions.get("waitingReply")};var clearConversation=${expressions.get("clearConversation")};var openChat=${expressions.get("openChat")};var ask=${expressions.get("ask")};var selectExcerpt=${expressions.get("selectExcerpt")};var clearReply=${expressions.get("clearReply")};`,
      );
      const lifecycle = context.waitingReply as AssistantWaitingReplyLifecycle;
      const pending = evaluate('ask("old answer")');
      await tick();
      const other = randomUUID();
      await context.openChat(other);
      await context.openChat(f.destination.chat_id);
      if (replaced) {
        const newer = {
          ...f.question,
          id: randomUUID(),
          text: "New question source",
        };
        f.entries([newer]);
        await f.store.refresh();
        context.selectExcerpt(newer, "New question");
        context.setMessage("new draft");
        await context.openChat(other);
      }
      f.requests[0].pending.reject(new Error("late failure"));
      await pending;
      if (replaced) {
        assert.equal(f.drafts.get(f.destination.chat_id)?.message, "new draft");
        assert.equal(
          f.drafts.get(f.destination.chat_id)?.excerpt,
          "New question",
        );
      }
      await context.openChat(other);
      await context.openChat(f.destination.chat_id);
      const failed = lifecycle.getSnapshot()[0];
      assert.equal(failed.text, "old answer");
      if (replaced) {
        assert.equal(lifecycle.restore(failed.id), false);
        assert.equal(messageRef.current, "new draft");
        assert.equal(pendingExcerpt.current, "New question");
        context.clearReply();
        context.setMessage("");
      }
      assert.equal(lifecycle.restore(failed.id), true);
      assert.equal(messageRef.current, "old answer");
      assert.equal(pendingReplyId.current, f.question.id);
      await context.openChat(other);
      await context.openChat(f.destination.chat_id);
      assert.equal(messageRef.current, "old answer");
      assert.equal(pendingReplyId.current, f.question.id);
      const view = await readFile(
        new URL(
          platform === "desktop"
            ? "../../desktop/src/features/assistant/AssistantView.tsx"
            : "../../mobile/src/screens/AssistantScreen.tsx",
          import.meta.url,
        ),
        "utf8",
      );
      assert.match(view, /assistant\.failedAnswers\.map/);
      assert.match(view, /assistant\.restoreFailedAnswer\(answer.id\)/);
      assert.match(view, /assistant\.canRestoreFailedAnswer\(answer.id\)/);
    });
}

test("accepted retry suppresses an earlier transport failure with the same stable turn ID", async () => {
  const f = fixture();
  const first = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.open(randomUUID());
  f.open(f.destination.chat_id);
  const retry = f.lifecycle.answer(f.question, "answer");
  await tick();
  assert.equal(f.requests[0].turnId, f.requests[1].turnId);
  f.requests[1].pending.resolve();
  await retry;
  f.setComposer("new draft", "new-target", "new excerpt");
  f.requests[0].pending.reject(new Error("late old failure"));
  await first;
  assert.equal(f.lifecycle.getSnapshot().length, 0);
  assert.equal(f.message, "new draft");
  assert.equal(f.selected, "new-target");
});
test("success removes an already queued recovery for the same accepted turn without changing a newer draft", async () => {
  const f = fixture();
  const first = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.open(randomUUID());
  f.open(f.destination.chat_id);
  const retry = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.setComposer("new draft", "new-target", "new excerpt");
  f.requests[0].pending.reject(new Error("first failure"));
  await first;
  assert.equal(f.lifecycle.getSnapshot().length, 1);
  f.requests[1].pending.resolve();
  await retry;
  assert.equal(f.lifecycle.getSnapshot().length, 0);
  assert.equal(f.message, "new draft");
  assert.equal(f.selected, "new-target");
});

test("manual resubmission after a detached failure reuses its receipt ID and removes recovery", async () => {
  const f = fixture();
  const first = f.lifecycle.answer(f.question, "answer");
  await tick();
  f.open(randomUUID());
  f.requests[0].pending.reject(new Error("response lost"));
  await first;
  assert.equal(f.lifecycle.getSnapshot().length, 1);
  f.open(f.destination.chat_id);
  f.setComposer("answer", f.question.id);
  // This is a manual reply, without invoking the Restore answer action.
  const retry = f.lifecycle.answer(f.question, "answer");
  await tick();
  assert.equal(f.requests[1].turnId, f.requests[0].turnId);
  f.requests[1].pending.resolve();
  await retry;
  assert.equal(f.lifecycle.getSnapshot().length, 0);
});

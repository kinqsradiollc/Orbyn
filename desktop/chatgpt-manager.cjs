const { randomUUID } = require("node:crypto");
const { createChatgptVault } = require("./chatgpt-vault.cjs");
const {
  createChatgptRegistrationStore,
} = require("./chatgpt-registration.cjs");
const { createChatgptModelRuntime } = require("./chatgpt-models.cjs");
const {
  createChatgptExecutorSigner,
} = require("./chatgpt-executor-signing.cjs");
const {
  createChatgptExecutorRuntime,
} = require("./chatgpt-executor-runtime.cjs");
const { signInChatgpt } = require("./chatgpt-sign-in.cjs");
const { revokeChatgptTokens } = require("./chatgpt-oauth.cjs");

/** Trusted main-process composition. Configuration/factories never come from IPC. */
async function createChatgptManager({
  directory,
  apiBaseUrl,
  safeStorage,
  platform,
  openAuthorization,
  fetch,
  createClient,
  signIn = signInChatgpt,
  revoke = revokeChatgptTokens,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
}) {
  const { OrbynClient, safeChatgptActionError } =
    await import("@orbyn/api-client");
  const { chatgptModelBinding, chatgptModelPreference } =
    await import("@orbyn/core");
  const storage = { directory, apiBaseUrl, safeStorage, platform };
  const vault = await createChatgptVault(storage);
  const keyVault = await createChatgptVault({
    ...storage,
    purpose: "executor-key",
  });
  const listeners = new Set();
  let generation = 0,
    context = null;
  let operations = Promise.resolve();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {}
    }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const requireContext = (ctx = context) => {
    if (
      !ctx ||
      ctx !== context ||
      ctx.generation !== generation ||
      ctx.lifetime.signal.aborted
    )
      throw new Error("Sign in to Orbyn before managing ChatGPT connections.");
    return ctx;
  };
  const stopActive = (ctx) => {
    if (!ctx?.active) return;
    const previous = ctx.active.models.picker.snapshot();
    if (previous.preference)
      ctx.lastCatalog = {
        ...previous,
        status: "unavailable",
        models: [],
        saving: false,
        error:
          "The credential-owning device is unavailable. Reconnect or retry.",
      };
    cancelSchedule(ctx.active.timer);
    cancelSchedule(ctx.active.inferenceTimer);
    ctx.active.unsubscribe?.();
    ctx.active.models.close();
    ctx.active.executor.close();
    ctx.active.signer.close();
    ctx.active = null;
  };
  const slotStore = (ctx, registrationId) =>
    createChatgptRegistrationStore({
      directory,
      apiBaseUrl,
      userId: ctx.userId,
      registrationId,
    });
  const ordered = (work, valid = () => true) => {
    const ctx = requireContext();
    const result = operations
      .catch(() => {})
      .then(async () => {
        requireContext(ctx);
        if (!valid()) return;
        ctx.busy = true;
        ctx.error = null;
        notify();
        try {
          const result = await work(ctx);
          requireContext(ctx);
          if (result?.status) return { ...result, busy: false };
          if (result?.state)
            return { ...result, state: { ...result.state, busy: false } };
          return result;
        } catch (error) {
          if (ctx === context) ctx.error = safeChatgptActionError(error);
          throw error;
        } finally {
          if (ctx === context) {
            ctx.busy = false;
            notify();
          }
        }
      });
    operations = result.catch(() => {});
    return result;
  };
  const authenticate = async (ctx, store, controller, binding) => {
    const signal = AbortSignal.any([ctx.lifetime.signal, controller.signal]);
    signal.throwIfAborted();
    await signIn({
      userId: ctx.userId,
      registrationStore: store,
      vault,
      reconnectBinding: binding,
      beginConnection: (value) =>
        ctx.client.startChatgptConnection(value, signal),
      finishConnection: (value) =>
        ctx.client.finishChatgptConnection(value, signal),
      openAuthorization,
      signal,
    });
    signal.throwIfAborted();
    requireContext(ctx);
  };
  const reserveSignIn = () => {
    const ctx = requireContext();
    if (ctx.signInAbort)
      throw new Error("Finish or cancel the current ChatGPT sign-in first.");
    const controller = new AbortController();
    ctx.signInAbort = controller;
    return {
      ctx,
      controller,
      release: () => {
        if (ctx.signInAbort === controller) ctx.signInAbort = null;
      },
    };
  };
  const liveConnection = async (ctx, binding, selectionRevision) => {
    requireContext(ctx);
    if (selectionRevision !== undefined) {
      const selected = await ctx.store.activeConnection();
      requireContext(ctx);
      if (
        selected.status !== "selected" ||
        !same(selected.binding, binding) ||
        selected.revision !== selectionRevision
      )
        throw new Error("The selected ChatGPT account changed.");
    }
    const connections = await ctx.client.chatgptConnections(
      ctx.lifetime.signal,
    );
    requireContext(ctx);
    if (
      !connections.some(
        (value) =>
          value.id === binding.connection_id &&
          value.issuer === binding.issuer &&
          value.subject === binding.subject &&
          value.client_id === binding.client_id,
      )
    )
      throw new Error("Reconnect this ChatGPT account.");
  };
  const snapshot = async () => {
    const ctx = context;
    if (!ctx)
      return {
        status: "signed-out",
        busy: false,
        user_id: null,
        connections: [],
        selection: null,
        catalog: null,
        error: null,
      };
    requireContext(ctx);
    const [connections, selection] = await Promise.all([
      ctx.store.list(),
      ctx.store.selection(),
    ]);
    requireContext(ctx);
    const candidate =
      ctx.active?.models.picker.snapshot() ?? ctx.lastCatalog ?? null;
    const selected = connections.find(
      (value) => value.registrationId === selection.registrationId,
    );
    const retained =
      ctx.lastCatalog?.preference &&
      selected?.binding &&
      same(ctx.lastCatalog.preference.binding, selected.binding)
        ? ctx.lastCatalog.preference
        : null;
    const catalog =
      candidate &&
      (!candidate.preference ||
        (selected?.binding &&
          same(candidate.preference.binding, selected.binding)))
        ? { ...candidate, preference: candidate.preference ?? retained }
        : null;
    return {
      status: ctx.error ? "unavailable" : "ready",
      busy: ctx.busy,
      user_id: ctx.userId,
      connections: connections
        .filter((value) => value.binding)
        .map((value) => ({
          registration_id: value.registrationId,
          binding: value.binding,
          selected: value.registrationId === selection.registrationId,
          sharing_granted: ctx.grants.get(value.registrationId) ?? null,
        })),
      selection: {
        ...selection,
        ...(ctx.active?.executorSelection
          ? { executor: ctx.active.executorSelection }
          : {}),
      },
      catalog,
      error: ctx.error,
      ...(ctx.active?.verification
        ? { verification: ctx.active.verification }
        : {}),
    };
  };
  const activate = async (ctx, registrationId) => {
    requireContext(ctx);
    stopActive(ctx);
    const selected = await ctx.store.activeConnection();
    requireContext(ctx);
    if (
      selected.status !== "selected" ||
      selected.registrationId !== registrationId
    )
      throw new Error("Select this ChatGPT registration first.");
    const store = await slotStore(ctx, registrationId);
    const binding = chatgptModelBinding.parse(selected.binding);
    const live = () => liveConnection(ctx, binding, selected.revision);
    await live();
    const saved = await vault.read(binding);
    await live();
    ctx.grants.set(registrationId, saved.credentials?.sharingGranted ?? null);
    if (saved.credentials && !saved.credentials.sharingGranted) {
      ctx.error =
        "This account is connected for identity. Enable ChatGPT plan usage to load models.";
      return;
    }
    let serverSelection = null;
    const models = await createChatgptModelRuntime({
      binding,
      registrationStore: store,
      vault,
      requireLiveConnection: live,
      fetch,
      onInvalidated: () => {
        if (ctx !== context || ctx.active?.models !== models) return;
        ctx.grants.delete(registrationId);
        ctx.error =
          "This ChatGPT session has ended. Connect again to continue.";
        stopActive(ctx);
        ctx.lastCatalog = null;
        notify();
      },
      preferenceStore: {
        read: async (_binding, signal) => {
          await live();
          if (!serverSelection)
            throw new Error("The ChatGPT executor is not ready.");
          const value = await ctx.client.chatgptModels(serverSelection, signal);
          await live();
          if (value.status !== "ready" || !same(value.binding, binding))
            throw new Error("The ChatGPT catalog is not available.");
          return value.preference;
        },
        write: async (preference, signal) => {
          await live();
          if (!serverSelection)
            throw new Error("The ChatGPT executor is not ready.");
          return ctx.client.selectChatgptDefault(
            { selection: serverSelection, preference },
            signal,
          );
        },
      },
    });
    let signer, executor;
    try {
      const host = await store.read();
      await live();
      signer = await createChatgptExecutorSigner({
        ...storage,
        keyVault,
        binding,
        hostId: host.hostId,
        requireLiveConnection: live,
      });
      executor = await createChatgptExecutorRuntime({
        binding,
        client: ctx.client,
        signer,
        models: models.models,
        complete: models.completeDefault,
        completeAssigned: models.completeAssigned,
        requireLiveConnection: live,
      });
      const active = {
        registrationId,
        binding,
        models,
        signer,
        executor,
        timer: null,
        refreshAt: Date.now() + 120_000,
        unsubscribe: models.picker.subscribe(notify),
      };
      requireContext(ctx);
      ctx.active = active;
      const started = await executor.start(ctx.lifetime.signal);
      await live();
      serverSelection = started.selection;
      active.executorSelection = started.selection;
      await models.picker.load();
      await live();
      if (models.picker.snapshot().status !== "ready")
        throw new Error("ChatGPT models could not be loaded.");
      const processInference = async () => {
        if (
          ctx !== context ||
          ctx.active !== active ||
          ctx.lifetime.signal.aborted
        )
          return;
        try {
          await executor.executeNext(ctx.lifetime.signal);
        } catch {
          /* Terminal request failure or fenced assignment never retries inference. */
        }
        if (
          ctx === context &&
          ctx.active === active &&
          !ctx.lifetime.signal.aborted
        ) {
          active.inferenceTimer = schedule(processInference, 5000);
          active.inferenceTimer?.unref?.();
        }
      };
      if (typeof ctx.client.claimChatgptInference === "function") {
        active.inferenceTimer = schedule(processInference, 5000);
        active.inferenceTimer?.unref?.();
      }
      const pulse = async () => {
        if (ctx !== context || ctx.active !== active) return;
        try {
          await ordered(
            async () => {
              await live();
              await executor.heartbeat(ctx.lifetime.signal);
              if (Date.now() >= active.refreshAt) {
                await executor.refreshCatalog(ctx.lifetime.signal);
                await models.picker.load();
                active.refreshAt = Date.now() + 120_000;
              }
              await live();
            },
            () => ctx.active === active,
          );
        } catch {
          if (ctx === context && ctx.active === active) stopActive(ctx);
          notify();
          return;
        }
        if (ctx === context && ctx.active === active) {
          active.timer = schedule(pulse, 40_000);
          active.timer.unref?.();
        }
      };
      active.timer = schedule(pulse, 40_000);
      active.timer.unref?.();
    } catch (error) {
      if (ctx.active?.models === models) stopActive(ctx);
      else {
        models.close();
        signer?.close();
        executor?.close();
      }
      throw error;
    }
  };
  const watchConnectRequests = (ctx) => {
    if (typeof ctx.client.pendingChatgptConnectRequests !== "function") return;
    const pulse = async () => {
      if (ctx !== context || ctx.lifetime.signal.aborted) return;
      try {
        if (!ctx.busy && !ctx.signInAbort) {
          const pending = await ctx.client.pendingChatgptConnectRequests(
            ctx.lifetime.signal,
          );
          requireContext(ctx);
          if (pending[0]) await manager.connectRequest(pending[0].id);
        }
      } catch {
        /* Another local runtime may have claimed it; no duplicate authorization. */
      }
      if (ctx === context && !ctx.lifetime.signal.aborted) {
        ctx.connectTimer = schedule(pulse, 15000);
        ctx.connectTimer?.unref?.();
      }
    };
    ctx.lifetime.signal.addEventListener(
      "abort",
      () => cancelSchedule(ctx.connectTimer),
      { once: true },
    );
    // Check an already queued web/mobile request as soon as the app session
    // is ready. Later polls retain the normal bounded interval.
    ctx.connectTimer = schedule(pulse, 0);
    ctx.connectTimer?.unref?.();
  };
  const manager = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    /** Only the first-party Orbyn session enters here; plan tokens never enter the renderer. */
    async setSession(token) {
      if (
        token !== null &&
        token !== "" &&
        (typeof token !== "string" ||
          token.length > 8192 ||
          /[\x00-\x20\x7f]/.test(token))
      )
        throw new Error("Invalid Orbyn session.");
      if (context?.token === token) return snapshot();
      const previous = context;
      generation++;
      context = null;
      previous?.lifetime.abort();
      stopActive(previous);
      notify();
      if (!token) return snapshot();
      const currentGeneration = generation;
      const lifetime = new AbortController();
      const client = createClient
        ? await createClient(token)
        : new OrbynClient({
            baseUrl: apiBaseUrl,
            getToken: () => token,
            fetch,
          });
      const profile = await client.me();
      const userId = chatgptModelBinding.shape.user_id.parse(profile.id);
      if (generation !== currentGeneration)
        throw new Error("The Orbyn account changed.");
      const store = await createChatgptRegistrationStore({
        directory,
        apiBaseUrl,
        userId,
      });
      if (generation !== currentGeneration)
        throw new Error("The Orbyn account changed.");
      const ctx = (context = {
        token,
        userId,
        client,
        store,
        generation,
        lifetime,
        active: null,
        busy: false,
        error: null,
        grants: new Map(),
        lastCatalog: null,
      });
      const selected = await store.activeConnection();
      requireContext(ctx);
      if (selected.status === "selected") {
        try {
          await ordered((ctx) => activate(ctx, selected.registrationId));
        } catch {
          /* Saved registration stays visible with a reconnect/retry state. */
        }
      }
      requireContext(ctx);
      watchConnectRequests(ctx);
      notify();
      return snapshot();
    },
    connect() {
      const attempt = reserveSignIn();
      return ordered(async (ctx) => {
        attempt.controller.signal.throwIfAborted();
        stopActive(ctx);
        const registrationId = randomUUID();
        const store = await slotStore(ctx, registrationId);
        await authenticate(ctx, store, attempt.controller);
        requireContext(ctx);
        const selection = await ctx.store.selection();
        requireContext(ctx);
        await ctx.store.select(registrationId, selection.revision);
        requireContext(ctx);
        await activate(ctx, registrationId);
        return snapshot();
      }).finally(attempt.release);
    },
    async connectRequest(requestId) {
      chatgptModelBinding.shape.connection_id.parse(requestId);
      const ctx = requireContext();
      await ctx.client.claimChatgptConnectRequest(requestId);
      requireContext(ctx);
      try {
        const state = await manager.connect();
        requireContext(ctx);
        const selected = state.connections.find((value) => value.selected);
        if (!selected) throw new Error("ChatGPT sign-in did not finish.");
        await ctx.client.finishChatgptConnectRequest(
          requestId,
          selected.binding.connection_id,
        );
        requireContext(ctx);
        return state;
      } catch (error) {
        if (ctx === context && ctx.generation === generation)
          await ctx.client
            .finishChatgptConnectRequest(requestId, null)
            .catch(() => {});
        throw error;
      }
    },
    select(registrationId, expectedRevision) {
      if (registrationId !== "primary")
        chatgptModelBinding.shape.connection_id.parse(registrationId);
      if (expectedRevision !== null)
        chatgptModelBinding.shape.connection_id.parse(expectedRevision);
      return ordered(async (ctx) => {
        stopActive(ctx);
        await ctx.store.select(registrationId, expectedRevision);
        requireContext(ctx);
        await activate(ctx, registrationId);
        return snapshot();
      });
    },
    reconnect(registrationId) {
      if (registrationId !== "primary")
        chatgptModelBinding.shape.connection_id.parse(registrationId);
      const attempt = reserveSignIn();
      return ordered(async (ctx) => {
        attempt.controller.signal.throwIfAborted();
        stopActive(ctx);
        const store = await slotStore(ctx, registrationId);
        const binding = await store.connection();
        requireContext(ctx);
        if (!binding) throw new Error("Connect this ChatGPT account first.");
        await authenticate(ctx, store, attempt.controller, binding);
        requireContext(ctx);
        const selection = await ctx.store.selection();
        await ctx.store.select(registrationId, selection.revision);
        requireContext(ctx);
        await activate(ctx, registrationId);
        return snapshot();
      }).finally(attempt.release);
    },
    cancelSignIn() {
      const ctx = requireContext();
      const cancelled = !!ctx.signInAbort;
      ctx.signInAbort?.abort();
      return { cancelled };
    },
    refresh() {
      return ordered(async (ctx) => {
        if (!ctx.active) {
          const selected = await ctx.store.activeConnection();
          requireContext(ctx);
          if (selected.status !== "selected")
            throw new Error("Select a ChatGPT account first.");
          await activate(ctx, selected.registrationId);
        } else {
          await ctx.active.executor.refreshCatalog(ctx.lifetime.signal);
          await ctx.active.models.picker.load();
          requireContext(ctx);
        }
        return snapshot();
      });
    },
    setDefault(model, expectedVersion) {
      if (model !== null) chatgptModelPreference.shape.model.parse(model);
      chatgptModelPreference.shape.version.parse(expectedVersion);
      return ordered(async (ctx) => {
        const active = ctx.active;
        if (
          !active ||
          active.models.picker.snapshot().preference?.version !==
            expectedVersion
        )
          throw new Error("The default model changed. Reload before saving.");
        await active.executor.refreshCatalog(ctx.lifetime.signal);
        requireContext(ctx);
        if (ctx.active !== active)
          throw new Error("The selected ChatGPT account changed.");
        await active.models.picker.setDefault(model);
        requireContext(ctx);
        return snapshot();
      });
    },
    verifyPlan() {
      return ordered(async (ctx) => {
        const active = ctx.active;
        if (!active || !ctx.grants.get(active.registrationId))
          throw new Error(
            "Enable ChatGPT plan usage and select an account first.",
          );
        active.verification = null;
        let receipt = null;
        const model = active.models.picker.defaultStatus();
        if (model.status !== "available")
          throw new Error("Choose a ChatGPT default model first.");
        const text = await active.models.completeDefault(
          {
            input: [
              {
                role: "user",
                content: "Reply with exactly: Token sharing works.",
              },
            ],
          },
          {
            signal: ctx.lifetime.signal,
            onReceipt: (value) => {
              receipt = value;
            },
          },
        );
        requireContext(ctx);
        if (ctx.active !== active || !text.trim() || !receipt)
          throw new Error("ChatGPT plan verification did not complete.");
        active.verification = {
          binding: active.binding,
          model: receipt.model,
          verified_at: new Date().toISOString(),
          usage: receipt.usage,
        };
        return snapshot();
      });
    },
    disconnect(registrationId) {
      if (registrationId !== "primary")
        chatgptModelBinding.shape.connection_id.parse(registrationId);
      return ordered(async (ctx) => {
        if (ctx.active?.registrationId === registrationId) stopActive(ctx);
        const store = await slotStore(ctx, registrationId);
        const binding = await store.connection();
        requireContext(ctx);
        if (!binding)
          throw new Error("This ChatGPT registration is not connected.");
        const saved = await vault.read(binding);
        requireContext(ctx);
        let remoteRevoked = false;
        if (saved.credentials?.refreshToken) {
          try {
            remoteRevoked = (
              await revoke(saved.credentials, {
                fetch,
                signal: ctx.lifetime.signal,
              })
            ).revoked;
          } catch {
            /* Clearing local credentials still completes a local disconnect. */
          }
        }
        await vault.revoke(binding);
        ctx.grants.delete(registrationId);
        await keyVault.revoke(binding);
        requireContext(ctx);
        await ctx.client.revokeChatgptConnection(binding.connection_id);
        requireContext(ctx);
        const selected = await ctx.store.selection();
        if (selected.registrationId === registrationId)
          await ctx.store.select(null, selected.revision);
        requireContext(ctx);
        return {
          state: await snapshot(),
          remote_revocation_confirmed: remoteRevoked,
        };
      });
    },
    close() {
      generation++;
      const previous = context;
      context = null;
      previous?.lifetime.abort();
      stopActive(previous);
      notify();
    },
  };
  return manager;
}
module.exports = { createChatgptManager };

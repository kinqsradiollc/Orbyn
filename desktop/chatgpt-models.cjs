/** Private credential-owning adapter; never expose it or vault credentials over IPC. */
async function createChatgptModelRuntime({
  binding: input,
  registrationStore,
  vault,
  requireLiveConnection,
  fetch,
  preferenceStore,
  credentialResolver,
  onInvalidated,
}) {
  const { chatgptModelBinding } = await import("@orbyn/core");
  const { ChatgptPlanClient, ChatgptModelPicker } =
    await import("@orbyn/api-client");
  const binding = chatgptModelBinding.parse(input);
  if (typeof requireLiveConnection !== "function")
    throw new Error("A live Orbyn connection is required.");
  const initial = await registrationStore.activeConnection();
  let closed = false;
  const lifetime = new AbortController();
  const same = (value) => JSON.stringify(value) === JSON.stringify(binding);
  const checkContext = async () => {
    const active = await registrationStore.activeConnection();
    if (
      closed ||
      active.status !== "selected" ||
      !same(active.binding) ||
      active.revision !== initial.revision
    )
      throw new Error("The selected ChatGPT account changed.");
    const own = await registrationStore.connection();
    if (closed || !same(own))
      throw new Error("The ChatGPT registration changed.");
  };
  await checkContext();
  const live = async () => {
    await checkContext();
    await requireLiveConnection({ ...binding });
    await checkContext();
  };
  // The issued client ID is the registration/workspace consistency anchor.
  // It is not presented as an independently discovered workspace identifier.
  const account = {
    accountId: binding.subject,
    workspaceId: binding.client_id,
    clientId: binding.client_id,
  };
  const credentials =
    credentialResolver ??
    (await require("./chatgpt-credentials.cjs").createChatgptCredentialResolver(
      {
        binding,
        vault,
        requireLiveConnection: live,
        fetch,
        onInvalidated,
      },
    ));
  const transport = new ChatgptPlanClient({
    account,
    fetch,
    credential: async () => {
      await live();
      const saved = await credentials.current(lifetime.signal);
      await checkContext();
      if (
        !saved ||
        saved.clientId !== binding.client_id ||
        !saved.sharingGranted ||
        saved.expiresAt <= Date.now()
      )
        throw new Error(
          "Reconnect this ChatGPT account before loading its models.",
        );
      return { ...account, accessToken: saved.accessToken };
    },
  });
  const models = async (signal) => {
    const signals = [lifetime.signal, AbortSignal.timeout(30_000)];
    if (signal) signals.push(signal);
    const result = await transport.models(AbortSignal.any(signals));
    await checkContext();
    return result;
  };
  const picker = new ChatgptModelPicker({
    binding,
    models,
    store: {
      read: async (_binding, signal) => {
        const readSignal = AbortSignal.any([
          lifetime.signal,
          AbortSignal.timeout(30_000),
          ...(signal ? [signal] : []),
        ]);
        readSignal.throwIfAborted();
        await live();
        const saved = preferenceStore
          ? await preferenceStore.read(binding, readSignal)
          : await registrationStore.modelPreference();
        readSignal.throwIfAborted();
        await checkContext();
        return saved;
      },
      write: async (preference) => {
        await live();
        if (
          preference.model !== null &&
          !(await models()).some((model) => model.slug === preference.model)
        )
          throw new Error(
            "This model is no longer available to the selected account.",
          );
        await checkContext();
        const saved = preferenceStore
          ? await preferenceStore.write(preference, lifetime.signal)
          : await registrationStore.saveModelPreference(preference, {
              signal: lifetime.signal,
              selectionRevision: initial.revision,
            });
        await checkContext();
        return saved;
      },
    },
  });
  return {
    picker,
    models,
    /** Private executor adapter: resolve the saved default without a paid fallback. */
    async completeDefault(request, options = {}) {
      const signals = [lifetime.signal, AbortSignal.timeout(120_000)];
      if (options.signal) signals.push(options.signal);
      const signal = AbortSignal.any(signals);
      signal.throwIfAborted();
      await live();
      await picker.refreshPreference(signal);
      await live();
      const state = picker.snapshot();
      const chosen = picker.defaultStatus();
      if (
        state.status !== "ready" ||
        state.saving ||
        chosen.status !== "available"
      )
        throw new Error(
          "Choose an available ChatGPT default model before continuing.",
        );
      // A per-turn model is immutable even if the default is changed later.
      let usage = null;
      const result = await transport.complete(
        {
          model: chosen.model.slug,
          input: request.input,
          instructions: request.instructions,
          ...(request.max_output_tokens === undefined
            ? {}
            : { max_output_tokens: request.max_output_tokens }),
        },
        {
          signal,
          onUsage: (reported) => {
            usage = reported;
          },
        },
      );
      await live();
      options.onUsage?.(usage);
      options.onReceipt?.({ model: chosen.model.slug, usage });
      return result;
    },
    /** Server-assigned requests keep their captured model; this method never crosses IPC. */
    async completeAssigned(model, request, options = {}) {
      const { chatgptModel } = await import("@orbyn/core");
      const slug = chatgptModel.shape.slug.parse(model);
      const signal = AbortSignal.any([
        lifetime.signal,
        AbortSignal.timeout(120000),
        ...(options.signal ? [options.signal] : []),
      ]);
      await live();
      let usage = null;
      const text = await transport.complete(
        {
          model: slug,
          input: request.input,
          instructions: request.instructions,
          ...(request.max_output_tokens === undefined
            ? {}
            : { max_output_tokens: request.max_output_tokens }),
        },
        {
          signal,
          onUsage: (value) => {
            usage = value;
          },
        },
      );
      await live();
      signal.throwIfAborted();
      return { text, usage };
    },
    close() {
      closed = true;
      lifetime.abort();
      credentials.close();
      picker.close();
    },
  };
}

module.exports = { createChatgptModelRuntime };

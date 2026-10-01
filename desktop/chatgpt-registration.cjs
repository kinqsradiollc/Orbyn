const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { getChatgptHostId } = require("./chatgpt-host.cjs");
const queues = new Map();

/** Main-process registration metadata only; never stores OAuth codes or tokens. */
async function createChatgptRegistrationStore({
  directory,
  apiBaseUrl,
  userId,
  registrationId = "primary",
}) {
  const { chatgptModelBinding, chatgptModelPreference } =
    await import("@orbyn/core");
  chatgptModelBinding.shape.user_id.parse(userId);
  if (registrationId !== "primary")
    chatgptModelBinding.shape.connection_id.parse(registrationId);
  const base = new URL(apiBaseUrl);
  if (
    !path.isAbsolute(directory) ||
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid ChatGPT registration context.");
  const namespace = base.origin + base.pathname.replace(/\/+$/, "");
  const keyOf = (slot) =>
    createHash("sha256")
      .update(
        JSON.stringify(
          slot === "primary" ? [namespace, userId] : [namespace, userId, slot],
        ),
      )
      .digest("hex");
  const key = keyOf(registrationId);
  const filename = path.join(directory, `${key}.json`);
  const invalid = () =>
    new Error("ChatGPT registration metadata is unavailable.");
  const queueKey = JSON.stringify([path.resolve(directory), namespace, userId]);
  const ordered = (work) => {
    const result = (queues.get(queueKey) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    const tail = result.catch(() => {});
    queues.set(queueKey, tail);
    void tail.finally(() => {
      if (queues.get(queueKey) === tail) queues.delete(queueKey);
    });
    return result;
  };
  const load = async (slot = registrationId, candidateName) => {
    let file;
    try {
      const target = candidateName
        ? path.join(directory, candidateName)
        : filename;
      const before = await fs.lstat(target);
      if (!before.isFile() || before.isSymbolicLink() || before.size > 4096)
        throw invalid();
      file = await fs.open(
        target,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.size > 4096 ||
        info.ino !== before.ino ||
        info.dev !== before.dev
      )
        throw invalid();
      const buffer = Buffer.alloc(4097);
      let length = 0;
      while (length < buffer.length) {
        const chunk = await file.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (!chunk.bytesRead) break;
        length += chunk.bytesRead;
      }
      if (length > 4096) throw invalid();
      const value = JSON.parse(buffer.subarray(0, length).toString("utf8"));
      if (
        slot === null &&
        (value.namespace !== namespace || value.userId !== userId)
      )
        return null;
      const selectedSlot = slot ?? value.registrationId ?? "primary";
      if (
        selectedSlot !== "primary" &&
        !chatgptModelBinding.shape.connection_id.safeParse(selectedSlot).success
      )
        throw invalid();
      if (
        value.version !== 1 ||
        value.namespace !== namespace ||
        value.userId !== userId ||
        (value.registrationId ?? "primary") !== selectedSlot ||
        (candidateName && candidateName !== `${keyOf(selectedSlot)}.json`) ||
        !chatgptModelBinding.shape.connection_id.safeParse(value.hostId)
          .success ||
        !chatgptModelBinding.shape.connection_id.safeParse(value.revision)
          .success ||
        (value.clientId !== null &&
          !chatgptModelBinding.shape.client_id.safeParse(value.clientId)
            .success)
      )
        throw invalid();
      if (value.binding !== undefined) {
        const binding = chatgptModelBinding.parse(value.binding);
        if (binding.user_id !== userId || binding.client_id !== value.clientId)
          throw invalid();
      }
      if (value.modelPreference !== undefined) {
        if (!value.binding) throw invalid();
        chatgptModelPreference.parse({
          ...value.modelPreference,
          binding: value.binding,
        });
      }
      if (value.selectionRevision !== undefined) {
        if (
          !chatgptModelBinding.shape.connection_id.safeParse(
            value.selectionRevision,
          ).success ||
          (value.activeRegistrationId !== null &&
            value.activeRegistrationId !== "primary" &&
            !chatgptModelBinding.shape.connection_id.safeParse(
              value.activeRegistrationId,
            ).success)
        )
          throw invalid();
      } else if (value.activeRegistrationId !== undefined) throw invalid();
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw invalid();
    } finally {
      await file?.close().catch(() => {});
    }
  };
  const save = async (value, target = filename, beforeCommit = () => {}) => {
    beforeCommit();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
    await fs.chmod(directory, 0o700);
    const temporary = path.join(directory, `${key}.${randomUUID()}.tmp`);
    let file;
    try {
      file = await fs.open(temporary, "wx", 0o600);
      await file.writeFile(JSON.stringify(value));
      await file.sync();
      await file.close();
      file = null;
      beforeCommit();
      await fs.rename(temporary, target);
    } finally {
      await file?.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  };
  const metadata = ({ hostId, clientId, revision }) => ({
    hostId,
    clientId,
    revision,
  });
  return {
    /** Local runtime preference cache; server synchronization remains separate. */
    modelPreference() {
      return ordered(async () => {
        const value = await load();
        if (!value?.binding)
          throw new Error("Connect this ChatGPT account first.");
        return chatgptModelPreference.parse({
          binding: value.binding,
          model: value.modelPreference?.model ?? null,
          version: value.modelPreference?.version ?? 0,
        });
      });
    },
    /** Trusted catalog/controller adapters must validate entitlement before calling. */
    saveModelPreference(input, { signal, selectionRevision } = {}) {
      const preference = chatgptModelPreference.parse(input);
      return ordered(async () => {
        signal?.throwIfAborted();
        if (selectionRevision !== undefined) {
          const selection = await load("primary", `${keyOf("primary")}.json`);
          if (
            selection?.activeRegistrationId !== registrationId ||
            selection?.selectionRevision !== selectionRevision
          )
            throw new Error("The selected ChatGPT account changed.");
        }
        const value = await load();
        if (
          !value?.binding ||
          JSON.stringify(chatgptModelBinding.parse(value.binding)) !==
            JSON.stringify(preference.binding)
        )
          throw new Error("ChatGPT account changed. Reload its models.");
        const version = value.modelPreference?.version ?? 0;
        if (
          version !== preference.version ||
          !Number.isSafeInteger(version + 1)
        )
          throw new Error("The default model changed. Reload and try again.");
        value.modelPreference = {
          model: preference.model,
          version: version + 1,
        };
        await save(value, filename, () => signal?.throwIfAborted());
        return chatgptModelPreference.parse({
          ...value.modelPreference,
          binding: value.binding,
        });
      });
    },
    /** Resolve the saved choice explicitly; never substitute another registration. */
    activeConnection() {
      return ordered(async () => {
        const selection = await load("primary", `${keyOf("primary")}.json`);
        const slot = selection?.activeRegistrationId ?? null;
        const revision = selection?.selectionRevision ?? null;
        if (slot === null) return { status: "unselected", revision };
        const selected = await load(slot, `${keyOf(slot)}.json`);
        if (!selected?.binding)
          return { status: "unavailable", registrationId: slot, revision };
        return {
          status: "selected",
          registrationId: slot,
          revision,
          binding: chatgptModelBinding.parse(selected.binding),
        };
      });
    },
    /** Selected metadata is never a proof that credentials or the server session are live. */
    selection() {
      return ordered(async () => {
        const value = await load("primary", `${keyOf("primary")}.json`);
        return {
          registrationId: value?.activeRegistrationId ?? null,
          revision: value?.selectionRevision ?? null,
        };
      });
    },
    /** Persist an explicit selection only after that slot has a verified identity. */
    select(slot, expectedRevision) {
      if (slot !== null && slot !== "primary")
        chatgptModelBinding.shape.connection_id.parse(slot);
      return ordered(async () => {
        if (slot !== null) {
          const selected = await load(slot, `${keyOf(slot)}.json`);
          if (!selected?.binding)
            throw new Error(
              "Connect this ChatGPT account before selecting it.",
            );
        }
        let value = await load("primary", `${keyOf("primary")}.json`);
        if ((value?.selectionRevision ?? null) !== expectedRevision)
          throw new Error(
            "The selected ChatGPT account changed. Refresh and try again.",
          );
        if (!value)
          value = {
            version: 1,
            namespace,
            userId,
            registrationId: "primary",
            hostId: await getChatgptHostId(directory),
            clientId: null,
            revision: randomUUID(),
          };
        value.activeRegistrationId = slot;
        value.selectionRevision = randomUUID();
        await save(value, path.join(directory, `${keyOf("primary")}.json`));
        return { registrationId: slot, revision: value.selectionRevision };
      });
    },
    /** List only this account/server's validated metadata; never reads the vault. */
    list() {
      return ordered(async () => {
        let entries;
        try {
          const info = await fs.lstat(directory);
          if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
          entries = await fs.opendir(directory);
        } catch (error) {
          if (error.code === "ENOENT") return [];
          throw invalid();
        }
        const names = [];
        try {
          for await (const entry of entries) {
            if (!/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
            if (names.length >= 1000) throw invalid();
            names.push(entry.name);
          }
        } catch {
          throw invalid();
        }
        const result = [];
        for (const name of names.sort()) {
          const value = await load(null, name);
          if (value)
            result.push({
              registrationId: value.registrationId ?? "primary",
              ...metadata(value),
              binding: value.binding
                ? chatgptModelBinding.parse(value.binding)
                : null,
            });
        }
        return result;
      });
    },
    /** Get the stable host and issued registration for this Orbyn account/server. */
    read() {
      return ordered(async () => {
        let value = await load();
        if (!value) {
          value = {
            version: 1,
            namespace,
            userId,
            registrationId,
            hostId: await getChatgptHostId(directory),
            clientId: null,
            revision: randomUUID(),
          };
          await save(value);
        }
        return metadata(value);
      });
    },
    /** Read verified identity metadata without decrypting plan credentials. */
    connection() {
      return ordered(async () => {
        const value = await load();
        return value?.binding ? chatgptModelBinding.parse(value.binding) : null;
      });
    },
    /** Called only after local signed identity and backend connection verification. */
    linkVerifiedConnection(input, expectedRevision) {
      const binding = chatgptModelBinding.parse(input);
      if (binding.user_id !== userId) throw invalid();
      return ordered(async () => {
        const value = await load();
        if (
          !value ||
          value.revision !== expectedRevision ||
          value.clientId !== binding.client_id
        )
          throw new Error("ChatGPT registration changed. Start again.");
        if (
          value.binding &&
          JSON.stringify(chatgptModelBinding.parse(value.binding)) !==
            JSON.stringify(binding)
        )
          throw new Error(
            "ChatGPT account changed. Use a separate registration.",
          );
        if (value.binding) return metadata(value);
        value.binding = binding;
        value.revision = randomUUID();
        await save(value);
        return metadata(value);
      });
    },
    /** Persist callback registration before exchanging its one-use code. */
    retain(clientId, expectedRevision) {
      chatgptModelBinding.shape.client_id.parse(clientId);
      return ordered(async () => {
        const value = await load();
        if (
          !value ||
          value.revision !== expectedRevision ||
          (value.clientId !== null && value.clientId !== clientId)
        )
          throw new Error("ChatGPT registration changed. Start again.");
        if (value.clientId === clientId) return metadata(value);
        value.clientId = clientId;
        value.revision = randomUUID();
        await save(value);
        return metadata(value);
      });
    },
  };
}

module.exports = { createChatgptRegistrationStore };

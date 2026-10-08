const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const {
  createHash,
  randomUUID,
  createPrivateKey,
  createPublicKey,
} = require("node:crypto");

class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const unavailable = () =>
  new VaultError(
    "STORAGE_UNAVAILABLE",
    "Secure credential storage is unavailable on this device.",
  );
const corrupt = () =>
  new VaultError(
    "STORAGE_INVALID",
    "The ChatGPT connection could not be read. Reconnect this account.",
  );
const conflict = () =>
  new VaultError(
    "STORAGE_CONFLICT",
    "The ChatGPT connection changed. Start again.",
  );

/** A singleton main-process vault. No method or returned credential may cross IPC. */
async function createChatgptVault({
  directory,
  apiBaseUrl,
  safeStorage,
  platform = process.platform,
  purpose = "credentials",
}) {
  let base;
  try {
    base = new URL(apiBaseUrl);
  } catch {}
  if (
    !["credentials", "executor-key"].includes(purpose) ||
    typeof directory !== "string" ||
    !path.isAbsolute(directory) ||
    !base ||
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw corrupt();
  const namespace = base.origin + base.pathname.replace(/\/+$/, "");
  directory = path.join(
    directory,
    createHash("sha256").update(namespace).digest("hex"),
  );
  if (purpose === "executor-key") directory = path.join(directory, purpose);
  const { chatgptModelBinding } = await import("@orbyn/core");
  const queues = new Map(),
    revisions = new Map(),
    epochs = new Map();
  const bindingOf = (value) => chatgptModelBinding.parse(value);
  const keyOf = (binding) =>
    createHash("sha256").update(JSON.stringify(binding)).digest("hex");
  const filename = (key) => path.join(directory, `${key}.enc`);
  const ordered = (key, work) => {
    const result = (queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    const tail = result.catch(() => {});
    queues.set(key, tail);
    void tail.finally(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return result;
  };
  const ensureSecure = async () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw unavailable();
      if (
        platform === "linux" &&
        !["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
          safeStorage.getSelectedStorageBackend(),
        )
      )
        throw unavailable();
      // On Linux the synchronous provider can be positively identified. Never
      // choose the async fallback or basic_text when a secure provider is absent.
      if (
        platform !== "linux" &&
        !(await safeStorage.isAsyncEncryptionAvailable())
      )
        throw unavailable();
    } catch {
      throw unavailable();
    }
  };
  const credentialsOf = (value, binding) => {
    if (purpose === "executor-key") {
      try {
        if (
          !value ||
          Object.keys(value).sort().join(",") !==
            "createdAt,privateKey,publicKey" ||
          typeof value.privateKey !== "string" ||
          !/^[A-Za-z0-9_-]{64}$/.test(value.privateKey) ||
          typeof value.publicKey !== "string" ||
          !/^[A-Za-z0-9_-]{59}$/.test(value.publicKey) ||
          !Number.isSafeInteger(value.createdAt) ||
          value.createdAt < 0
        )
          throw corrupt();
        const privateBytes = Buffer.from(value.privateKey, "base64url");
        if (
          privateBytes.length !== 48 ||
          privateBytes.toString("base64url") !== value.privateKey
        )
          throw corrupt();
        const privateKey = createPrivateKey({
          key: privateBytes,
          format: "der",
          type: "pkcs8",
        });
        if (
          privateKey.asymmetricKeyType !== "ed25519" ||
          privateKey
            .export({ format: "der", type: "pkcs8" })
            .toString("base64url") !== value.privateKey ||
          createPublicKey(privateKey)
            .export({ format: "der", type: "spki" })
            .toString("base64url") !== value.publicKey
        )
          throw corrupt();
        return {
          privateKey: value.privateKey,
          publicKey: value.publicKey,
          createdAt: value.createdAt,
        };
      } catch {
        throw corrupt();
      }
    }
    const token = (v) =>
      typeof v === "string" &&
      v.length > 0 &&
      v.length <= 65_536 &&
      !/[\x00-\x20\x7f]/.test(v);
    if (
      !value ||
      value.clientId !== binding.client_id ||
      !token(value.idToken) ||
      !token(value.accessToken) ||
      (value.refreshToken !== null && !token(value.refreshToken)) ||
      value.tokenType !== "Bearer" ||
      !Array.isArray(value.scopes) ||
      value.scopes.length > 100 ||
      value.scopes.some(
        (s) => typeof s !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(s),
      ) ||
      !Number.isSafeInteger(value.savedAt) ||
      value.savedAt < 0 ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= value.savedAt ||
      value.expiresAt > 8_640_000_000_000_000
    )
      throw corrupt();
    const scopes = [...new Set(value.scopes)];
    return {
      clientId: value.clientId,
      idToken: value.idToken,
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      tokenType: "Bearer",
      scopes,
      savedAt: value.savedAt,
      expiresAt: value.expiresAt,
      sharingGranted: scopes.includes("chatgpt.tokens.use.direct"),
    };
  };
  const read = async (binding, key) => {
    let bytes;
    let file;
    try {
      // Open once without following a replacement symlink, then inspect and
      // bound reads through that same descriptor even if the path changes.
      const before = await fs.lstat(filename(key));
      if (!before.isFile() || before.isSymbolicLink() || before.size > 524_288)
        throw corrupt();
      file = await fs.open(
        filename(key),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.size > 524_288 ||
        info.dev !== before.dev ||
        info.ino !== before.ino
      )
        throw corrupt();
      await ensureSecure();
      const buffer = Buffer.alloc(524_289);
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
      if (length > 524_288) throw corrupt();
      bytes = buffer.subarray(0, length);
    } catch (error) {
      if (error.code === "ENOENT")
        return { revision: revisions.get(key) ?? null, credentials: null };
      if (error instanceof VaultError) throw error;
      throw corrupt();
    } finally {
      await file?.close().catch(() => {});
    }
    try {
      const decrypted =
        platform === "linux"
          ? { result: safeStorage.decryptString(bytes), shouldReEncrypt: false }
          : await safeStorage.decryptStringAsync(bytes);
      const text = decrypted.result;
      const saved = JSON.parse(text);
      const decodedBinding = bindingOf(saved.binding);
      if (
        saved.version !== 1 ||
        (saved.purpose ?? "credentials") !== purpose ||
        saved.namespace !== namespace ||
        keyOf(decodedBinding) !== key ||
        !chatgptModelBinding.shape.connection_id.safeParse(saved.revision)
          .success
      )
        throw corrupt();
      const revision = revisions.get(key) ?? saved.revision;
      if (revision !== saved.revision) throw conflict();
      const credentials = credentialsOf(saved.credentials, binding);
      if (decrypted.shouldReEncrypt) {
        let renewed;
        try {
          renewed = await safeStorage.encryptStringAsync(text);
        } catch {
          throw unavailable();
        }
        if (
          !Buffer.isBuffer(renewed) ||
          !renewed.length ||
          renewed.length > 524_288
        )
          throw unavailable();
        await atomicWrite(key, renewed);
      }
      revisions.set(key, revision);
      return { revision, credentials };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw corrupt();
    }
  };
  const atomicWrite = async (key, bytes) => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw corrupt();
    await fs.chmod(directory, 0o700);
    const temporary = path.join(directory, `${key}.${randomUUID()}.tmp`);
    let file;
    try {
      file = await fs.open(temporary, "wx", 0o600);
      await file.writeFile(bytes);
      await file.sync();
      await file.close();
      file = null;
      await fs.rename(temporary, filename(key));
    } finally {
      await file?.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  };
  return {
    /** Read one verified registration; a disconnected slot still has a fenced revision. */
    async read(value) {
      const binding = bindingOf(value),
        key = keyOf(binding);
      const epoch = epochs.get(key) ?? 0;
      return ordered(key, async () => {
        if ((epochs.get(key) ?? 0) !== epoch) throw conflict();
        const result = await read(binding, key);
        if ((epochs.get(key) ?? 0) !== epoch) throw conflict();
        return result;
      });
    },
    /** Replace all rotating credentials together, only from the observed revision. */
    async write(value, credentials, expectedRevision) {
      const binding = bindingOf(value),
        key = keyOf(binding);
      const epoch = epochs.get(key) ?? 0;
      return ordered(key, async () => {
        if ((epochs.get(key) ?? 0) !== epoch) throw conflict();
        const current = await read(binding, key);
        if ((epochs.get(key) ?? 0) !== epoch) throw conflict();
        if (current.revision !== expectedRevision) throw conflict();
        await ensureSecure();
        if ((epochs.get(key) ?? 0) !== epoch) throw conflict();
        const normalized = credentialsOf(credentials, binding);
        const revision = randomUUID();
        const plaintext = JSON.stringify({
          version: 1,
          ...(purpose === "executor-key" ? { purpose } : {}),
          namespace,
          binding,
          revision,
          credentials: normalized,
        });
        let encrypted;
        try {
          encrypted =
            platform === "linux"
              ? safeStorage.encryptString(plaintext)
              : await safeStorage.encryptStringAsync(plaintext);
        } catch {
          throw unavailable();
        }
        if (
          !Buffer.isBuffer(encrypted) ||
          !encrypted.length ||
          encrypted.length > 524_288
        )
          throw unavailable();
        if ((epochs.get(key) ?? 0) !== epoch) throw conflict();
        try {
          await atomicWrite(key, encrypted);
        } catch (error) {
          if (error instanceof VaultError) throw error;
          throw unavailable();
        }
        if ((epochs.get(key) ?? 0) !== epoch) throw conflict();
        revisions.set(key, revision);
        return revision;
      });
    },
    /** Erase only the observed credential revision; preserve a later reconnect. */
    async revokeObserved(value, expectedRevision, { signal } = {}) {
      const binding = bindingOf(value),
        key = keyOf(binding);
      const epoch = epochs.get(key) ?? 0;
      return ordered(key, async () => {
        signal?.throwIfAborted();
        if ((epochs.get(key) ?? 0) !== epoch) throw conflict();
        const current = await read(binding, key);
        signal?.throwIfAborted();
        if (
          (epochs.get(key) ?? 0) !== epoch ||
          current.revision !== expectedRevision
        )
          throw conflict();
        epochs.set(key, epoch + 1);
        await fs.unlink(filename(key)).catch((error) => {
          if (error.code !== "ENOENT") throw unavailable();
        });
        const revision = randomUUID();
        revisions.set(key, revision);
        return revision;
      });
    },
    /** Erase without requiring an unlocked keychain; fence any pending refresh/install. */
    async revoke(value) {
      const binding = bindingOf(value),
        key = keyOf(binding);
      // Revocation fences in-flight OS keychain work immediately, before it
      // waits its turn to erase the credential file.
      epochs.set(key, (epochs.get(key) ?? 0) + 1);
      return ordered(key, async () => {
        await fs.unlink(filename(key)).catch((error) => {
          if (error.code !== "ENOENT") throw unavailable();
        });
        // An opaque generation cannot collide with a stored revision even if
        // the keychain was locked and this process never decrypted the record.
        const revision = randomUUID();
        revisions.set(key, revision);
        return revision;
      });
    },
  };
}

module.exports = { createChatgptVault };

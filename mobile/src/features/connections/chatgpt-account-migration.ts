import { z } from "zod";
import { chatgptConnection } from "@orbyn/core";
import { parseChatgptLocalGrant } from "@orbyn/api-client";
import type { createNativeChatgptAccountDirectory } from "./chatgpt-account-directory";
import type { createNativeChatgptProtectedStore } from "./chatgpt-protected-store";

const savedRecord = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    revision: z.uuid(),
    connection: chatgptConnection,
    grant: z.unknown(),
    signingAlias: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const conflict = () =>
  new Error("The saved ChatGPT account changed. Try again.");
const unavailable = () =>
  new Error("The saved ChatGPT account migration is unavailable. Try again.");

/** Transfer only a previously protected singleton. This does not verify a new OAuth grant or activate an executor. */
export async function migrateNativeChatgptSingleton(options: {
  storage: Awaited<ReturnType<typeof createNativeChatgptProtectedStore>>;
  directory: ReturnType<typeof createNativeChatgptAccountDirectory>;
  /** Caller must stop executors and serialize sign-in/refresh/disconnect before migration. */
  checkOwner: () => void | Promise<void>;
}) {
  const { storage, directory } = options;
  const guard = async () => {
    try {
      await options.checkOwner();
    } catch {
      throw conflict();
    }
  };
  await guard();
  const original = await storage.read(storage.legacyKey);
  await guard();
  if (original === null) return directory.read();
  let saved: z.output<typeof savedRecord>;
  try {
    saved = savedRecord.parse(JSON.parse(original));
    if (saved.version === 2) {
      if (saved.grant !== null) throw unavailable();
    } else if (
      parseChatgptLocalGrant(saved.grant).clientId !==
      saved.connection.client_id
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
  const status =
    saved.version === 2 ? ("reconnect" as const) : ("connected" as const);
  const transferred = JSON.stringify({
    ...saved,
    signingAlias: saved.signingAlias ?? storage.legacyKey.split(".").at(-1)!,
  });
  const slot = storage.slotKey(saved.connection.id);
  const match = (state: Awaited<ReturnType<typeof directory.read>>) => {
    if (!state || state.accounts.length !== 1) throw conflict();
    const entry = state.accounts[0];
    if (
      JSON.stringify(entry.connection) !== JSON.stringify(saved.connection) ||
      entry.status !== status ||
      state.selected !== (status === "connected" ? saved.connection.id : null)
    )
      throw conflict();
    return state;
  };
  const existingDirectory = await directory.read();
  await guard();
  if (existingDirectory !== null) match(existingDirectory);
  // Every phase is resumable. Do not remove a slot after a directory may have committed.
  const previous = await storage.read(slot);
  await guard();
  if (previous === null) {
    if (!(await storage.compareAndSwap(slot, null, transferred)))
      throw conflict();
  } else if (previous !== transferred) throw conflict();
  await guard();
  const before = await directory.read();
  await guard();
  const state =
    before === null
      ? await directory.importSingleton(saved.connection, status)
      : match(before);
  match(state);
  await guard();
  // Publish before erasing; callers cannot execute until this exact cleanup succeeds.
  if (!(await storage.compareAndSwap(storage.legacyKey, original, null)))
    throw conflict();
  await guard();
  if ((await storage.read(slot)) !== transferred) throw conflict();
  await guard();
  return state;
}

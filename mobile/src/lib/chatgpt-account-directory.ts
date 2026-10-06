import { z } from "zod";
import { chatgptConnection, type ChatgptConnection } from "@orbyn/core";

const status = z.enum(["connected", "disconnected", "reconnect"]);
const account = z.object({ connection: chatgptConnection, status }).strict();
const owner = z
  .object({ apiBaseUrl: z.string().min(1).max(4096), userId: z.uuid() })
  .strict();
const record = z
  .object({
    version: z.literal(1),
    owner,
    revision: z.uuid(),
    selected: z.uuid().nullable(),
    accounts: z.array(account).max(100),
  })
  .strict();
type DirectoryRecord = z.output<typeof record>;
export type NativeChatgptDirectorySnapshot = Pick<
  DirectoryRecord,
  "revision" | "selected" | "accounts"
>;

/** Metadata is not credential authority. The native owner must verify and store grants separately. */
export function createNativeChatgptAccountDirectory(options: {
  owner: z.input<typeof owner>;
  digest: (value: string) => Promise<string>;
  revision: () => string;
  checkOwner: () => void | Promise<void>;
  storage: {
    read: (key: string) => Promise<string | null>;
    /** Must atomically compare and replace in the protected store's owner queue. */
    compareAndSwap: (
      key: string,
      expected: string | null,
      replacement: string,
    ) => Promise<boolean>;
  };
}) {
  const binding = owner.parse(options.owner);
  const url = new URL(binding.apiBaseUrl);
  // Namespace metadata only; transport policy belongs to the configured API client.
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new Error("The ChatGPT account directory owner is invalid.");
  const conflict = () =>
    new Error("The ChatGPT account selection changed. Try again.");
  const invalid = () =>
    new Error("The saved ChatGPT account directory is unavailable.");
  let key: Promise<string> | null = null;
  const storageKey = () =>
    (key ??= options
      .digest(JSON.stringify(binding))
      .then((digest) => {
        if (!/^[a-f0-9]{64}$/.test(digest)) throw invalid();
        return `orbyn.chatgpt.directory.${digest}`;
      })
      .catch(() => {
        key = null;
        throw invalid();
      }));
  const validate = (value: unknown) => {
    const parsed = record.parse(value);
    if (JSON.stringify(parsed.owner) !== JSON.stringify(binding))
      throw invalid();
    const ids = new Set<string>(),
      registrations = new Set<string>();
    for (const entry of parsed.accounts) {
      const registration = JSON.stringify([
        entry.connection.issuer,
        entry.connection.subject,
        entry.connection.client_id,
      ]);
      if (ids.has(entry.connection.id) || registrations.has(registration))
        throw invalid();
      ids.add(entry.connection.id);
      registrations.add(registration);
    }
    if (
      parsed.selected !== null &&
      !parsed.accounts.some(
        (entry) =>
          entry.connection.id === parsed.selected &&
          entry.status === "connected",
      )
    )
      throw invalid();
    return parsed;
  };
  const load = async () => {
    await options.checkOwner();
    const name = await storageKey();
    await options.checkOwner();
    let raw: string | null;
    try {
      raw = await options.storage.read(name);
    } catch {
      throw invalid();
    }
    await options.checkOwner();
    try {
      if (raw !== null && raw.length > 262144) throw invalid();
      const value = raw === null ? null : validate(JSON.parse(raw));
      return { name, raw, value };
    } catch {
      throw invalid();
    }
  };
  const snapshot = (
    value: DirectoryRecord,
  ): NativeChatgptDirectorySnapshot => ({
    revision: value.revision,
    selected: value.selected,
    accounts: value.accounts.map((entry) => ({
      connection: { ...entry.connection },
      status: entry.status,
    })),
  });
  const mutate = async (
    expected: string | null,
    change: (value: DirectoryRecord) => void,
  ) => {
    const current = await load();
    if ((current.value?.revision ?? null) !== expected) throw conflict();
    let revision: string;
    try {
      revision = z.uuid().parse(options.revision());
    } catch {
      throw invalid();
    }
    if (revision === current.value?.revision) throw conflict();
    const next = current.value ?? {
      version: 1 as const,
      owner: binding,
      revision,
      selected: null,
      accounts: [],
    };
    change(next);
    next.revision = revision;
    const validated = validate(next);
    await options.checkOwner();
    let installed: boolean;
    try {
      installed = await options.storage.compareAndSwap(
        current.name,
        current.raw,
        JSON.stringify(validated),
      );
    } catch {
      throw invalid();
    }
    if (installed !== true) throw conflict();
    await options.checkOwner();
    return snapshot(validated);
  };
  return {
    async read(): Promise<NativeChatgptDirectorySnapshot | null> {
      const { value } = await load();
      return value ? snapshot(value) : null;
    },
    /** Register only after identity/grant verification; this does not activate inference. */
    add(input: ChatgptConnection, expected: string | null) {
      const connection = chatgptConnection.parse(input);
      return mutate(expected, (value) => {
        const existing = value.accounts.find(
          (entry) => entry.connection.id === connection.id,
        );
        if (existing) {
          if (
            JSON.stringify(existing.connection) !== JSON.stringify(connection)
          )
            throw conflict();
          existing.status = "connected";
        } else value.accounts.push({ connection, status: "connected" });
      });
    },
    /** Caller must first verify the selected slot's current credentials and live server identity. */
    select(id: string, expected: string) {
      z.uuid().parse(id);
      return mutate(expected, (value) => {
        if (
          !value.accounts.some(
            (entry) =>
              entry.connection.id === id && entry.status === "connected",
          )
        )
          throw conflict();
        value.selected = id;
      });
    },
    /** Caller must finish the slot's credential cleanup before marking it unavailable. */
    markUnavailable(
      id: string,
      nextStatus: "disconnected" | "reconnect",
      expected: string,
    ) {
      z.uuid().parse(id);
      if (nextStatus !== "disconnected" && nextStatus !== "reconnect")
        throw conflict();
      return mutate(expected, (value) => {
        const entry = value.accounts.find(
          (entry) => entry.connection.id === id,
        );
        if (!entry) throw conflict();
        entry.status = nextStatus;
        if (value.selected === id) value.selected = null;
      });
    },
  };
}

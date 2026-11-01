import {
  parseVersionedDocContent,
  type VersionedDocContent,
} from "@orbyn/core";

/** The existing payload stays readable by old clients; ownership lives in keys. */
export type Backup = {
  version: number;
  baseTitle: string;
  title: string;
  base: VersionedDocContent;
  document: VersionedDocContent;
  at: string;
  source?: string;
};
export type BackupOwner = {
  userId: string;
  docId: string;
  bufferId: string;
  keys: Set<string>;
  latestKey: string | null;
  writeError: string;
  cleanupError: string;
};
export type RecoveryCopy = {
  key: string;
  storageKey: string;
  raw: string;
  backup: Backup;
  legacy: boolean;
  digest?: string;
};
type Result = { ok: true } | { ok: false; error: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const legacyBackupKey = (userId: string, docId: string) =>
  `orbyn-page-draft:${userId}:${docId}`;
const prefix = (owner: BackupOwner) =>
  `${legacyBackupKey(owner.userId, owner.docId)}:v2:`;
const writerPrefix = (owner: BackupOwner) =>
  `${prefix(owner)}${owner.bufferId}:`;
const marker = (owner: BackupOwner, digest: string) =>
  `${legacyBackupKey(owner.userId, owner.docId)}:dismissed:${digest}`;

export function parseBackup(value: unknown): Backup {
  if (
    !object(value) ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.baseTitle !== "string" ||
    typeof value.title !== "string" ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at)) ||
    (value.source !== undefined && typeof value.source !== "string")
  )
    throw new Error("Invalid page recovery copy.");
  return {
    version: value.version,
    baseTitle: value.baseTitle,
    title: value.title,
    at: value.at,
    base: parseVersionedDocContent(value.base, { projected: true }),
    document: parseVersionedDocContent(value.document, { projected: true }),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
  };
}

export function createBackupOwner(userId: string, docId: string): BackupOwner {
  return {
    userId,
    docId,
    bufferId: crypto.randomUUID(),
    keys: new Set(),
    latestKey: null,
    writeError: "",
    cleanupError: "",
  };
}

/** Only keys minted by this buffer are eligible for automatic cleanup. */
export function retryBackupCleanup(owner: BackupOwner): Result {
  let failed = false;
  for (const key of owner.keys) {
    if (key === owner.latestKey) continue;
    try {
      if (!key.startsWith(writerPrefix(owner)))
        throw new Error("Wrong backup owner.");
      localStorage.removeItem(key);
      owner.keys.delete(key);
    } catch {
      failed = true;
    }
  }
  owner.cleanupError = failed
    ? "Some older copies from this editor couldn't be removed. Try again."
    : "";
  return failed ? { ok: false, error: owner.cleanupError } : { ok: true };
}

/** A fresh immutable key on every attempt: no compare-then-write ownership race. */
export function putBackup(owner: BackupOwner, backup: Backup): Result {
  if (!owner.userId || !owner.docId)
    return {
      ok: false,
      error: "Open your account before keeping a page recovery copy.",
    };
  const key = `${writerPrefix(owner)}${crypto.randomUUID()}`;
  try {
    localStorage.setItem(key, JSON.stringify(backup));
    owner.keys.add(key);
    owner.latestKey = key;
    owner.writeError = "";
  } catch {
    owner.writeError =
      "This page draft couldn't be kept on this device. Keep the page open or save a draft copy.";
    return { ok: false, error: owner.writeError };
  }
  // A failed delete never invalidates the new durable put or touches a peer.
  retryBackupCleanup(owner);
  return { ok: true };
}

export function clearOwnedBackups(owner: BackupOwner): Result {
  owner.latestKey = null;
  owner.writeError = "";
  return retryBackupCleanup(owner);
}

export async function readRecoveryCopies(
  owner: BackupOwner,
  current: () => boolean,
) {
  const copies: RecoveryCopy[] = [];
  let error = "";
  const failed = () => {
    error =
      "Some page recovery copies couldn't be read on this device. Try again.";
  };
  try {
    const names: string[] = [];
    const legacy = legacyBackupKey(owner.userId, owner.docId);
    names.push(legacy);
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (
        key?.startsWith(prefix(owner)) &&
        !key.startsWith(writerPrefix(owner))
      )
        names.push(key);
    }
    for (const storageKey of names) {
      if (!current()) return { copies: [], error: "", cancelled: true };
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw === null) continue;
        const backup = parseBackup(JSON.parse(raw));
        if (storageKey === legacy) {
          const bytes = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(raw),
          );
          if (!current()) return { copies: [], error: "", cancelled: true };
          const digest = [...new Uint8Array(bytes)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          const acknowledged = localStorage.getItem(marker(owner, digest));
          if (acknowledged === "1") continue;
          if (acknowledged !== null) failed();
          copies.push({
            key: `${legacy}:sha256:${digest}`,
            storageKey,
            raw,
            backup,
            legacy: true,
            digest,
          });
        } else {
          const parts = storageKey.slice(prefix(owner).length).split(":");
          if (parts.length !== 2 || !parts.every((part) => uuid.test(part)))
            throw new Error("Invalid immutable backup key.");
          copies.push({
            key: storageKey,
            storageKey,
            raw,
            backup,
            legacy: false,
          });
        }
      } catch {
        failed();
      }
    }
  } catch {
    failed();
  }
  return {
    copies: copies.sort((a, b) => b.backup.at.localeCompare(a.backup.at)),
    error,
    cancelled: false,
  };
}

/** Only an explicit action can retire an offered peer copy. Legacy stays intact. */
export function retireRecoveryCopy(
  owner: BackupOwner,
  offer: RecoveryCopy,
): Result {
  try {
    const legacy = legacyBackupKey(owner.userId, owner.docId);
    if (offer.legacy) {
      if (
        offer.storageKey !== legacy ||
        !offer.digest ||
        !/^[0-9a-f]{64}$/.test(offer.digest) ||
        offer.key !== `${legacy}:sha256:${offer.digest}`
      )
        throw new Error("Wrong recovery owner.");
      localStorage.setItem(marker(owner, offer.digest), "1");
    } else {
      if (
        !offer.storageKey.startsWith(prefix(owner)) ||
        offer.key !== offer.storageKey ||
        offer.storageKey.startsWith(writerPrefix(owner))
      )
        throw new Error("Wrong recovery owner.");
      const previous = localStorage.getItem(offer.storageKey);
      if (previous !== null && previous !== offer.raw)
        return {
          ok: false,
          error:
            "This recovery copy changed. Try again before choosing what to keep.",
        };
      localStorage.removeItem(offer.storageKey);
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: offer.legacy
        ? "This legacy recovery copy couldn't be dismissed. Its original is still kept."
        : "This recovery copy couldn't be removed from this device.",
    };
  }
}

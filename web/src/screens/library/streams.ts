import type { DocNews, LiveNews } from "@orbyn/api-client";
import { client, getSessionVersion } from "../../lib/session";

/**
 * Browsers allow few open connections per host, and each stream holds one.
 * Everything on a page shares one account stream and one stream per document.
 */
type News = (news: LiveNews) => void;
const accountListeners = new Set<News>();
let stopAccount: (() => void) | null = null;
let accountGeneration = getSessionVersion();

export function watchAccount(listener: News) {
  const generation = getSessionVersion();
  const owned = (news: LiveNews) => {
    if (generation === getSessionVersion()) listener(news);
  };
  accountListeners.add(owned);
  if (accountGeneration !== generation) {
    stopAccount?.();
    stopAccount = null;
    accountGeneration = generation;
  }
  stopAccount ??= client.watchEvents((news) => {
    if (generation !== getSessionVersion()) return;
    if (news.kind === "changed") client.noteExternalMutation();
    accountListeners.forEach((one) => one(news));
  });
  return () => {
    accountListeners.delete(owned);
    if (!accountListeners.size) {
      stopAccount?.();
      stopAccount = null;
    }
  };
}

type Change = (version: number, news: DocNews) => void;
const docs = new Map<string, { listeners: Set<Change>; stop: () => void }>();

export function watchPage(id: string, listener: Change) {
  const generation = getSessionVersion();
  const key = `${generation}:${id}`;
  let entry = docs.get(key);
  if (!entry) {
    const listeners = new Set<Change>();
    entry = {
      listeners,
      stop: client.watchDoc(id, (version, news) => {
        if (generation !== getSessionVersion()) return;
        client.noteExternalMutation();
        listeners.forEach((one) => one(version, news));
      }),
    };
    docs.set(key, entry);
  }
  entry.listeners.add(listener);
  const held = entry;
  return () => {
    held.listeners.delete(listener);
    if (!held.listeners.size) {
      held.stop();
      docs.delete(key);
    }
  };
}

/** For the shared refresh helper, which needs a `watchDoc`-shaped owner. */
export const pageWatcher = {
  watchDoc: (id: string, changed: () => void) => watchPage(id, () => changed()),
};

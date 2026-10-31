import type { DocNews, LiveNews } from "@orbyn/api-client";
import { client } from "../../lib/session";

/**
 * Browsers allow few open connections per host, and each stream holds one.
 * Everything on a page shares one account stream and one stream per document.
 */
type News = (news: LiveNews) => void;
const accountListeners = new Set<News>();
let stopAccount: (() => void) | null = null;

export function watchAccount(listener: News) {
  accountListeners.add(listener);
  stopAccount ??= client.watchEvents((news) =>
    accountListeners.forEach((one) => one(news)),
  );
  return () => {
    accountListeners.delete(listener);
    if (!accountListeners.size) {
      stopAccount?.();
      stopAccount = null;
    }
  };
}

type Change = (version: number, news: DocNews) => void;
const docs = new Map<string, { listeners: Set<Change>; stop: () => void }>();

export function watchPage(id: string, listener: Change) {
  let entry = docs.get(id);
  if (!entry) {
    const listeners = new Set<Change>();
    entry = {
      listeners,
      stop: client.watchDoc(id, (version, news) =>
        listeners.forEach((one) => one(version, news)),
      ),
    };
    docs.set(id, entry);
  }
  entry.listeners.add(listener);
  const held = entry;
  return () => {
    held.listeners.delete(listener);
    if (!held.listeners.size) {
      held.stop();
      docs.delete(id);
    }
  };
}

/** For the shared refresh helper, which needs a `watchDoc`-shaped owner. */
export const pageWatcher = {
  watchDoc: (id: string, changed: () => void) => watchPage(id, () => changed()),
};

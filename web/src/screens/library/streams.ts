import type { DocNews } from "@orbyn/api-client";
import { client, getSessionVersion } from "../../lib/session";

/**
 * Browsers allow few open connections per host, and each stream holds one.
 * Everything on a page shares one account stream and one stream per document.
 */
export { watchAccount } from "../../lib/account-events";

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

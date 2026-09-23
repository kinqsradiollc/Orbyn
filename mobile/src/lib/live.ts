import type { LiveNews } from "@orbyn/api-client";

/**
 * News from the server, handed to whichever screen cares: the planner
 * refreshes on "changed", the sync sheet on "presence", an open page on
 * "doc_presence" for its own id. One stream feeds them all.
 */
type Listener = (news: LiveNews) => void;
const listeners = new Set<Listener>();

export function onLive(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function emitLive(news: LiveNews) {
  for (const l of listeners) l(news);
}

/** The page open on this phone, for presence; set by the page editor. */
let openDoc: string | null = null;
const docListeners = new Set<() => void>();
export const currentDoc = () => openDoc;
export function setOpenDoc(id: string | null) {
  if (openDoc === id) return;
  openDoc = id;
  for (const l of docListeners) l();
}
export function onOpenDoc(listener: () => void) {
  docListeners.add(listener);
  return () => void docListeners.delete(listener);
}

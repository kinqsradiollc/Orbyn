/**
 * Opening the Review inbox on one proposal from anywhere in the app (an
 * agent's activity in Settings, a notice), without threading a callback
 * through every screen in between. The app shell listens.
 */
type Listener = (proposalId: string) => void;
const listeners = new Set<Listener>();

export function openReview(proposalId: string) {
  for (const l of listeners) l(proposalId);
}

export function onOpenReview(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

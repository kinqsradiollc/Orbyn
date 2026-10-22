import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { AssistantSavedHistoryStore } from "@orbyn/api-client";
import { X } from "lucide-react";
import { client } from "../../lib/api";
import { session } from "../../lib/session";

export function SavedConversationHistory({
  destinationId,
  chatId,
  onClose,
  modal,
}: {
  destinationId: string;
  chatId: string;
  onClose: () => void;
  modal: boolean;
}) {
  const owner = session.get();
  const store = useMemo(
    () =>
      new AssistantSavedHistoryStore(
        client,
        destinationId,
        chatId,
        session.get,
      ),
    [destinationId, chatId, owner],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const id = useId(),
    body = useRef<HTMLDivElement>(null),
    anchor = useRef<{ height: number; top: number } | null>(null);
  const previous = useRef(0);
  useEffect(() => {
    void store.refresh();
    const validate = () => {
      if (!document.hidden) void store.validate();
    };
    const timer = window.setInterval(validate, 15000);
    window.addEventListener("focus", validate);
    document.addEventListener("visibilitychange", validate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", validate);
      document.removeEventListener("visibilitychange", validate);
      store.reset();
    };
  }, [store]);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    if (anchor.current) {
      node.scrollTop =
        anchor.current.top + node.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (previous.current === 0 && state.turns.length)
      node.scrollTop = node.scrollHeight;
    previous.current = state.turns.length;
  }, [state.turns]);
  return (
    <aside
      className="ai-upcoming"
      role={modal ? "dialog" : "complementary"}
      aria-modal={modal || undefined}
      aria-labelledby={id}
    >
      <header className="ai-upcoming-head">
        <h2 id={id}>Previous saved history</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close saved history"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="ai-upcoming-body" ref={body}>
        {state.error ? (
          <p role="alert">
            Saved history changed or is unavailable.{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => void store.refresh()}
            >
              Reload
            </button>
          </p>
        ) : (
          <>
            {state.before !== null && (
              <button
                type="button"
                className="text-button"
                disabled={state.busy}
                onClick={() => {
                  const node = body.current;
                  if (node)
                    anchor.current = {
                      height: node.scrollHeight,
                      top: node.scrollTop,
                    };
                  void store.loadEarlier();
                }}
              >
                Earlier messages
              </button>
            )}
            {state.busy && <p role="status">Loading saved history…</p>}
            {!state.busy && !state.turns.length && (
              <p>No earlier saved messages.</p>
            )}
            {state.turns.map((turn, index) => (
              <article
                className="ai-legacy-turn"
                key={`${index}:${turn.turn_id ?? turn.role}`}
              >
                <p className="muted">
                  {turn.role === "user" ? "You" : "Assistant"}
                </p>
                <p>{turn.text}</p>
              </article>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

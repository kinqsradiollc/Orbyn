import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { TOAST_MS } from "@orbyn/core";

/**
 * A short sentence, and at most one thing to do about it. `warn` is for
 * something that didn't happen ("stayed put"), read out at once.
 */
export type ToastOptions = {
  text: string;
  action?: { label: string; run: () => void };
  tone?: "warn";
};

type Shown = ToastOptions & { key: number };

const Ctx = createContext<((o: ToastOptions) => void) | null>(null);

/**
 * One toast for the whole app: a short sentence plus at most one action,
 * bottom-left on a desktop and at the top on a phone, gone after four
 * seconds. It is what a reversible action says instead of asking "are you
 * sure" first — "Moved to Trash · Undo" — so the question is only ever asked
 * about things that can't be taken back.
 *
 * A new toast replaces the one showing. Hovering or focusing it holds it, so
 * Undo never slips away under the pointer.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [held, setHeld] = useState(false);
  const count = useRef(0);

  const toast = useCallback((o: ToastOptions) => {
    count.current += 1;
    setShown({ ...o, key: count.current });
  }, []);

  useEffect(() => {
    if (!shown || held) return;
    const t = setTimeout(() => setShown(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [shown, held]);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {shown && (
          <div
            key={shown.key}
            className={"toast" + (shown.tone === "warn" ? " is-warn" : "")}
            role={shown.tone === "warn" ? "alert" : "status"}
            onMouseEnter={() => setHeld(true)}
            onMouseLeave={() => setHeld(false)}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
          >
            <span className="toast-text">{shown.text}</span>
            {shown.action && (
              <button
                className="toast-action"
                onClick={() => {
                  const run = shown.action!.run;
                  setShown(null);
                  setHeld(false);
                  run();
                }}
              >
                {shown.action.label}
              </button>
            )}
            <button
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => {
                setShown(null);
                setHeld(false);
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

/**
 * Show a toast. Outside a ToastProvider (a page rendered on its own) it
 * does nothing, rather than failing the action it was reporting on.
 */
export function useToast(): (o: ToastOptions) => void {
  return useContext(Ctx) ?? noop;
}

const noop = () => {};

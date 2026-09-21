import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";

export type AskOptions = {
  /** The question, as a short sentence. */
  title: string;
  /** What will happen, when that is worth spelling out. */
  body?: string;
  /** The word on the button that goes ahead. Defaults to "Continue". */
  confirmLabel?: string;
  /** Marks the action as one that destroys something. */
  destructive?: boolean;
  /** Leaves out the cancel button: a message rather than a question. */
  tellOnly?: boolean;
};

type Pending = AskOptions & { settle: (ok: boolean) => void };

const Ctx = createContext<{
  ask: (o: AskOptions) => Promise<boolean>;
  tell: (o: Omit<AskOptions, "tellOnly">) => Promise<void>;
} | null>(null);

/**
 * Questions and messages, asked in Orbyn's own words and Orbyn's own frame.
 *
 * The browser's `confirm` and `alert` are the one part of the app that never
 * matched it: another typeface, the site's address above the message, and a
 * page that freezes until it is dismissed. This puts them in the same modal
 * everything else uses, and hands back a promise so a caller reads much as
 * it did before.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (o: AskOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...o, settle: resolve })),
    [],
  );
  const tell = useCallback(
    (o: Omit<AskOptions, "tellOnly">) =>
      new Promise<boolean>((resolve) =>
        setPending({ ...o, tellOnly: true, settle: resolve }),
      ).then(() => undefined),
    [],
  );

  return (
    <Ctx.Provider value={{ ask, tell }}>
      {children}
      {pending && (
        <ConfirmDialog
          {...pending}
          onDone={(ok) => {
            pending.settle(ok);
            setPending(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

/** `ask` for a question, `tell` for a message. Both resolve when it is closed. */
export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm needs a ConfirmProvider above it");
  return ctx;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive,
  tellOnly,
  onDone,
}: AskOptions & { onDone: (ok: boolean) => void }) {
  const go = useRef<HTMLButtonElement>(null);
  const latest = useRef(onDone);
  latest.current = onDone;

  // Focus lands on the button that goes ahead, and returns where it came
  // from afterwards, so the keyboard is never left somewhere unexpected.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    go.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        latest.current(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onDone(false)}
    >
      <div
        className="modal modal-small confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? "confirm-body" : undefined}
      >
        <div className="confirm-body">
          {destructive && (
            <span className="confirm-mark" aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
          )}
          <div>
            <h2 id="confirm-title">{title}</h2>
            {body && <p id="confirm-body">{body}</p>}
          </div>
        </div>
        <div className="confirm-actions">
          {!tellOnly && (
            <button className="ghost" onClick={() => onDone(false)}>
              Cancel
            </button>
          )}
          <button
            ref={go}
            className={"primary" + (destructive ? " is-destructive" : "")}
            onClick={() => onDone(true)}
          >
            {confirmLabel ?? (tellOnly ? "OK" : "Continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";

export type AskOptions = {
  /** The question, as a short sentence. */
  title: string;
  /** What will happen, when that is worth spelling out. */
  body?: string;
  /** The word on the button that goes ahead. Defaults to "Continue". */
  confirmLabel?: string;
  /** Names the safe return path when Cancel would be ambiguous. */
  cancelLabel?: string;
  /** Marks the action as one that destroys something. */
  destructive?: boolean;
  /** Leaves out the cancel button: a message rather than a question. */
  tellOnly?: boolean;
};

type PromptOptions = Omit<AskOptions, "tellOnly"> & {
  label: string;
  value?: string;
  type?: "text" | "password";
  required?: boolean;
};
type Pending = AskOptions & {
  id?: number;
  input?: PromptOptions;
  returnFocus?: HTMLElement | null;
  settle: (ok: boolean, value?: string) => void;
};

const Ctx = createContext<{
  ask: (o: AskOptions) => Promise<boolean>;
  tell: (o: Omit<AskOptions, "tellOnly">) => Promise<void>;
  prompt: (o: PromptOptions) => Promise<string | null>;
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
  const [queue, setQueue] = useState<Pending[]>([]);
  const serial = useRef(0);
  const queueOpener = useRef<HTMLElement | null>(null);
  const pending = queue[0];
  const enqueue = useCallback((request: Pending) => {
    const focused = document.activeElement as HTMLElement | null;
    // Queued dialogs may render while the previous input is still mounted.
    // Keep the original external opener instead of that soon-detached input.
    if (!focused?.closest(".confirm-backdrop")) queueOpener.current = focused;
    const queued = {
      ...request,
      id: ++serial.current,
      returnFocus: queueOpener.current,
    };
    setQueue((items) => [...items, queued]);
  }, []);

  const ask = useCallback(
    (o: AskOptions) =>
      new Promise<boolean>((resolve) => enqueue({ ...o, settle: resolve })),
    [enqueue],
  );
  const tell = useCallback(
    (o: Omit<AskOptions, "tellOnly">) =>
      new Promise<boolean>((resolve) =>
        enqueue({ ...o, tellOnly: true, settle: resolve }),
      ).then(() => undefined),
    [enqueue],
  );
  const prompt = useCallback(
    (o: PromptOptions) =>
      new Promise<string | null>((resolve) =>
        enqueue({
          ...o,
          input: o,
          settle: (ok, value) => resolve(ok ? (value ?? "") : null),
        }),
      ),
    [enqueue],
  );
  // A queued request must never leave a caller waiting after the provider exits.
  const latestQueue = useRef(queue);
  latestQueue.current = queue;
  useEffect(
    () => () => latestQueue.current.forEach((item) => item.settle(false)),
    [],
  );

  return (
    <Ctx.Provider value={{ ask, tell, prompt }}>
      {children}
      {pending && (
        <ConfirmDialog
          {...pending}
          key={pending.id}
          onDone={(ok, value) => {
            pending.settle(ok, value);
            setQueue((items) =>
              items[0] === pending ? items.slice(1) : items,
            );
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
  cancelLabel,
  destructive,
  tellOnly,
  input,
  returnFocus,
  onDone,
}: AskOptions & {
  input?: PromptOptions;
  returnFocus?: HTMLElement | null;
  onDone: (ok: boolean, value?: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(input?.value ?? "");
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef(
    returnFocus === undefined
      ? (document.activeElement as HTMLElement | null)
      : returnFocus,
  );
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const field = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const go = useRef<HTMLButtonElement>(null);
  const latest = useRef(onDone);
  latest.current = (ok, value) => {
    if (settled.current) return;
    settled.current = true;
    onDone(ok, value);
  };

  // Start at the field or safe action; keep focus here and return it on close.
  useEffect(() => {
    const previousFocus = opener.current;
    const backgrounds = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".app, .modal-backdrop, dialog[open]",
      ),
    ).filter((node) => !node.contains(root.current));
    const inert = backgrounds.map((node) => ({ node, value: node.inert }));
    inert.forEach(({ node }) => {
      node.inert = true;
    });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      field.current ??
      root.current?.querySelector<HTMLButtonElement>(".ghost") ??
      go.current
    )?.focus();
    const onFocus = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node))
        (field.current ?? go.current)?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        latest.current(false);
      } else if (e.key === "Tab") {
        const items = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ) ?? [],
        );
        const first = items[0],
          last = items.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !root.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !root.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      inert.forEach(({ node, value }) => {
        node.inert = value;
      });
      document.body.style.overflow = overflow;
      if (
        previousFocus?.isConnected &&
        !previousFocus.closest('[inert], [aria-hidden="true"]')
      )
        previousFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="modal-backdrop confirm-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-describedby={body ? `${id}-body` : undefined}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        latest.current(false);
      }}
      onMouseDown={(e) => e.target === e.currentTarget && latest.current(false)}
    >
      <div className="modal modal-small confirm-dialog" ref={root}>
        <div className="confirm-body">
          {destructive && (
            <span className="confirm-mark" aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
          )}
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {body && <p id={`${id}-body`}>{body}</p>}
          </div>
        </div>
        <form
          className="confirm-form"
          onSubmit={(event) => {
            event.preventDefault();
            latest.current(true, value);
          }}
        >
          {input && (
            <label>
              {input.label}
              <input
                ref={field}
                type={input.type ?? "text"}
                value={value}
                autoComplete={
                  input.type === "password" ? "current-password" : "off"
                }
                required={input.required}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
          )}
          <div className="confirm-actions">
            {!tellOnly && (
              <button
                type="button"
                className="ghost"
                onClick={() => latest.current(false)}
              >
                {cancelLabel ?? "Cancel"}
              </button>
            )}
            <button
              ref={go}
              className={"primary" + (destructive ? " is-destructive" : "")}
              type="submit"
            >
              {confirmLabel ?? (tellOnly ? "OK" : "Continue")}
            </button>
          </div>
        </form>
      </div>
    </dialog>,
    document.body,
  );
}

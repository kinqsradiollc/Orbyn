import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import "./kit.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
};

export function Button({
  variant = "secondary",
  busy,
  className = "",
  type = "button",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className = "",
  variant = "ghost",
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button
      variant={variant}
      className={`btn-icon ${className}`}
      aria-label={label}
      title={label}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export const Input = (
  props: InputHTMLAttributes<HTMLInputElement> & {
    ref?: Ref<HTMLInputElement>;
  },
) => <input className="input" {...props} />;
export const TextArea = (
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) => <textarea className="input" {...props} />;
export const SelectBox = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className="input" {...props} />
);

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Pill({
  tone,
  children,
}: {
  tone?: "blue" | "red" | "amber" | "green";
  children: ReactNode;
}) {
  return (
    <span className={`pill${tone ? ` pill-${tone}` : ""}`}>{children}</span>
  );
}

export function Dialog({
  title,
  onClose,
  wide,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? " dialog-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        {children}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </dialog>
  );
}

/** A menu anchored to its trigger, kept inside the window. */
export function Menu({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: (open: () => void, expanded: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    opener?.focus();
    setOpener(null);
  }, [opener]);
  const open = useCallback(() => {
    setOpener(document.activeElement as HTMLElement);
  }, []);

  useLayoutEffect(() => {
    const menu = box.current;
    if (!menu || !opener) return;
    const at = opener.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.left, innerWidth - size.width - 8));
    const below = at.bottom + 4 + size.height <= innerHeight - 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${below ? at.bottom + 4 : Math.max(8, at.top - size.height - 4)}px`;
    menu.querySelector("button")?.focus();
  }, [opener]);

  useEffect(() => {
    if (!opener) return;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpener(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(box.current?.querySelectorAll("button") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
      event.preventDefault();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [opener, close]);

  return (
    <>
      {trigger(open, !!opener)}
      {opener &&
        createPortal(
          <div ref={box} className="menu" role="menu" aria-label={label}>
            {typeof children === "function" ? children(close) : children}
          </div>,
          opener.closest("dialog") ?? document.body,
        )}
    </>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      <i style={{ width: "62%" }} />
      <i style={{ width: "88%" }} />
      <i style={{ width: "74%" }} />
    </div>
  );
}

export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="notice" role="alert">
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

type Toast = {
  id: number;
  text: string;
  error?: boolean;
  action?: { label: string; run: () => void };
};
type ToastInput = Omit<Toast, "id">;
const ToastContext = createContext<(toast: ToastInput) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const dismiss = (id: number) =>
    setToasts((all) => all.filter((t) => t.id !== id));
  const push = useCallback((toast: ToastInput) => {
    const id = ++next.current;
    setToasts((all) => [...all.slice(-2), { ...toast, id }]);
    if (!toast.error) setTimeout(() => dismiss(id), 6000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast${toast.error ? " toast-error" : ""}`}
          >
            <span>{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  dismiss(toast.id);
                  toast.action?.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

type Ask = { title: string; body?: string; action: string; danger?: boolean };
const ConfirmContext = createContext<(ask: Ask) => Promise<boolean>>(
  async () => false,
);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<
    (Ask & { done: (ok: boolean) => void }) | null
  >(null);
  const confirm = useCallback(
    (next: Ask) =>
      new Promise<boolean>((resolve) =>
        setAsk({
          ...next,
          done: (ok) => {
            setAsk(null);
            resolve(ok);
          },
        }),
      ),
    [],
  );
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        <Dialog
          title={ask.title}
          onClose={() => ask.done(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => ask.done(false)}>
                Cancel
              </Button>
              <Button
                variant={ask.danger ? "danger" : "primary"}
                onClick={() => ask.done(true)}
              >
                {ask.action}
              </Button>
            </>
          }
        >
          {ask.body && <p className="muted">{ask.body}</p>}
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

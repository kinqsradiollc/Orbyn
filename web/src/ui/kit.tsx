import {
  useRouteScope,
  useRouteActivity,
  RouteScopeProvider,
  type RouteScope,
} from "../lib/route-scope";
import { onToken } from "../lib/session";
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
  type RefObject,
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
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    ref?: Ref<HTMLTextAreaElement>;
  },
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

export type DialogPortalLease = { retire(): void; restore(): void };

export function Dialog({
  title,
  onClose,
  wide,
  actions,
  children,
  returnFocusTo,
  portalManaged = false,
  portalLease,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  returnFocusTo?: HTMLElement | null;
  /** The single confirmation owner releases its lease synchronously at a decision. */
  portalManaged?: boolean;
  /** Domain owner may retire only after a confirmed result authorizes close-and-navigate. */
  portalLease?: RefObject<DialogPortalLease | null>;
}) {
  const scope = useRouteScope();
  const activity = useRouteActivity();
  const allowed = () =>
    !scope || (scope.getSnapshot().visible && scope.getSnapshot().focused);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || !allowed()) return;
    let release = portalManaged ? undefined : scope?.registerPortal?.(),
      live = true;
    const handle: DialogPortalLease = {
      retire: () => {
        release?.();
        release = undefined;
      },
      restore: () => {
        if (live && allowed() && !release) release = scope?.registerPortal?.();
      },
    };
    if (portalLease) portalLease.current = handle;
    const opener = returnFocusTo ?? document.activeElement;
    const openedAt = location.href;
    if (!dialog.open) dialog.showModal();
    return () => {
      const ownedFocus =
        dialog.contains(document.activeElement) ||
        document.activeElement === document.body;
      if (dialog.open) dialog.close();
      live = false;
      handle.retire();
      if (portalLease && portalLease.current === handle)
        portalLease.current = null;
      if (
        allowed() &&
        ownedFocus &&
        opener instanceof HTMLElement &&
        opener.isConnected &&
        !document.querySelector("dialog[open]")
      ) {
        opener.focus({ preventScroll: true });
        // The caller may re-enable its trigger after the confirmation resolves.
        if (document.activeElement !== opener)
          requestAnimationFrame(() => {
            if (
              allowed() &&
              location.href === openedAt &&
              opener.isConnected &&
              !opener.matches(":disabled") &&
              !opener.closest("[inert]") &&
              document.activeElement === document.body &&
              !document.querySelector("dialog[open]")
            )
              opener.focus({ preventScroll: true });
          });
      }
    };
  }, [scope, activity.visible, activity.focused, portalManaged, portalLease]);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? " dialog-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (allowed()) onClose();
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
  trigger: (
    open: (event?: { currentTarget: EventTarget }) => void,
    expanded: boolean,
  ) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const scope = useRouteScope();
  const activity = useRouteActivity();
  const allowed = () =>
    !scope || (scope.getSnapshot().visible && scope.getSnapshot().focused);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const portal = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (!opener || !allowed()) return;
    const release = scope?.registerPortal?.();
    portal.current = release;
    return () => {
      release?.();
      if (portal.current === release) portal.current = undefined;
    };
  }, [scope, opener, activity.visible, activity.focused]);
  const close = useCallback(() => {
    portal.current?.();
    portal.current = undefined;
    if (allowed() && !opener?.closest("[inert]")) opener?.focus();
    setOpener(null);
  }, [opener, activity.visible, activity.focused]);
  // Anchor to the clicked trigger: WebKit does not focus buttons on click, so
  // activeElement can be <body>. Focus is only the fallback for bare open().
  const open = useCallback(
    (event?: { currentTarget: EventTarget }) => {
      if (!allowed()) return;
      const target = event?.currentTarget;
      setOpener(
        target instanceof HTMLElement
          ? target
          : (document.activeElement as HTMLElement),
      );
    },
    [scope],
  );

  useLayoutEffect(() => {
    const menu = box.current;
    if (!menu || !opener || !allowed()) return;
    const place = () => {
      const at = opener.getBoundingClientRect();
      const size = menu.getBoundingClientRect();
      const left = Math.max(8, Math.min(at.left, innerWidth - size.width - 8));
      const below = at.bottom + 4 + size.height <= innerHeight - 8;
      menu.style.left = `${left}px`;
      menu.style.top = `${below ? at.bottom + 4 : Math.max(8, at.top - size.height - 4)}px`;
    };
    place();
    menu.querySelector("button")?.focus();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [opener]);

  useEffect(() => {
    if (!opener || !allowed()) return;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpener(null);
    };
    const key = (event: KeyboardEvent) => {
      const activeDialog =
        document.activeElement instanceof Element
          ? document.activeElement.closest("dialog[open]")
          : null;
      if (
        !box.current?.contains(document.activeElement) ||
        !allowed() ||
        (activeDialog && !activeDialog.contains(box.current))
      )
        return;
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
  }, [opener, close, activity.visible, activity.focused]);

  return (
    <>
      {trigger(open, !!opener)}
      {opener &&
        activity.visible &&
        activity.focused &&
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
type ScopedAsk = Ask & { owner?: RouteScope | null };
const ConfirmContext = createContext<(ask: ScopedAsk) => Promise<boolean>>(
  async () => false,
);
export function useConfirm() {
  const ask = useContext(ConfirmContext),
    scope = useRouteScope();
  return useCallback(
    (next: Ask) =>
      scope && (!scope.getSnapshot().visible || !scope.getSnapshot().focused)
        ? Promise.resolve(false)
        : ask({ ...next, owner: scope }),
    [ask, scope],
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<
    | (ScopedAsk & { done: (ok: boolean) => void; opener: HTMLElement | null })
    | null
  >(null);
  const active = useRef<typeof ask>(null);
  const confirm = useCallback(
    (next: ScopedAsk) =>
      new Promise<boolean>((resolve) => {
        if (active.current) {
          resolve(false);
          return;
        }
        const release = next.owner?.registerPortal?.();
        const entry = {
          ...next,
          opener:
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
          done: (ok: boolean) => {
            if (active.current !== entry) return;
            active.current = null;
            release?.();
            setAsk(null);
            resolve(ok);
          },
        };
        active.current = entry;
        setAsk(entry);
      }),
    [],
  );
  useEffect(() => onToken(() => active.current?.done(false)), []);
  useEffect(
    () => () => {
      active.current?.done(false);
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        <RouteScopeProvider value={ask.owner ?? null}>
          <Dialog
            portalManaged
            title={ask.title}
            returnFocusTo={ask.opener}
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
        </RouteScopeProvider>
      )}
    </ConfirmContext.Provider>
  );
}

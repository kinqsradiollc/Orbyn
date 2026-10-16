import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ContextType,
} from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { sectionKey } from "@orbyn/core";
import { settingsExitAllowed } from "./SettingsModal";

/**
 * The section Settings' search chose (NAV-10): its heading, compared by
 * `sectionKey`, and a counter so choosing the same one again still opens
 * and scrolls to it.
 */
export const SettingsFocus = createContext<{ key: string; seq: number } | null>(
  null,
);

/** The words of a heading, icons and all left out. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node))
    return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

const DetailContext = createContext<{
  active: string | null;
  open: (key: string | null) => void;
} | null>(null);
export function SettingsDetailProvider({
  children,
  resetKey,
  reveal,
}: {
  children: ReactNode;
  resetKey?: unknown;
  reveal?: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const latest = useRef(reveal);
  latest.current = reveal;
  const open = useCallback((key: string | null) => {
    if (!settingsExitAllowed()) return;
    if (key !== null) latest.current?.();
    setActive(key);
  }, []);
  const [lastReset, setLastReset] = useState(resetKey);
  if (!Object.is(lastReset, resetKey)) {
    setLastReset(resetKey);
    if (resetKey !== true) setActive(null);
  }
  return (
    <DetailContext.Provider value={{ active, open }}>
      {children}
    </DetailContext.Provider>
  );
}

/** A settings row opens a focused detail; Back retains its mounted form draft. */
export function SettingsSection({
  children,
  className,
  title,
  "aria-labelledby": labelledBy,
  /** Legacy hint retained for callers; focused navigation starts at its row. */
  defaultOpen: _defaultOpen = false,
}: {
  children: ReactNode;
  className?: string;
  "aria-labelledby"?: string;
  defaultOpen?: boolean;
  /**
   * The section's name, for a section whose heading sits inside a header row
   * with its description and buttons and so cannot be lifted out.
   */
  title?: ReactNode;
}) {
  void _defaultOpen;
  const kids = Children.toArray(children);
  const headIndex = kids.findIndex((c) => isValidElement(c) && c.type === "h2");
  const head = title ? (
    <h2>{title}</h2>
  ) : headIndex >= 0 ? (
    kids[headIndex]
  ) : null;
  const body = title ? kids : kids.filter((_, i) => i !== headIndex);

  // Stable section names also allow Settings search to open the right detail.
  const headText =
    (typeof title === "string" && title) || textOf(head) || labelledBy || "";
  const key = labelledBy || headText;
  const navigation = useContext(DetailContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = navigation ? navigation.active === key : localOpen;
  const setOpen = (value: boolean) =>
    navigation ? navigation.open(value ? key : null) : setLocalOpen(value);
  const bodyId = useId();
  const rowButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) backButton.current?.focus();
    else if (!open && wasOpen.current && !navigation?.active)
      rowButton.current?.focus();
    wasOpen.current = open;
  }, [open, navigation?.active]);
  // Settings' search chose this section: open it and bring it into view.
  const focus = useContext(SettingsFocus);
  const box = useRef<HTMLElement>(null);
  const [flash, setFlash] = useState(false);
  const name = sectionKey(
    typeof title === "string"
      ? title
      : textOf(isValidElement(head) ? head : null),
  );
  const chosen = !!focus && !!name && focus.key === name;
  useEffect(() => {
    if (!chosen) return;
    setOpen(true);
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1600);
    const frame = requestAnimationFrame(() =>
      box.current?.scrollIntoView({ behavior: "auto", block: "start" }),
    );
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(frame);
    };
    // The counter, so choosing it again does it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, focus?.seq]);

  // Falling back leaves the section unfolded, which is easy to miss; say so
  // while developing rather than quietly shipping a tab that never folds.
  if (!head) {
    if (import.meta.env.DEV)
      console.warn(
        "SettingsSection: no <h2> among its children and no `title` — this section will not fold.",
      );
    return <section className={className}>{children}</section>;
  }

  return (
    <section
      ref={box}
      className={
        (className ?? "") + " settings-section" + (flash ? " is-found" : "")
      }
      hidden={!!navigation?.active && !open}
      data-open={open || undefined}
    >
      {open ? (
        <div className="settings-detail-head">
          <button
            type="button"
            className="text-button"
            ref={backButton}
            onClick={() => setOpen(false)}
          >
            <ArrowLeft size={16} /> Back
          </button>
          {head}
        </div>
      ) : (
        <button
          type="button"
          ref={rowButton}
          className="settings-section-head"
          aria-haspopup="true"
          aria-controls={bodyId}
          onClick={() => setOpen(true)}
        >
          {head}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
      <div id={bodyId} className="settings-section-body" hidden={!open}>
        <SettingsDetailProvider resetKey={open} reveal={() => setOpen(true)}>
          {body}
        </SettingsDetailProvider>
      </div>
    </section>
  );
}

/** Share one detail navigation owner without adding layout wrappers. */
export function SettingsWorkspace({
  children,
  focus,
  resetKey,
}: {
  children: ReactNode;
  focus: ContextType<typeof SettingsFocus>;
  resetKey: unknown;
}) {
  return (
    <SettingsFocus.Provider value={focus}>
      <SettingsDetailProvider resetKey={resetKey}>
        {children}
      </SettingsDetailProvider>
    </SettingsFocus.Provider>
  );
}

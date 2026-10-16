import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { hasHigherDialog } from "../lib/dialogLayers";
import "./workspace-dock.css";

export const WORKSPACE_DOCK_WIDTH_KEY = "orbyn-workspace-dock-width-v1";
export const DEFAULT_DOCK_WIDTH = 400;
export function dockMaximum(scopeWidth: number, minMainWidth = 480) {
  return Math.max(280, Math.min(720, scopeWidth - minMainWidth));
}
export function boundedDockWidth(value: number, maximum = 720) {
  return Math.round(Math.max(280, Math.min(maximum, value)));
}
export function savedDockWidth() {
  try {
    const raw = localStorage.getItem(WORKSPACE_DOCK_WIDTH_KEY);
    const value = Number(raw);
    return raw !== null &&
      Number.isFinite(value) &&
      value >= 280 &&
      value <= 720
      ? value
      : DEFAULT_DOCK_WIDTH;
  } catch {
    return DEFAULT_DOCK_WIDTH;
  }
}
export type WorkspaceDockTab = {
  id: string;
  title: string;
  icon?: ReactNode;
  content: ReactNode;
};
/** Controlled tab ownership; hidden panels remain mounted so drafts survive tab changes. */
export function WorkspaceDock({
  tabs,
  activeId,
  onSelect,
  onCloseTab,
  onClose,
  open = true,
  minMainWidth = 480,
}: {
  tabs: WorkspaceDockTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClose?: () => void;
  open?: boolean;
  minMainWidth?: number;
}) {
  const id = useId(),
    root = useRef<HTMLElement>(null);
  const [preferred, setPreferred] = useState(savedDockWidth);
  const [scopeWidth, setScopeWidth] = useState(1200);
  const drag = useRef<{
    pointer: number;
    x: number;
    width: number;
    preferred: number;
  } | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose ?? (() => onCloseTab(activeId));
  const maximum = dockMaximum(scopeWidth, minMainWidth),
    width = boundedDockWidth(preferred, maximum);
  const overlay = scopeWidth < Math.max(900, minMainWidth + 280);
  const active = tabs.some((tab) => tab.id === activeId)
    ? activeId
    : tabs[0]?.id;
  const focusedTab = useRef<string | null>(null);
  useEffect(() => {
    const previous = focusedTab.current;
    if (!previous || tabs.some((tab) => tab.id === previous)) return;
    focusedTab.current = null;
    const focused = document.activeElement;
    if (open && active && (!focused?.isConnected || focused === document.body))
      document
        .getElementById(`${id}-tab-${encodeURIComponent(active)}`)
        ?.focus();
  }, [open, active, tabs.map((tab) => tab.id).join("\u0000"), id]);
  const blurTab = (next: EventTarget | null) => {
    // Removal may report no next target; retain ownership until the new tab renders.
    if (next) focusedTab.current = null;
  };
  useEffect(() => {
    const scope = root.current?.parentElement;
    if (!scope) return;
    const measure = () => setScopeWidth(scope.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scope);
    return () => observer.disconnect();
  }, [tabs.length > 0]);
  useEffect(() => {
    if (!open || !overlay || !tabs.length) return;
    const panel = root.current;
    if (!panel) return;
    const opener = document.activeElement as HTMLElement | null;
    const siblings = Array.from(panel.parentElement?.children ?? []).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node !== panel,
    );
    const previousInert = siblings.map((node) => node.inert);
    siblings.forEach((node) => {
      node.inert = true;
    });
    const choices = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ).filter(
        (node) =>
          !node.closest("[hidden],[inert]") && node.getClientRects().length,
      );
    const focus = () => (choices()[0] ?? panel).focus({ preventScroll: true });
    if (!panel.contains(document.activeElement)) focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasHigherDialog(panel)) return;
      if (event.key === "Escape" && !drag.current && latestClose.current) {
        event.preventDefault();
        event.stopPropagation();
        latestClose.current();
      } else if (event.key === "Tab") {
        const items = choices(),
          first = items[0],
          last = items.at(-1);
        if (!first) {
          event.preventDefault();
          panel.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const contain = (event: FocusEvent) => {
      if (!hasHigherDialog(panel) && !panel.contains(event.target as Node))
        focus();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", contain);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", contain);
      siblings.forEach((node, index) => {
        node.inert = previousInert[index];
      });
      if (opener?.isConnected && !opener.closest("[hidden],[inert]"))
        opener.focus({ preventScroll: true });
    };
  }, [open, overlay, tabs.length > 0]);
  useEffect(() => {
    if (drag.current) setPreferred(drag.current.preferred);
    drag.current = null;
  }, [open, overlay]);
  const change = (value: number, remember = false) => {
    const next = boundedDockWidth(value, maximum);
    setPreferred(next);
    if (remember)
      try {
        localStorage.setItem(WORKSPACE_DOCK_WIDTH_KEY, String(next));
      } catch {
        /* Session choice remains usable. */
      }
  };
  if (!tabs.length) return null;
  return (
    <aside
      ref={root}
      hidden={!open}
      inert={!open}
      className={`workspace-dock${overlay ? " is-overlay" : ""}`}
      role={overlay ? "dialog" : "complementary"}
      aria-modal={overlay || undefined}
      aria-label="Workspace panel"
      tabIndex={-1}
      style={
        {
          "--workspace-dock-preferred-width": `${preferred}px`,
          width: overlay ? undefined : width,
        } as CSSProperties
      }
    >
      {!overlay && (
        <div
          className="workspace-dock-resizer"
          role="separator"
          aria-label="Workspace panel width"
          aria-orientation="vertical"
          aria-valuemin={280}
          aria-valuemax={maximum}
          aria-valuenow={width}
          aria-controls={`${id}-panels`}
          tabIndex={0}
          onDoubleClick={() => change(DEFAULT_DOCK_WIDTH, true)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointer: event.pointerId,
              x: event.clientX,
              width,
              preferred,
            };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start?.pointer === event.pointerId)
              change(start.width + start.x - event.clientX);
          }}
          onPointerUp={(event) => {
            const start = drag.current;
            if (start?.pointer !== event.pointerId) return;
            change(start.width + start.x - event.clientX, true);
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            if (drag.current) setPreferred(drag.current.preferred);
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            if (drag.current) setPreferred(drag.current.preferred);
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && drag.current) {
              setPreferred(drag.current.preferred);
              const pointer = drag.current.pointer;
              drag.current = null;
              if (event.currentTarget.hasPointerCapture(pointer))
                event.currentTarget.releasePointerCapture(pointer);
            } else if (event.key === "ArrowLeft")
              change(width + (event.shiftKey ? 40 : 10), true);
            else if (event.key === "ArrowRight")
              change(width - (event.shiftKey ? 40 : 10), true);
            else if (event.key === "Home") change(280, true);
            else if (event.key === "End") change(maximum, true);
            else return;
            event.preventDefault();
          }}
        />
      )}
      <div className="workspace-dock-header">
        <div
          role="tablist"
          aria-label="Workspace panels"
          className="workspace-dock-tabs"
        >
          {tabs.map((tab, index) => (
            <div className="workspace-dock-tab" key={tab.id}>
              <button
                onFocus={() => {
                  focusedTab.current = tab.id;
                }}
                onBlur={(event) => blurTab(event.relatedTarget)}
                role="tab"
                id={`${id}-tab-${encodeURIComponent(tab.id)}`}
                aria-controls={`${id}-panel-${encodeURIComponent(tab.id)}`}
                aria-selected={active === tab.id}
                tabIndex={active === tab.id ? 0 : -1}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => {
                  let next: number;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % tabs.length;
                  else if (event.key === "ArrowLeft")
                    next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  onSelect(tabs[next].id);
                  document
                    .getElementById(
                      `${id}-tab-${encodeURIComponent(tabs[next].id)}`,
                    )
                    ?.focus();
                }}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span>{tab.title}</span>
              </button>
              <button
                onFocus={() => {
                  focusedTab.current = tab.id;
                }}
                onBlur={(event) => blurTab(event.relatedTarget)}
                className="workspace-dock-close-tab"
                aria-label={`Close ${tab.title}`}
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        {onClose && (
          <button
            className="icon-button workspace-dock-close"
            aria-label="Close workspace panel"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="workspace-dock-panels" id={`${id}-panels`}>
        {tabs.map((tab) => (
          <section
            key={tab.id}
            role="tabpanel"
            id={`${id}-panel-${encodeURIComponent(tab.id)}`}
            aria-labelledby={`${id}-tab-${encodeURIComponent(tab.id)}`}
            hidden={active !== tab.id}
            inert={active !== tab.id}
            tabIndex={0}
            className="workspace-dock-panel"
          >
            {tab.content}
          </section>
        ))}
      </div>
    </aside>
  );
}

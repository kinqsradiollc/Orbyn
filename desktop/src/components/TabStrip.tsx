import { useRef, useState, type KeyboardEvent } from "react";
import { Ellipsis, X, type LucideIcon } from "lucide-react";
import {
  placeOf,
  type TabAction,
  type TabPlace,
  type TabsState,
  type WorkspaceTab,
} from "@orbyn/core";
import { Popover } from "./Popover";
import "./tab-strip.css";

type Props = {
  tabs: TabsState;
  /** Change the tabs (select, close, pin, move…). */
  onAction: (action: TabAction) => void;
  /** A place's name and icon, as the app shows it. */
  titleOf: (place: TabPlace) => string;
  iconOf: (place: TabPlace) => LucideIcon;
};

/**
 * The strip of tabs under the top bar (W4). Pinned tabs sit on the left as
 * icons. A tab's ⋯ or a right-click offers Pin, Close others and Close to
 * the right; tabs drag to a new order; the arrow keys move between them.
 */
export function TabStrip({ tabs, onAction, titleOf, iconOf }: Props) {
  const [menu, setMenu] = useState<{ key: string; anchor: DOMRect } | null>(
    null,
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const only = tabs.tabs.length === 1;

  const focusTab = (key: string) =>
    list.current
      ?.querySelector<HTMLElement>(`[data-tab="${key}"] [role="tab"]`)
      ?.focus();

  const onKey = (e: KeyboardEvent, tab: WorkspaceTab, at: number) => {
    const n = tabs.tabs.length;
    const go = (i: number) => {
      const key = tabs.tabs[(i + n) % n].key;
      onAction({ type: "select", key });
      focusTab(key);
    };
    if (e.key === "ArrowRight") go(at + 1);
    else if (e.key === "ArrowLeft") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if (e.key === "Delete" && !only)
      onAction({ type: "close", key: tab.key });
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
      setMenu({
        key: tab.key,
        anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(),
      });
    else return;
    e.preventDefault();
  };

  const menuTab = menu && tabs.tabs.find((t) => t.key === menu.key);
  const menuAt = menuTab ? tabs.tabs.indexOf(menuTab) : -1;
  const act = (action: TabAction) => {
    setMenu(null);
    onAction(action);
  };

  return (
    <div className="tab-strip" ref={list}>
      <div className="tab-list" role="tablist" aria-label="Open tabs">
        {tabs.tabs.map((tab, at) => {
          const place = placeOf(tab);
          const title = titleOf(place);
          const Icon = iconOf(place);
          const active = tab.key === tabs.active;
          return (
            <div
              key={tab.key}
              data-tab={tab.key}
              role="presentation"
              className={
                "tab-item" +
                (active ? " is-active" : "") +
                (tab.pinned ? " is-pinned" : "") +
                (dragging === tab.key ? " is-dragging" : "") +
                (over === tab.key && dragging !== tab.key ? " is-over" : "")
              }
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", title);
                setDragging(tab.key);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(tab.key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && dragging !== tab.key) {
                  // Dropped on its right half: after it.
                  const box = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX > box.left + box.width / 2;
                  const before = after
                    ? (tabs.tabs[at + 1]?.key ?? null)
                    : tab.key;
                  if (before !== dragging)
                    onAction({ type: "move", key: dragging, before });
                }
                setDragging(null);
                setOver(null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  key: tab.key,
                  anchor: new DOMRect(e.clientX, e.clientY, 0, 0),
                });
              }}
              onAuxClick={(e) => {
                // A middle click closes a tab, as in a browser.
                if (e.button === 1 && !only) {
                  e.preventDefault();
                  onAction({ type: "close", key: tab.key });
                }
              }}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            >
              <button
                type="button"
                role="tab"
                className="tab-main"
                aria-selected={active}
                aria-controls={active ? "tab-panel" : undefined}
                tabIndex={active ? 0 : -1}
                aria-label={tab.pinned ? `${title} (pinned)` : undefined}
                title={title}
                onClick={() => onAction({ type: "select", key: tab.key })}
                onKeyDown={(e) => onKey(e, tab, at)}
              >
                <Icon size={14} aria-hidden="true" />
                {!tab.pinned && <span className="tab-title">{title}</span>}
              </button>
              {!tab.pinned && (
                <>
                  <button
                    type="button"
                    className="icon-button tab-more"
                    tabIndex={-1}
                    aria-label={`Options for ${title}`}
                    aria-haspopup="menu"
                    onClick={(e) =>
                      setMenu({
                        key: tab.key,
                        anchor: e.currentTarget.getBoundingClientRect(),
                      })
                    }
                  >
                    <Ellipsis size={14} />
                  </button>
                  {!only && (
                    <button
                      type="button"
                      className="icon-button tab-close"
                      tabIndex={-1}
                      aria-label={`Close ${title}`}
                      onClick={() => onAction({ type: "close", key: tab.key })}
                    >
                      <X size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {menu && menuTab && (
        <Popover
          anchor={menu.anchor}
          label={`Options for ${titleOf(placeOf(menuTab))}`}
          onClose={() => setMenu(null)}
          width={220}
        >
          <div className="popover-actions" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                act({ type: "pin", key: menuTab.key, pinned: !menuTab.pinned })
              }
            >
              {menuTab.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={only}
              onClick={() => act({ type: "close", key: menuTab.key })}
            >
              Close
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!tabs.tabs.some((t) => t !== menuTab && !t.pinned)}
              onClick={() => act({ type: "closeOthers", key: menuTab.key })}
            >
              Close others
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!tabs.tabs.slice(menuAt + 1).some((t) => !t.pinned)}
              onClick={() => act({ type: "closeRight", key: menuTab.key })}
            >
              Close to the right
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  restoreTabs,
  saveTabs,
  tabsReducer,
  type TabAction,
  type TabsState,
} from "@orbyn/core";
import { SCREENS, type View } from "./views";

/**
 * Tabs on the web (W4): the device's switch, the tabs it keeps, and the
 * way anything in the app asks for a new tab. The state itself is pure and
 * lives in @orbyn/core (workspace-tabs.ts).
 */

const ENABLED_KEY = "orbyn-tabs-enabled";
const TABS_KEY = "orbyn-tabs";
const SETTING_EVENT = "orbyn:tabs-setting";

/** The screens whose things open as pages. */
export const PAGE_VIEWS: View[] = ["Docs", "Memory", "Agent"];

/** Below this width the strip hides and one screen shows, as before. */
export const TABS_MIN_WIDTH = 900;

/** Whether tabs are on for this device (they are unless turned off). */
export function tabsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Turn tabs on or off on this device (Settings → Arrange). */
export function setTabsEnabled(on: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // Storage can be blocked; the choice lasts this visit.
  }
  enabledNow = on;
  window.dispatchEvent(new Event(SETTING_EVENT));
}

let enabledNow: boolean | null = null;

/** The tabs switch, following changes from Settings and other windows. */
export function useTabsEnabled(): boolean {
  const [on, setOn] = useState(() => enabledNow ?? tabsEnabled());
  useEffect(() => {
    const read = () => setOn(enabledNow ?? tabsEnabled());
    const fromStorage = (e: StorageEvent) => {
      if (e.key !== ENABLED_KEY) return;
      enabledNow = null;
      read();
    };
    window.addEventListener(SETTING_EVENT, read);
    window.addEventListener("storage", fromStorage);
    return () => {
      window.removeEventListener(SETTING_EVENT, read);
      window.removeEventListener("storage", fromStorage);
    };
  }, []);
  return on;
}

/** Whether the window is wide enough for the strip. */
export function useWideEnoughForTabs(): boolean {
  const query = `(min-width: ${TABS_MIN_WIDTH}px)`;
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setWide(media.matches);
    change();
    media.addEventListener("change", change);
    // Some embedded browsers resize without telling the media query.
    window.addEventListener("resize", change);
    return () => {
      media.removeEventListener("change", change);
      window.removeEventListener("resize", change);
    };
  }, [query]);
  return wide;
}

const knownView = (view: string) =>
  Object.prototype.hasOwnProperty.call(SCREENS, view);

function readSaved(): string | null {
  try {
    return localStorage.getItem(TABS_KEY);
  } catch {
    return null;
  }
}

/**
 * The tabs, kept on this device. `act` changes them at once and returns the
 * new state, so the app can show what came to the front.
 */
export function useTabState() {
  const [state, setState] = useState<TabsState>(() =>
    restoreTabs(readSaved(), knownView),
  );
  const ref = useRef(state);
  const act = useCallback((action: TabAction) => {
    const next = tabsReducer(ref.current, action);
    if (next !== ref.current) {
      ref.current = next;
      setState(next);
    }
    return next;
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, saveTabs(state));
    } catch {
      // Nothing to keep them in: they last this visit.
    }
  }, [state]);
  return useMemo(() => ({ state, ref, act }), [state, act]);
}

/** Something to open in a tab of its own. */
export type TabRequest =
  | { kind: "doc" | "project" | "view"; id: string; title?: string }
  | { kind: "screen"; view: View };

/** Asks the app for a new tab (App.tsx listens). */
export const OPEN_TAB_EVENT = "orbyn:open-tab";

let shown = false;
/** The app says whether the strip is showing (on, and wide enough). */
export const setTabsShown = (on: boolean) => {
  shown = on;
};
/** Whether a new tab can open now. */
export const canOpenTabs = () => shown;

/** Open something in a new tab, behind the one in front. */
export function openInNewTab(request: TabRequest) {
  window.dispatchEvent(
    new CustomEvent<TabRequest>(OPEN_TAB_EVENT, { detail: request }),
  );
}

type Click = Pick<MouseEvent, "metaKey" | "ctrlKey" | "button">;
/** ⌘-click, Ctrl-click or a middle click, when a new tab can open. */
export const wantsNewTab = (e: Click) =>
  canOpenTabs() && (e.metaKey || e.ctrlKey || e.button === 1);

/**
 * Click handlers for something that opens in place, or in a new tab with
 * ⌘-click, Ctrl-click or a middle click.
 */
export function newTabClick(open: () => void, openTab: () => void) {
  return {
    onClick: (e: MouseEvent) => {
      if (wantsNewTab(e)) {
        e.preventDefault();
        openTab();
      } else open();
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1 || !canOpenTabs()) return;
      e.preventDefault();
      openTab();
    },
    // A middle press would otherwise start the browser's autoscroll.
    onMouseDown: (e: MouseEvent) => {
      if (e.button === 1 && canOpenTabs()) e.preventDefault();
    },
  };
}

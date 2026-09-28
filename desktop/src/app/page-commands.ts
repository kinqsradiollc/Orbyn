import { useEffect } from "react";

/**
 * What the open page can do, for ⌘K's Page commands. The page's editor
 * hands its own actions over while it is on screen, and takes them back
 * when it closes, so the command list offers them only with a page open.
 */
export type PageCommands = {
  docId: string;
  title: string;
  run: Partial<Record<string, () => void>>;
};

let current: PageCommands | null = null;

/** The open page's commands, or null with no page open. */
export const openPageCommands = () => current;

type OpenPage = { docId: string; title: string } | null;
const watchers = new Set<(page: OpenPage) => void>();
let told: OpenPage = null;
/** Tell the watchers which page is open, when that (or its title) changed. */
function tell() {
  const page = current ? { docId: current.docId, title: current.title } : null;
  if (page?.docId === told?.docId && page?.title === told?.title) return;
  told = page;
  for (const watch of watchers) watch(page);
}

/**
 * Follow which page is open and what it is called (the tab strip names its
 * tabs by it). Returns the way to stop.
 */
export function watchOpenPage(watch: (page: OpenPage) => void) {
  watchers.add(watch);
  return () => {
    watchers.delete(watch);
  };
}

/** Offer the page's commands while this component is on screen. */
export function usePageCommands(commands: PageCommands | null) {
  // Every render: the actions close over the page's latest state.
  useEffect(() => {
    current = commands;
    tell();
  });
  useEffect(
    () => () => {
      current = null;
      tell();
    },
    [],
  );
}

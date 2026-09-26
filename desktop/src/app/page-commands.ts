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

/** Offer the page's commands while this component is on screen. */
export function usePageCommands(commands: PageCommands | null) {
  // Every render: the actions close over the page's latest state.
  useEffect(() => {
    current = commands;
  });
  useEffect(
    () => () => {
      current = null;
    },
    [],
  );
}

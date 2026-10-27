import { docAskSelection, type DocAskSelection } from "../schemas.js";

/** Full source is local validation data and must never enter the request. */
export type DocSelection = {
  format: DocAskSelection["format"];
  source: string;
  start: number;
  end: number;
  quote: string;
  explain?: boolean;
  isCurrent?: () => boolean;
};
export type DocAskExcerpt = {
  selection: DocAskSelection;
  requestId: number;
  explain?: boolean;
};

export function docSelectionContext(
  value: DocSelection,
  revision: number,
): DocAskSelection {
  if (
    value.isCurrent?.() === false ||
    value.quote !== value.source.slice(value.start, value.end)
  )
    throw new Error("The selected text changed. Select it again.");
  return docAskSelection.parse({
    format: value.format,
    start: value.start,
    end: value.end,
    quote: value.quote,
    expected_revision: revision,
  });
}

/** One bounded timer; never present actions in the middle of a selection gesture. */
export function createDocSelectionSettler<T>(
  read: () => T | null,
  publish: (value: T | null) => void,
  schedule: (callback: () => void, delay: number) => () => void,
) {
  let held = false,
    disposed = false;
  let stop: (() => void) | undefined;
  const clear = () => {
    stop?.();
    stop = undefined;
  };
  const settle = () => {
    clear();
    if (!held && !disposed)
      stop = schedule(() => {
        stop = undefined;
        if (!held && !disposed) publish(read());
      }, 160);
  };
  return {
    start() {
      if (disposed) return;
      held = true;
      clear();
      publish(null);
    },
    change: settle,
    finish() {
      if (disposed) return;
      held = false;
      settle();
    },
    cancel() {
      held = false;
      clear();
      publish(null);
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

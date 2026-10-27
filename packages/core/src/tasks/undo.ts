/**
 * Undo and Redo for an editor that keeps its own state (the phone's page
 * editor, where the keyboard's own undo only knows the line being typed).
 * The stack holds whole states, oldest first. Typing is kept in steps: a
 * pause, or any other kind of change, starts a new one, so Undo takes back
 * a burst of typing rather than one letter at a time.
 */

/** One state to go back to, and what kind of change came after it. */
type Past<T> = { state: T; kind: string | null; at: number };

export type UndoStack<T> = {
  past: Past<T>[];
  /** States undone, the most recently undone last. */
  future: T[];
};

/** Most steps kept; the oldest go first. */
export const UNDO_LIMIT = 100;
/** A pause in typing this long starts a new step. */
export const UNDO_PAUSE_MS = 1200;

export const emptyUndo = <T>(): UndoStack<T> => ({ past: [], future: [] });

/**
 * Keep `before` — the state just before a change — to go back to. A change
 * of the same `kind` (typing, say) within `pauseMs` of the last one joins
 * its step instead of starting another. Any new change forgets what was
 * undone, as every editor does.
 */
export function recordUndo<T>(
  stack: UndoStack<T>,
  before: T,
  options: { kind?: string | null; now: number; pauseMs?: number },
): UndoStack<T> {
  const kind = options.kind ?? null;
  const last = stack.past.at(-1);
  if (
    kind &&
    last &&
    last.kind === kind &&
    options.now - last.at < (options.pauseMs ?? UNDO_PAUSE_MS)
  )
    return {
      past: [...stack.past.slice(0, -1), { ...last, at: options.now }],
      future: [],
    };
  const past = [...stack.past, { state: before, kind, at: options.now }];
  return { past: past.slice(-UNDO_LIMIT), future: [] };
}

/** Step back from `current`: the state to show, and the stack after. */
export function undoStep<T>(
  stack: UndoStack<T>,
  current: T,
): { stack: UndoStack<T>; state: T } | null {
  const last = stack.past.at(-1);
  if (!last) return null;
  return {
    state: last.state,
    stack: {
      past: stack.past.slice(0, -1),
      future: [...stack.future, current],
    },
  };
}

/** Step forward again after an Undo. */
export function redoStep<T>(
  stack: UndoStack<T>,
  current: T,
): { stack: UndoStack<T>; state: T } | null {
  const next = stack.future.at(-1);
  if (next === undefined) return null;
  return {
    state: next,
    stack: {
      // Redone, the step can be undone again, and joins nothing.
      past: [...stack.past, { state: current, kind: null, at: 0 }].slice(
        -UNDO_LIMIT,
      ),
      future: stack.future.slice(0, -1),
    },
  };
}

export const canUndo = (stack: UndoStack<unknown>) => stack.past.length > 0;
export const canRedo = (stack: UndoStack<unknown>) => stack.future.length > 0;

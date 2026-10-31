import {
  dateLabel,
  itemBody,
  lateSessionWarning,
  type CalendarEntry,
  type CalendarView,
  type EditScope,
  type FrameOccurrence,
  type HabitBlock,
  type Item,
  type TimeBlock,
} from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import { useConfirm, useToast } from "../../ui/kit";
import { dayMedium, timeLabel, whenLabel } from "./format";
import { entryKey, messageOf, statusOf } from "./model";
import type { Workspace } from "./useWorkspace";

export type Times = { start_at: string; end_at: string };

/** A choice to make beside the calendar ("Keep it", "Find time before"). */
export type Note = {
  text: string;
  actions: { label: string; run: () => void }[];
};

/** A move that needs an answer before it can be saved. */
export type EntryAsk =
  | { kind: "scope"; entry: CalendarEntry; times: Times; resized: boolean }
  | { kind: "deadline"; entry: CalendarEntry; times: Times };

type Options = {
  tz: string;
  workspace: Workspace;
  patch: (update: (view: CalendarView) => CalendarView) => void;
  reload: () => Promise<void>;
};

/**
 * Every change made from the calendar. A move shows at once, a save answers
 * for the newest move of that session only, and a failed save puts the
 * session back and offers the same move again. The view reloads once
 * nothing is in flight, so a read can't undo a move that is still saving.
 */
export function useActions({ tz, workspace, patch, reload }: Options) {
  const toast = useToast();
  const confirm = useConfirm();
  const [note, setNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(0);
  const [ask, setAsk] = useState<EntryAsk | null>(null);
  const inFlight = useRef(0);
  const moveIds = useRef(new Map<string, number>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const latest = useRef({ tz, workspace, reload });
  latest.current = { tz, workspace, reload };

  /** Reload when the last save lands; `reloadIdle` is for outside news. */
  const settle = useCallback(() => {
    inFlight.current -= 1;
    setSaving(inFlight.current);
    if (inFlight.current === 0 && mounted.current) void latest.current.reload();
  }, []);
  const write = useCallback(
    async <T>(work: () => Promise<T>) => {
      inFlight.current += 1;
      setSaving(inFlight.current);
      try {
        return await work();
      } finally {
        settle();
      }
    },
    [settle],
  );
  const reloadIdle = useCallback(() => {
    if (inFlight.current === 0) void latest.current.reload();
  }, []);

  const patchBlock = useCallback(
    (id: string, change: Partial<TimeBlock>) =>
      patch((view) => ({
        ...view,
        blocks: view.blocks.map((b) => (b.id === id ? { ...b, ...change } : b)),
      })),
    [patch],
  );

  const failed = useCallback(
    (error: unknown, fallback: string, retry?: () => void) => {
      toast({
        error: true,
        text: messageOf(error, fallback),
        action: retry ? { label: "Try again", run: retry } : undefined,
      });
    },
    [toast],
  );

  const moved = useCallback(
    (at: string) =>
      `${whenLabel(at, latest.current.tz)}, ${timeLabel(at, latest.current.tz)}`,
    [],
  );

  const refreshTasks = useCallback(async () => {
    await latest.current.workspace.refreshTasks().catch(() => undefined);
  }, []);

  /** Move a session to the next free time that ends by its deadline. */
  const moveBeforeDeadline = useCallback(
    async (block: TimeBlock) => {
      await write(async () => {
        try {
          const saved = await client.rescheduleBlock(block.id, {
            before_deadline: true,
          });
          if (!mounted.current) return;
          setNote(null);
          patchBlock(block.id, saved);
          toast({
            text: `Moved to ${moved(saved.start_at)}, before the deadline.`,
            action: {
              label: "Undo",
              run: () =>
                void moveBlockRef.current(
                  { ...saved },
                  { start_at: block.start_at, end_at: block.end_at },
                ),
            },
          });
        } catch (error) {
          failed(error, "There's no free time before the deadline.");
        }
      });
    },
    [failed, moved, patchBlock, toast, write],
  );

  /** A session now ends after its deadline: never refused, but said out loud. */
  const warnIfLate = useCallback(
    (block: TimeBlock) => {
      const text = lateSessionWarning(block);
      if (!text) return false;
      setNote({
        text: `${text}.`,
        actions: [
          { label: "Keep it", run: () => setNote(null) },
          {
            label: "Find time before",
            run: () => void moveBeforeDeadline(block),
          },
        ],
      });
      return true;
    },
    [moveBeforeDeadline],
  );

  const moveBlock = useCallback(
    async (block: TimeBlock, times: Times, label?: string) => {
      const previous = { start_at: block.start_at, end_at: block.end_at };
      const id = (moveIds.current.get(block.id) ?? 0) + 1;
      moveIds.current.set(block.id, id);
      const newest = () => moveIds.current.get(block.id) === id;
      patchBlock(block.id, times);
      await write(async () => {
        try {
          const saved = await client.updateBlock(block.id, times);
          if (!mounted.current || !newest()) return;
          patchBlock(block.id, saved);
          if (warnIfLate(saved)) return;
          toast({
            text: label ?? `Moved to ${moved(saved.start_at)}.`,
            action: {
              label: "Undo",
              run: () =>
                void moveBlockRef.current(saved, previous, "Move undone."),
            },
          });
        } catch (error) {
          if (!mounted.current || !newest()) return;
          patchBlock(block.id, previous);
          failed(
            error,
            `Couldn't move “${block.title}”. It's back where it was.`,
            () => void moveBlockRef.current(block, times, label),
          );
        }
      });
    },
    [failed, moved, patchBlock, toast, warnIfLate, write],
  );
  const moveBlockRef = useRef(moveBlock);
  moveBlockRef.current = moveBlock;

  const createBlock = useCallback(
    async (item: Item, start: Date, end?: Date) => {
      const { canWrite } = latest.current.workspace;
      if (item.kind !== "task" || !canWrite(item)) return;
      const minutes = Math.min(item.estimate_minutes ?? 30, 1440);
      const input = {
        item_id: item.id,
        start_at: start.toISOString(),
        end_at: (
          end ?? new Date(start.getTime() + minutes * 60_000)
        ).toISOString(),
      };
      await write(async () => {
        try {
          const block = await client.createBlock(input);
          if (!mounted.current) return;
          warnIfLate(block);
          await refreshTasks();
        } catch (error) {
          failed(
            error,
            "Couldn't plan that session.",
            () => void createBlockRef.current(item, start, end),
          );
        }
      });
    },
    [failed, refreshTasks, warnIfLate, write],
  );
  const createBlockRef = useRef(createBlock);
  createBlockRef.current = createBlock;

  /** A task dropped on a whole day: its first free working time. */
  const planOnDay = useCallback(
    async (item: Item, day: string) => {
      const { canWrite } = latest.current.workspace;
      if (item.kind !== "task" || !canWrite(item)) return;
      await write(async () => {
        try {
          const block = await client.createBlockOnDay({
            item_id: item.id,
            day,
          });
          if (!mounted.current) return;
          if (!warnIfLate(block))
            toast({
              text: `Planned “${item.title}” for ${moved(block.start_at)}.`,
            });
          await refreshTasks();
        } catch (error) {
          failed(error, `No free time on ${dayMedium(day)}.`);
        }
      });
    },
    [failed, moved, refreshTasks, toast, warnIfLate, write],
  );

  const reschedule = useCallback(
    async (block: TimeBlock) => {
      await write(async () => {
        try {
          const saved = await client.rescheduleBlock(block.id);
          if (!mounted.current) return;
          patchBlock(block.id, saved);
          if (!warnIfLate(saved))
            toast({ text: `Moved to ${moved(saved.start_at)}.` });
        } catch (error) {
          failed(error, "Couldn't find free time for that session.");
        }
      });
    },
    [failed, moved, patchBlock, toast, warnIfLate, write],
  );

  const duplicate = useCallback(
    async (block: TimeBlock, start?: Date) => {
      await write(async () => {
        try {
          const copy = await client.duplicateBlock(
            block.id,
            start ? { start_at: start.toISOString() } : {},
          );
          if (!mounted.current) return;
          if (!warnIfLate(copy) && !start)
            toast({ text: `Copied to ${moved(copy.start_at)}.` });
        } catch (error) {
          failed(error, "Couldn't copy that session.");
        }
      });
    },
    [failed, moved, toast, warnIfLate, write],
  );

  const removeBlock = useCallback(
    async (block: TimeBlock) => {
      const yes = await confirm({
        title: "Delete session?",
        body: block.title,
        action: "Delete",
        danger: true,
      });
      if (!yes) return;
      await write(async () => {
        try {
          await client.deleteBlock(block.id);
          await refreshTasks();
        } catch (error) {
          failed(error, "Couldn't delete that session.");
        }
      });
    },
    [confirm, failed, refreshTasks, write],
  );

  /** Save a moved event or timed task; it goes back on failure. */
  const saveEntry = useCallback(
    async (
      entry: CalendarEntry,
      times: Times,
      resized: boolean,
      scope?: EditScope,
    ) => {
      const key = entryKey(entry);
      const endIso = entry.end_at || resized ? times.end_at : null;
      patch((view) => ({
        ...view,
        entries: view.entries.map((x) =>
          entryKey(x) === key
            ? { ...x, start_at: times.start_at, end_at: endIso }
            : x,
        ),
      }));
      await write(async () => {
        try {
          const item = await client.getItem(entry.item_id);
          if (!latest.current.workspace.canWrite(item))
            throw new Error("You can't change this item.");
          // "All" shifts the whole series by the amount this one moved.
          const whole = scope === "all" && !!item.due_at;
          const shift = Date.parse(times.start_at) - Date.parse(entry.start_at);
          const due = whole
            ? new Date(Date.parse(item.due_at as string) + shift).toISOString()
            : times.start_at;
          const end =
            whole && endIso
              ? new Date(
                  Date.parse(due) +
                    (Date.parse(times.end_at) - Date.parse(times.start_at)),
                ).toISOString()
              : endIso;
          await client.updateItem(
            item.id,
            { ...itemBody(item), due_at: due, end_at: end },
            entry.occurrence && scope
              ? { scope, occurrence: entry.occurrence }
              : {},
          );
          await refreshTasks();
        } catch (error) {
          patch((view) => ({
            ...view,
            entries: view.entries.map((x) =>
              x.item_id === entry.item_id && x.start_at === times.start_at
                ? entry
                : x,
            ),
          }));
          toast({
            error: true,
            text:
              statusOf(error) === 409
                ? `“${entry.title}” was changed somewhere else, so it stayed put.`
                : messageOf(error, `Couldn't move “${entry.title}”.`),
            action: {
              label: "Try again",
              run: () =>
                void saveEntryRef.current(entry, times, resized, scope),
            },
          });
        }
      });
    },
    [patch, refreshTasks, toast, write],
  );
  const saveEntryRef = useRef(saveEntry);
  saveEntryRef.current = saveEntry;

  const moveEntry = useCallback(
    (entry: CalendarEntry, times: Times, resized: boolean) => {
      if (entry.kind === "task" && !entry.end_at && !resized)
        setAsk({ kind: "deadline", entry, times });
      else if (entry.occurrence)
        setAsk({ kind: "scope", entry, times, resized });
      else void saveEntry(entry, times, resized);
    },
    [saveEntry],
  );

  const answerScope = useCallback(
    (scope: EditScope) => {
      if (ask?.kind !== "scope") return;
      setAsk(null);
      void saveEntry(ask.entry, ask.times, ask.resized, scope);
    },
    [ask, saveEntry],
  );

  /** A deadline dragged somewhere: a session there, or the deadline itself. */
  const answerDeadline = useCallback(
    async (choice: "plan" | "move") => {
      if (ask?.kind !== "deadline") return;
      const { entry, times } = ask;
      setAsk(null);
      if (choice === "move") {
        if (entry.occurrence)
          setAsk({ kind: "scope", entry, times, resized: false });
        else void saveEntry(entry, times, false);
        return;
      }
      const item =
        latest.current.workspace.itemById.get(entry.item_id) ??
        (await client.getItem(entry.item_id).catch(() => null));
      if (item) void createBlock(item, new Date(times.start_at));
    },
    [ask, createBlock, saveEntry],
  );

  const complete = useCallback(
    async (itemId: string, repeating = false) => {
      await write(async () => {
        try {
          const next = await client.postItemUpdate(itemId, { status: "done" });
          if (repeating && next.status !== "done" && next.due_at)
            toast({ text: `Done. Next on ${dateLabel(next.due_at)}.` });
          await refreshTasks();
        } catch (error) {
          failed(error, "Couldn't mark that done.");
        }
      });
    },
    [failed, refreshTasks, toast, write],
  );

  const reopen = useCallback(
    async (itemId: string) => {
      await write(async () => {
        try {
          await client.postItemUpdate(itemId, { status: "todo" });
          await refreshTasks();
        } catch (error) {
          failed(error, "Couldn't reopen that task.");
        }
      });
    },
    [failed, refreshTasks, write],
  );

  const skipOccurrence = useCallback(
    async (entry: CalendarEntry) => {
      if (!entry.occurrence) return;
      await write(async () => {
        try {
          await client.skipOccurrence(
            entry.item_id,
            entry.occurrence as string,
          );
          await refreshTasks();
        } catch (error) {
          failed(error, "Couldn't skip that one.");
        }
      });
    },
    [failed, refreshTasks, write],
  );

  const unskipFrame = useCallback(
    async (frame: FrameOccurrence) => {
      await write(async () => {
        try {
          await client.unskipFrame(frame.frame_id, frame.date);
        } catch (error) {
          failed(error, "Couldn't bring that day back.");
        }
      });
    },
    [failed, write],
  );

  const skipFrame = useCallback(
    async (frame: FrameOccurrence) => {
      await write(async () => {
        try {
          await client.skipFrame(frame.frame_id, frame.date);
          toast({
            text: `Skipped ${frame.name} on ${whenLabel(frame.start_at, latest.current.tz)}.`,
            action: { label: "Undo", run: () => void unskipFrame(frame) },
          });
        } catch (error) {
          failed(error, "Couldn't skip that day.");
        }
      });
    },
    [failed, toast, unskipFrame, write],
  );

  const checkInHabit = useCallback(
    async (habit: HabitBlock, outcome: "done" | "skipped" | null) => {
      await write(async () => {
        try {
          // The calendar's copy may lag: answer against the current version.
          const current = await client.getHabitBlock(habit.id);
          await client.checkInHabitBlock(habit.id, {
            outcome,
            version: current.version ?? 1,
          });
        } catch (error) {
          failed(error, "Couldn't save that habit.");
        }
      });
    },
    [failed, write],
  );

  const removeHabit = useCallback(
    async (habit: HabitBlock) => {
      const yes = await confirm({
        title: "Remove this habit session?",
        body: habit.name,
        action: "Remove",
        danger: true,
      });
      if (!yes) return;
      await write(async () => {
        try {
          await client.deleteHabitBlock(habit.id, habit.version);
        } catch (error) {
          failed(error, "Couldn't remove that session.");
        }
      });
    },
    [confirm, failed, write],
  );

  return {
    saving: saving > 0,
    reloadIdle,
    note,
    setNote,
    ask,
    setAsk,
    warnIfLate,
    moveBlock,
    moveBeforeDeadline,
    createBlock,
    planOnDay,
    reschedule,
    duplicate,
    removeBlock,
    moveEntry,
    answerScope,
    answerDeadline,
    complete,
    reopen,
    skipOccurrence,
    skipFrame,
    checkInHabit,
    removeHabit,
    write,
  };
}

export type Actions = ReturnType<typeof useActions>;

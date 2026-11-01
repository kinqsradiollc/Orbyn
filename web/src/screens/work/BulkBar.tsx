import {
  STATUSES,
  statusLabels,
  type Item,
  type ItemInput,
  type Priority,
  type Status,
} from "@orbyn/core";
import {
  CalendarDays,
  Check,
  ChevronUp,
  CircleDot,
  Flag,
  FolderInput,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { getSessionVersion } from "../../lib/session";
import { useRouteActivity, useRouteScope } from "../../lib/route-scope";
import { messageOf } from "../../lib/resource";
import { Button, IconButton, Menu, useConfirm, useToast } from "../../ui/kit";
import { deleteLater } from "../shared-task/store";
import { plural, saveFields, saveStatus, usePlanning } from "../shared-task";

const dayAt = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
};

/** A few at a time, so a long selection doesn't flood the server. */
async function inBatches<T>(
  rows: T[],
  work: (row: T) => Promise<void>,
  current: () => boolean,
) {
  let failed = 0;
  let reason: unknown;
  for (let at = 0; at < rows.length; at += 4) {
    if (!current()) return { failed, reason, stale: true };
    const results = await Promise.allSettled(
      rows.slice(at, at + 4).map(async (row) => {
        if (current()) await work(row);
      }),
    );
    if (!current()) return { failed, reason, stale: true };
    for (const result of results)
      if (result.status === "rejected") {
        failed++;
        reason = result.reason;
      }
  }
  return { failed, reason, stale: false };
}

/** What selected tasks can have done to them all at once. */
export function BulkBar({
  selected,
  total,
  onSelectAll,
  onClear,
}: {
  selected: Item[];
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const { lists, tags, canWrite } = usePlanning();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const scope = useRouteScope();
  useRouteActivity();
  const generation = useRef(getSessionVersion()).current;
  const mounted = useRef(true);
  const selection = JSON.stringify(selected.map((item) => item.id).sort());
  const latest = useRef({ scope, selection, canWrite });
  latest.current = { scope, selection, canWrite };
  type Operation = { current: () => boolean };
  const operation = useRef<Operation | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current = null;
    };
  }, []);
  // Authority transitions retire their own UI lock; old receipts never do so.
  useLayoutEffect(() => {
    if (operation.current && !operation.current.current()) {
      operation.current = null;
      setBusy(false);
    }
  });
  const mayBegin = () => {
    const here = scope?.getSnapshot();
    return (
      mounted.current &&
      generation === getSessionVersion() &&
      !operation.current &&
      (!scope || (!!here?.visible && !!here.focused))
    );
  };
  const begin = (): Operation | null => {
    if (!mayBegin()) return null;
    const opening = scope?.getSnapshot();
    const run: Operation = {
      current: () => {
        if (
          !mounted.current ||
          generation !== getSessionVersion() ||
          operation.current !== run ||
          latest.current.scope !== scope ||
          latest.current.selection !== selection
        )
          return false;
        const here = scope?.getSnapshot();
        return (
          !scope ||
          (!!here?.visible &&
            here.activation === opening?.activation &&
            here.pathname === opening?.pathname)
        );
      },
    };
    operation.current = run;
    setBusy(true);
    return run;
  };
  const finish = (run: Operation) => {
    if (!run.current()) return;
    operation.current = null;
    setBusy(false);
  };
  const requireWrite = (item: Item) => {
    if (!latest.current.canWrite(item))
      throw new Error("You no longer have permission to change this task.");
  };
  // Undo is a deliberate global toast action: leaving the pane is allowed,
  // replacing the account is not. One click never replays an unknown result.
  const undoChanges = <T,>(rows: T[], work: (row: T) => Promise<void>) => {
    let used = false;
    return () => {
      if (used || generation !== getSessionVersion()) return;
      used = true;
      const current = () => generation === getSessionVersion();
      void inBatches(rows, work, current).then(({ failed, reason, stale }) => {
        if (!stale && current() && failed)
          toast({
            text: messageOf(reason, "Some changes couldn't be undone."),
            error: true,
          });
      });
    };
  };
  const writable = selected.filter(canWrite);
  const skipped = selected.length - writable.length;

  const report = (
    done: number,
    failed: number,
    reason: unknown,
    undo?: () => void,
  ) => {
    const parts = [`${done} of ${done + failed} changed`];
    if (skipped) parts.push(`${skipped} view only`);
    if (failed)
      toast({
        text: `${parts.join(" · ")}. ${messageOf(reason, "Some couldn't be saved.")}`,
        error: true,
      });
    else
      toast({
        text: parts.join(" · "),
        action: undo ? { label: "Undo", run: undo } : undefined,
      });
  };

  const setStatus = async (status: Status) => {
    const run = begin();
    if (!run) return;
    const changes: { item: Item; next: Item; before: Status }[] = [];
    const rows = writable.filter((item) => item.status !== status);
    try {
      const result = await inBatches(
        rows,
        async (item) => {
          requireWrite(item);
          const next = await saveStatus(item, status);
          if (run.current()) changes.push({ item, next, before: item.status });
        },
        run.current,
      );
      if (result.stale || !run.current()) return;
      report(
        rows.length - result.failed,
        result.failed,
        result.reason,
        undoChanges(changes, async ({ item, next, before }) => {
          await saveStatus({ ...item, ...next }, before);
        }),
      );
      if (!result.failed && run.current()) onClear();
    } finally {
      finish(run);
    }
  };

  const setFields = async (
    rows: Item[],
    change: (item: Item) => Partial<ItemInput>,
    undoFields: (item: Item) => Partial<ItemInput>,
  ) => {
    const run = begin();
    if (!run) return;
    const changes: { next: Item; before: Partial<ItemInput> }[] = [];
    try {
      const result = await inBatches(
        rows,
        async (item) => {
          requireWrite(item);
          const next = await saveFields(item, change(item));
          if (run.current()) changes.push({ next, before: undoFields(item) });
        },
        run.current,
      );
      if (result.stale || !run.current()) return;
      report(
        rows.length - result.failed,
        result.failed,
        result.reason,
        undoChanges(changes, async ({ next, before }) => {
          await saveFields(next, before);
        }),
      );
      if (!result.failed && run.current()) onClear();
    } finally {
      finish(run);
    }
  };

  const setDue = (days: number | null) => {
    if (!mayBegin()) return;
    const rows = writable.filter((item) => !item.rrule);
    if (rows.length < writable.length)
      toast({
        text: "Repeating items keep their dates. Open one to change it.",
      });
    void setFields(
      rows,
      () => ({
        due_at: days === null ? null : dayAt(days),
        end_at: null,
        all_day: false,
      }),
      (item) => ({
        due_at: item.due_at,
        end_at: item.end_at,
        all_day: item.all_day,
      }),
    );
  };

  const teams = new Set(writable.map((item) => item.team_id ?? null));
  const team = teams.size === 1 ? [...teams][0] : undefined;
  const inPlace = <T extends { team_id: string | null }>(rows: T[]) =>
    team === undefined ? [] : rows.filter((row) => row.team_id === team);

  const remove = async () => {
    const run = begin();
    if (!run) return;
    const undo: (() => void)[] = [];
    const cancelQueued = () => {
      for (const cancel of undo) {
        if (generation !== getSessionVersion()) return;
        cancel();
      }
    };
    try {
      const repeating = writable.filter((item) => item.rrule).length;
      if (
        !(await confirm({
          title: `Delete ${plural(writable.length, "item")}?`,
          body: repeating
            ? `${plural(repeating, "repeating item")} will lose every time. You can undo this for a few seconds.`
            : "You can undo this for a few seconds.",
          action: "Delete",
          danger: true,
        })) ||
        !run.current()
      )
        return;
      for (const item of writable) {
        if (!run.current()) {
          cancelQueued();
          return;
        }
        requireWrite(item);
        undo.push(
          deleteLater(item, (text) => {
            if (generation === getSessionVersion())
              toast({ text, error: true });
          }),
        );
      }
      if (!run.current()) {
        cancelQueued();
        return;
      }
      let undone = false;
      toast({
        text: `Deleted ${plural(writable.length, "item")}`,
        action: {
          label: "Undo",
          run: () => {
            if (undone || generation !== getSessionVersion()) return;
            undone = true;
            for (const cancel of undo) {
              if (generation !== getSessionVersion()) return;
              cancel();
            }
          },
        },
      });
      if (run.current()) onClear();
    } catch (error) {
      cancelQueued();
      if (run.current())
        toast({
          text: messageOf(error, "Couldn't delete selected tasks."),
          error: true,
        });
    } finally {
      finish(run);
    }
  };

  const lock = busy || !writable.length;
  const pick = (
    label: string,
    icon: React.ReactNode,
    items: (close: () => void) => React.ReactNode,
  ) => (
    <Menu
      label={label}
      trigger={(open, expanded) => (
        <Button
          variant="ghost"
          aria-label={label}
          aria-expanded={expanded}
          disabled={lock}
          onClick={open}
        >
          {icon}
          <span className="work-bulk-word">{label}</span>
          <ChevronUp className="work-bulk-caret" aria-hidden="true" />
        </Button>
      )}
    >
      {items}
    </Menu>
  );

  return (
    <div className="work-bulk" role="toolbar" aria-label="Selected tasks">
      <span className="work-bulk-count" role="status">
        {selected.length} selected
      </span>
      {selected.length < total && (
        <Button variant="ghost" onClick={onSelectAll}>
          Select all {total}
        </Button>
      )}
      <span className="st-gap" />
      <Button
        variant="primary"
        disabled={lock}
        onClick={() => void setStatus("done")}
      >
        <Check aria-hidden="true" /> Done
      </Button>
      {pick("Status", <CircleDot aria-hidden="true" />, (close) =>
        STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => {
              close();
              void setStatus(status);
            }}
          >
            {statusLabels[status]}
          </button>
        )),
      )}
      {pick("Priority", <Flag aria-hidden="true" />, (close) =>
        (["high", "medium", "low"] as Priority[]).map((priority) => (
          <button
            key={priority}
            onClick={() => {
              close();
              void setFields(
                writable,
                () => ({ priority }),
                (item) => ({
                  priority: item.priority,
                }),
              );
            }}
          >
            {priority[0].toUpperCase() + priority.slice(1)}
          </button>
        )),
      )}
      {pick("Due", <CalendarDays aria-hidden="true" />, (close) => (
        <>
          {[
            ["Today", 0],
            ["Tomorrow", 1],
            ["In a week", 7],
            ["No date", null],
          ].map(([label, days]) => (
            <button
              key={label}
              onClick={() => {
                close();
                setDue(days as number | null);
              }}
            >
              {label}
            </button>
          ))}
        </>
      ))}
      {pick("List", <FolderInput aria-hidden="true" />, (close) => (
        <>
          <button
            onClick={() => {
              close();
              void setFields(
                writable,
                () => ({ list_id: null }),
                (item) => ({
                  list_id: item.list_id ?? null,
                }),
              );
            }}
          >
            No list
          </button>
          {inPlace(lists).map((list) => (
            <button
              key={list.id}
              onClick={() => {
                close();
                void setFields(
                  writable,
                  () => ({ list_id: list.id }),
                  (item) => ({
                    list_id: item.list_id ?? null,
                  }),
                );
              }}
            >
              {list.name}
            </button>
          ))}
          {team === undefined && (
            <button disabled>Selected tasks are in different places</button>
          )}
        </>
      ))}
      {pick("Tag", <TagIcon aria-hidden="true" />, (close) => (
        <>
          {inPlace(tags).map((tag) => (
            <button
              key={tag.id}
              onClick={() => {
                close();
                void setFields(
                  writable.filter((item) => (item.tag_ids ?? []).length < 20),
                  (item) => ({
                    tag_ids: [...new Set([...(item.tag_ids ?? []), tag.id])],
                  }),
                  (item) => ({ tag_ids: item.tag_ids ?? [] }),
                );
              }}
            >
              {tag.name}
            </button>
          ))}
          {!inPlace(tags).length && <button disabled>No tags here yet</button>}
        </>
      ))}
      <IconButton
        label="Delete selected"
        disabled={lock}
        onClick={() => void remove()}
      >
        <Trash2 />
      </IconButton>
      <IconButton label="Clear selection" onClick={onClear}>
        <X />
      </IconButton>
    </div>
  );
}

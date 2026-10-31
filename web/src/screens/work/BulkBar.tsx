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
import { useState } from "react";
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
async function inBatches<T>(rows: T[], work: (row: T) => Promise<void>) {
  let failed = 0;
  let reason: unknown;
  for (let at = 0; at < rows.length; at += 4) {
    const results = await Promise.allSettled(rows.slice(at, at + 4).map(work));
    for (const result of results)
      if (result.status === "rejected") {
        failed++;
        reason = result.reason;
      }
  }
  return { failed, reason };
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
    setBusy(true);
    const changes: { item: Item; next: Item; before: Status }[] = [];
    const rows = writable.filter((item) => item.status !== status);
    const { failed, reason } = await inBatches(rows, async (item) => {
      const next = await saveStatus(item, status);
      changes.push({ item, next, before: item.status });
    });
    setBusy(false);
    report(rows.length - failed, failed, reason, () => {
      void inBatches(changes, async ({ item, next, before }) => {
        await saveStatus({ ...item, ...next }, before);
      });
    });
    if (!failed) onClear();
  };

  const setFields = async (
    rows: Item[],
    change: (item: Item) => Partial<ItemInput>,
    undoFields: (item: Item) => Partial<ItemInput>,
  ) => {
    setBusy(true);
    const changes: { next: Item; before: Partial<ItemInput> }[] = [];
    const { failed, reason } = await inBatches(rows, async (item) => {
      const next = await saveFields(item, change(item));
      changes.push({ next, before: undoFields(item) });
    });
    setBusy(false);
    report(rows.length - failed, failed, reason, () => {
      void inBatches(changes, async ({ next, before }) => {
        await saveFields(next, before);
      });
    });
    if (!failed) onClear();
  };

  const setDue = (days: number | null) => {
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
    const repeating = writable.filter((item) => item.rrule).length;
    if (
      !(await confirm({
        title: `Delete ${plural(writable.length, "item")}?`,
        body: repeating
          ? `${plural(repeating, "repeating item")} will lose every time. You can undo this for a few seconds.`
          : "You can undo this for a few seconds.",
        action: "Delete",
        danger: true,
      }))
    )
      return;
    const undo = writable.map((item) =>
      deleteLater(item, (text) => toast({ text, error: true })),
    );
    toast({
      text: `Deleted ${plural(writable.length, "item")}`,
      action: { label: "Undo", run: () => undo.forEach((run) => run()) },
    });
    onClear();
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

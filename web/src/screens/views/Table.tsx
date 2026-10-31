import {
  PRIORITIES,
  REPEATING_DATE_NOTE,
  cellText,
  columnLabel,
  columnTotal,
  fieldKeyId,
  groupHeader,
  isEditableColumn,
  isOverdue,
  isRepeatingTask,
  statusChoices,
  statusText,
  viewTotals,
  type CustomField,
  type FieldValue,
  type ViewGroup,
  type ViewRow,
  type ViewSource,
} from "@orbyn/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button, Input, SelectBox } from "../../ui/kit";
import type { CellEdit } from "./edits";
import { FieldInput } from "./FieldInput";

const dayOf = (row: ViewRow, timeZone: string) => {
  if (!row.due_at) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.due_at)) return row.due_at;
  return new Date(row.due_at).toLocaleDateString("en-CA", { timeZone });
};

function TextCell({
  initial,
  label,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  placeholder: string;
  onCommit: (value: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const writing = useRef(false);
  const finish = async (save: boolean) => {
    if (writing.current) return;
    if (!save || text.trim() === initial.trim()) return onCancel();
    writing.current = true;
    setPending(true);
    setFailed(false);
    try {
      if (!(await onCommit(text.trim()))) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      writing.current = false;
      setPending(false);
    }
  };
  return (
    <div>
      <Input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        value={text}
        disabled={pending}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (!failed) void finish(true);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void finish(true);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            void finish(false);
          }
        }}
      />
      {failed && (
        <div className="vw-cell-failed">
          <span role="alert">Not saved.</span>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={(event) => {
              event.stopPropagation();
              void finish(true);
            }}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Cells change in place: click one or press Enter, then Enter saves and Escape
 * puts it back. Arrow keys move between cells. Totals close each group and the
 * table, and a failed edit keeps its value with a way to try again.
 */
export function Table({
  source,
  groups,
  rows,
  columns,
  fields,
  people,
  timeZone,
  folded,
  onToggleFold,
  onOpen,
  onEdit,
  onBusy,
}: {
  source: ViewSource;
  groups: ViewGroup[];
  rows: ViewRow[];
  columns: string[];
  fields: CustomField[];
  people: { id: string; name: string }[];
  timeZone: string;
  folded: Set<string>;
  onToggleFold: (key: string) => void;
  onOpen: (row: ViewRow) => void;
  onEdit: (row: ViewRow, edit: CellEdit) => Promise<boolean>;
  onBusy: (busy: boolean) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    edit: CellEdit;
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  useEffect(() => {
    onBusy(!!editing || !!failure || !!pending);
    return () => onBusy(false);
  }, [editing, failure, pending, onBusy]);
  const ctx = { now: new Date(), timeZone };
  const names = { fields, people };
  const grouped = !(groups.length === 1 && groups[0].key === "all");
  const flat: ViewRow[] = [];
  for (const g of groups) if (!folded.has(g.key)) flat.push(...g.rows);
  const focusCell = (row: number, col: number) =>
    table.current
      ?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)
      ?.focus();
  const onCellKey = (
    e: KeyboardEvent,
    r: number,
    c: number,
    key: string,
    editable: boolean,
  ) => {
    if (editing === key || writing.current || (failure && failure.key !== key))
      return;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      return focusCell(r + move[0], c + move[1]);
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      if (editable) setEditing(key);
      else if (columns[c] === "title") onOpen(flat[r]);
    }
  };
  const renderCell = (row: ViewRow, column: string, r: number, c: number) => {
    const key = `${row.id}:${column}`;
    const fieldId = fieldKeyId(column);
    const field = fieldId ? fields.find((f) => f.id === fieldId) : undefined;
    const editable =
      row.can_write &&
      isEditableColumn(source, column, row) &&
      (!fieldId || !!field) &&
      column !== "done";
    const isEditing = editing === key;
    const done = () => {
      if (writing.current) return;
      setEditing(null);
      setFailure(null);
      setDrafts((all) => {
        const { [key]: _old, ...rest } = all;
        return rest;
      });
      requestAnimationFrame(() => focusCell(r, c));
    };
    const commit = async (edit: CellEdit) => {
      if (writing.current) return false;
      writing.current = true;
      setPending(key);
      setFailure(null);
      if ("value" in edit && !("field" in edit))
        setDrafts((all) => ({ ...all, [key]: edit.value }));
      let saved = false;
      try {
        saved = await onEdit(row, edit);
      } finally {
        writing.current = false;
        setPending(null);
      }
      if (saved) done();
      else setFailure({ key, edit });
      return saved;
    };
    const draft = (fallback: string) =>
      Object.prototype.hasOwnProperty.call(drafts, key)
        ? (drafts[key] ?? "")
        : fallback;
    let content: ReactNode = cellText(row, column, ctx, names);
    if (column === "done")
      content = (
        <input
          type="checkbox"
          aria-label={`${row.status === "done" ? "Reopen" : "Finish"} ${row.title}`}
          checked={row.status === "done"}
          disabled={!row.can_write || !!pending}
          onChange={() => void commit({ column: "done" })}
        />
      );
    else if (column === "title" && !isEditing)
      content = (
        <button
          className="vw-title"
          dir="auto"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(row);
          }}
        >
          {row.title || "Untitled"}
        </button>
      );
    else if (column === "overdue" && isOverdue(row, ctx))
      content = <span className="vw-late">Overdue</span>;
    if (isEditing) {
      if (field)
        content = (
          <FieldInput
            field={field}
            value={row.fields[field.id]}
            people={people}
            autoFocus
            onCommit={(value: FieldValue) =>
              commit({ column, field: field.id, value })
            }
            onDone={done}
          />
        );
      else if (column === "status")
        content = (
          <SelectBox
            aria-label="Status"
            autoFocus
            value={draft(row.status ?? "")}
            disabled={!!pending}
            onChange={(e) => void commit({ column, value: e.target.value })}
          >
            {statusChoices(row.kind).map((s) => (
              <option key={s} value={s}>
                {statusText(s)}
              </option>
            ))}
          </SelectBox>
        );
      else if (column === "priority")
        content = (
          <SelectBox
            aria-label="Priority"
            autoFocus
            value={draft(row.priority ?? "medium")}
            disabled={!!pending}
            onChange={(e) => void commit({ column, value: e.target.value })}
          >
            {[...PRIORITIES].reverse().map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </SelectBox>
        );
      else if (column === "due")
        content = (
          <Input
            type="date"
            aria-label="Due"
            autoFocus
            value={draft(dayOf(row, timeZone))}
            disabled={!!pending}
            onChange={(e) =>
              void commit({ column, value: e.target.value || null })
            }
          />
        );
      else
        content = (
          <TextCell
            initial={
              column === "estimate"
                ? row.estimate_minutes
                  ? String(row.estimate_minutes)
                  : ""
                : row.title
            }
            label={columnLabel(column)}
            placeholder={column === "estimate" ? "Minutes, or 1h 30" : ""}
            onCommit={(value) => commit({ column, value })}
            onCancel={done}
          />
        );
    }
    return (
      <td
        key={column}
        data-cell={`${r}:${c}`}
        tabIndex={r === 0 && c === 0 ? 0 : -1}
        className={`${editable ? "is-editable" : ""}${column === "title" ? " is-title" : ""}${column === "done" ? " is-tick" : ""}`}
        onClick={() => {
          if (
            editable &&
            !isEditing &&
            !writing.current &&
            (!failure || failure.key === key)
          )
            setEditing(key);
        }}
        title={
          column === "due" && row.can_write && isRepeatingTask(row)
            ? REPEATING_DATE_NOTE
            : undefined
        }
        onKeyDown={(e) => {
          if (e.key === "Escape" && isEditing && !writing.current) {
            e.preventDefault();
            e.stopPropagation();
            done();
          } else onCellKey(e, r, c, key, editable);
        }}
      >
        {content}
        {failure?.key === key &&
          column !== "title" &&
          column !== "estimate" &&
          !field && (
            <div className="vw-cell-failed">
              <span role="alert">Not saved.</span>
              <Button
                variant="ghost"
                disabled={!!pending}
                onClick={(event) => {
                  event.stopPropagation();
                  void commit(failure.edit);
                }}
              >
                Retry
              </Button>
            </div>
          )}
      </td>
    );
  };
  let r = -1;
  const totals = (list: ViewRow[], label: string) => (
    <tr className="vw-totals">
      {columns.map((column, c) => (
        <td key={column}>
          {c === 0 && columns[0] !== "done" ? (
            <strong>{label}</strong>
          ) : (
            columnTotal(list, column, fields, ctx)
          )}
        </td>
      ))}
    </tr>
  );
  return (
    <div
      className="vw-table-wrap"
      tabIndex={0}
      role="region"
      aria-label="View table"
    >
      {failure && (
        <div className="vw-cell-failed">
          <Button
            variant="ghost"
            disabled={!!pending}
            onClick={() => {
              if (writing.current) return;
              setFailure(null);
              setEditing(null);
              setDrafts({});
            }}
          >
            Cancel edit
          </Button>
        </div>
      )}
      <table className="vw-table" ref={table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className={column === "done" ? "is-tick" : ""}
              >
                {column === "done" ? (
                  <span className="sr-only">Done</span>
                ) : (
                  columnLabel(column, fields)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isFolded = folded.has(g.key);
            const Chevron = isFolded ? ChevronRight : ChevronDown;
            return (
              <Fragment key={g.key}>
                {grouped && (
                  <tr className="vw-group">
                    <th colSpan={columns.length} scope="colgroup">
                      <button
                        aria-expanded={!isFolded}
                        onClick={() => onToggleFold(g.key)}
                      >
                        <Chevron aria-hidden="true" />
                        {g.color && (
                          <i
                            style={{ background: g.color }}
                            aria-hidden="true"
                          />
                        )}
                        {groupHeader({
                          title: g.title || "Everything",
                          items: g.rows as never[],
                          minutes: g.minutes,
                        })}
                      </button>
                    </th>
                  </tr>
                )}
                {!isFolded &&
                  g.rows.map((row) => {
                    r += 1;
                    const at = r;
                    return (
                      <tr key={`${g.key}:${row.id}`}>
                        {columns.map((column, c) =>
                          renderCell(row, column, at, c),
                        )}
                      </tr>
                    );
                  })}
                {grouped &&
                  !isFolded &&
                  g.rows.length > 1 &&
                  totals(g.rows, "Total")}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={columns.length}>
              {viewTotals(rows, source, ctx)}
              {columns.some((c) => columnTotal(rows, c, fields, ctx)) && (
                <span>
                  {" · "}
                  {columns
                    .filter((c) => c !== "overdue")
                    .map((c) => {
                      const t = columnTotal(rows, c, fields, ctx);
                      return t && c !== "done"
                        ? `${columnLabel(c, fields)}: ${t}`
                        : t;
                    })
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

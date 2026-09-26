import {
  Fragment,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  cellText,
  columnLabel,
  columnTotal,
  fieldKeyId,
  groupHeader,
  isEditableColumn,
  isOverdue,
  isRepeatingTask,
  PRIORITIES,
  REPEATING_DATE_NOTE,
  statusChoices,
  statusText,
  viewTotals,
  type CustomField,
  type FieldValue,
  type ViewGroup,
  type ViewRow,
  type ViewSource,
} from "@orbyn/core";
import { DateField } from "../../components/DateField";
import { Select } from "../../components/Select";
import { FieldInput } from "./FieldInput";
import type { CellEdit } from "./edits";

type Props = {
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
  onEdit: (row: ViewRow, edit: CellEdit) => void;
};

/** The day a row is due, as the date picker reads it. */
const dayOf = (row: ViewRow, timeZone: string) => {
  if (!row.due_at) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.due_at)) return row.due_at;
  return new Date(row.due_at).toLocaleDateString("en-CA", { timeZone });
};

/**
 * A view as a table (DATA-02): the columns it keeps, grouped with a folding
 * header per group ("Physics · 5 · 3 h 20 min") and a totals row under each,
 * and the whole table's totals at the foot ("14 tasks · 11 h estimated · 3
 * overdue"). Cells change in place: click one or press Enter on it, then
 * Enter saves and Escape puts it back; the arrow keys move between cells.
 */
export function ViewTable({
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
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const now = new Date();
  const ctx = { now, timeZone };
  const names = { fields, people };
  const grouped = !(groups.length === 1 && groups[0].key === "all");

  const focusCell = (row: number, col: number) => {
    const cell = table.current?.querySelector<HTMLElement>(
      `[data-cell="${row}:${col}"]`,
    );
    cell?.focus();
  };

  const onCellKey = (
    e: KeyboardEvent<HTMLTableCellElement>,
    r: number,
    c: number,
    key: string,
    editable: boolean,
  ) => {
    if (editing === key) return;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      focusCell(r + move[0], c + move[1]);
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      if (editable) setEditing(key);
      else if (columns[c] === "title") onOpen(flat[r]);
    }
  };

  // Rows in the order shown, for arrow keys across groups.
  const flat: ViewRow[] = [];
  for (const g of groups) if (!folded.has(g.key)) flat.push(...g.rows);

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
      setEditing(null);
      requestAnimationFrame(() => focusCell(r, c));
    };
    const commit = (edit: CellEdit) => {
      onEdit(row, edit);
      done();
    };
    let content: ReactNode = cellText(row, column, ctx, names);
    if (column === "done")
      content = (
        <input
          type="checkbox"
          aria-label={`${row.status === "done" ? "Reopen" : "Finish"} ${row.title}`}
          checked={row.status === "done"}
          disabled={!row.can_write}
          onChange={() => onEdit(row, { column: "done" })}
        />
      );
    else if (column === "title" && !isEditing)
      content = (
        <button
          className="view-title-link"
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
      content = <span className="view-overdue">Overdue</span>;
    if (isEditing) {
      if (field)
        content = (
          <FieldInput
            field={field}
            value={row.fields[field.id]}
            people={people}
            autoFocus
            onCommit={(value: FieldValue) =>
              onEdit(row, { column, field: field.id, value })
            }
            onDone={done}
            className="view-cell-input"
          />
        );
      else if (column === "status")
        content = (
          <Select
            aria-label="Status"
            className="view-cell-input"
            value={row.status ?? ""}
            onChange={(e) => commit({ column, value: e.target.value })}
          >
            {statusChoices(row.kind).map((s) => (
              <option key={s} value={s}>
                {statusText(s)}
              </option>
            ))}
          </Select>
        );
      else if (column === "priority")
        content = (
          <Select
            aria-label="Priority"
            className="view-cell-input"
            value={row.priority ?? "medium"}
            onChange={(e) => commit({ column, value: e.target.value })}
          >
            {[...PRIORITIES].reverse().map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </Select>
        );
      else if (column === "due")
        content = (
          <DateField
            aria-label="Due"
            className="view-cell-input"
            autoFocus
            value={dayOf(row, timeZone)}
            placeholder="No deadline"
            onChange={(e) => commit({ column, value: e.target.value || null })}
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
        className={
          "view-cell" +
          (editable ? " is-editable" : "") +
          (isEditing ? " is-editing" : "") +
          (column === "title" ? " is-title" : "") +
          (column === "done" ? " is-tick" : "")
        }
        onClick={() => {
          if (editable && !isEditing) setEditing(key);
        }}
        title={
          column === "due" && row.can_write && isRepeatingTask(row)
            ? REPEATING_DATE_NOTE
            : undefined
        }
        onKeyDown={(e) => onCellKey(e, r, c, key, editable)}
      >
        {content}
      </td>
    );
  };

  let r = -1;
  const totalsRow = (list: ViewRow[], label: string) => (
    <tr className="view-totals-row">
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
    <div className="view-table-wrap">
      <table className="view-table" ref={table}>
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
            return (
              <Fragment key={g.key}>
                {grouped && (
                  <tr className="view-group-row">
                    <th colSpan={columns.length} scope="colgroup">
                      <button
                        className="task-group-fold"
                        aria-expanded={!isFolded}
                        onClick={() => onToggleFold(g.key)}
                      >
                        {isFolded ? (
                          <ChevronRight size={14} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={14} aria-hidden="true" />
                        )}
                        {g.color && (
                          <i
                            className="view-group-dot"
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
                  totalsRow(g.rows, "Total")}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={columns.length}>
              {viewTotals(rows, source, ctx)}
              {columns.some((c) => columnTotal(rows, c, fields, ctx)) && (
                <span className="view-foot-totals">
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

/** A name or an estimate being typed into its cell. */
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
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const left = useRef(false);
  const finish = (save: boolean) => {
    if (left.current) return;
    left.current = true;
    if (save && text.trim() !== initial.trim()) onCommit(text.trim());
    else onCancel();
  };
  return (
    <input
      autoFocus
      className="view-cell-input"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      maxLength={500}
      onChange={(e) => setText(e.target.value)}
      // Typing replaces what was there, as in a spreadsheet.
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

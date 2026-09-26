import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  DOC_KINDS,
  FIELD_FILTER_LABELS,
  FIELD_FILTER_OPS,
  type CustomField,
  type FieldFilter,
  type FieldFilterOp,
  type Folder,
  type Project,
  type Tag,
  type TaskList,
  type Team,
  type ViewDefinition,
  type ViewFilters as Filters,
} from "@orbyn/core";
import { Select } from "../../components/Select";

const KIND_LABELS: Record<string, string> = {
  doc: "Pages",
  note: "Notes",
  agenda: "Agendas",
  meeting: "Meeting notes",
};

type Due = "any" | "overdue" | "today" | "week" | "month" | "none";
const DUE_LABELS: Record<Due, string> = {
  any: "Any time",
  overdue: "Overdue",
  today: "Today",
  week: "In the next 7 days",
  month: "In the next 30 days",
  none: "No deadline",
};

const dueOf = (f: Filters): Due =>
  f.overdue
    ? "overdue"
    : f.no_due
      ? "none"
      : f.due_within_days === 0
        ? "today"
        : f.due_within_days === 7
          ? "week"
          : f.due_within_days === 30
            ? "month"
            : "any";

/** Without the keys whose value is unset. */
const tidy = (f: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(f).filter(
      ([, v]) => v !== undefined && v !== "" && v !== false,
    ),
  ) as Filters;

/**
 * A view's filters, in the words the agents' query uses: words, status,
 * team, project, list, tag, who it's assigned to, when it's due, the kind
 * of page and its folder, how recently it changed, and your own fields.
 */
export function ViewFilters({
  id,
  def,
  teams,
  projects,
  folders,
  lists,
  tags,
  fields,
  onChange,
}: {
  id: string;
  def: ViewDefinition;
  teams: Team[];
  projects: Project[];
  folders: Folder[];
  lists: TaskList[];
  tags: Tag[];
  fields: CustomField[];
  onChange: (filters: Filters) => void;
}) {
  const f = def.filters;
  const [words, setWords] = useState(f.text ?? "");
  useEffect(() => setWords(f.text ?? ""), [f.text]);
  useEffect(() => {
    if ((f.text ?? "") === words.trim()) return;
    const timer = window.setTimeout(
      () => set({ text: words.trim() || undefined }),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [words]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (next: Partial<Filters>) => onChange(tidy({ ...f, ...next }));
  const setDue = (due: Due) =>
    set({
      overdue: due === "overdue" || undefined,
      no_due: due === "none" || undefined,
      due_within_days:
        due === "today"
          ? 0
          : due === "week"
            ? 7
            : due === "month"
              ? 30
              : undefined,
    });
  const source = def.source;
  const fieldFilters = f.fields ?? [];
  const setFieldFilters = (next: FieldFilter[]) =>
    set({ fields: next.length ? next : undefined });

  return (
    <div
      id={id}
      className="filter-bar is-open view-filters"
      role="group"
      aria-label="Filters"
    >
      <label className="filter-select view-filter-words">
        <span>Words</span>
        <input
          type="search"
          value={words}
          placeholder="In the name"
          maxLength={200}
          onChange={(e) => setWords(e.target.value)}
        />
      </label>
      {source !== "pages" && (
        <label className="filter-select">
          <span>Status</span>
          <Select
            value={f.status ?? "open"}
            onChange={(e) =>
              set({
                status:
                  e.target.value === "open"
                    ? undefined
                    : (e.target.value as Filters["status"]),
              })
            }
          >
            <option value="open">
              {source === "projects" ? "Active" : "Open"}
            </option>
            <option value="done">
              {source === "projects" ? "Finished" : "Done"}
            </option>
            <option value="any">Any</option>
          </Select>
        </label>
      )}
      {source !== "pages" && (
        <label className="filter-select">
          <span>Due</span>
          <Select
            value={dueOf(f)}
            onChange={(e) => setDue(e.target.value as Due)}
          >
            {(Object.keys(DUE_LABELS) as Due[]).map((d) => (
              <option key={d} value={d}>
                {DUE_LABELS[d]}
              </option>
            ))}
          </Select>
        </label>
      )}
      <label className="filter-select">
        <span>Team</span>
        <Select
          value={f.team ?? ""}
          onChange={(e) => set({ team: e.target.value || undefined })}
        >
          <option value="">Everything I can see</option>
          <option value="personal">Only my own</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </label>
      {source !== "projects" && (
        <label className="filter-select">
          <span>Project</span>
          <Select
            value={f.project ?? ""}
            onChange={(e) => set({ project: e.target.value || undefined })}
          >
            <option value="">Any project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {source === "tasks" && (
        <>
          <label className="filter-select">
            <span>List</span>
            <Select
              value={f.list ?? ""}
              onChange={(e) => set({ list: e.target.value || undefined })}
            >
              <option value="">Any list</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="filter-select">
            <span>Assigned</span>
            <Select
              value={f.assignee ?? ""}
              onChange={(e) =>
                set({
                  assignee: (e.target.value ||
                    undefined) as Filters["assignee"],
                })
              }
            >
              <option value="">Anyone</option>
              <option value="me">Me</option>
            </Select>
          </label>
        </>
      )}
      {source !== "projects" && (
        <label className="filter-select">
          <span>Tag</span>
          <Select
            value={f.tag ?? ""}
            onChange={(e) => set({ tag: e.target.value || undefined })}
          >
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {source === "pages" && (
        <>
          <label className="filter-select">
            <span>Kind</span>
            <Select
              value={f.kind ?? ""}
              onChange={(e) =>
                set({ kind: (e.target.value || undefined) as Filters["kind"] })
              }
            >
              <option value="">Any kind</option>
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
          <label className="filter-select">
            <span>Folder</span>
            <Select
              value={f.folder ?? ""}
              onChange={(e) => set({ folder: e.target.value || undefined })}
            >
              <option value="">Any folder</option>
              {folders.map((fo) => (
                <option key={fo.id} value={fo.id}>
                  {fo.name}
                </option>
              ))}
            </Select>
          </label>
        </>
      )}
      <label className="filter-select">
        <span>Changed</span>
        <Select
          value={String(f.updated_within_days ?? "")}
          onChange={(e) =>
            set({
              updated_within_days: e.target.value
                ? Number(e.target.value)
                : undefined,
            })
          }
        >
          <option value="">Any time</option>
          <option value="1">Today</option>
          <option value="7">This week</option>
          <option value="30">This month</option>
        </Select>
      </label>

      {fieldFilters.map((ff, n) => {
        const field = fields.find((x) => x.id === ff.field);
        const ops = FIELD_FILTER_OPS.filter((op) =>
          field?.type === "date" || field?.type === "number"
            ? op !== "contains"
            : field?.type === "text"
              ? op !== "before" && op !== "after"
              : op !== "contains" && op !== "before" && op !== "after",
        );
        const needsValue = ff.op !== "empty" && ff.op !== "not_empty";
        const update = (next: Partial<FieldFilter>) =>
          setFieldFilters(
            fieldFilters.map((x, i) => (i === n ? { ...x, ...next } : x)),
          );
        return (
          <div key={n} className="view-field-filter">
            <Select
              aria-label="Field"
              value={ff.field}
              onChange={(e) =>
                update({ field: e.target.value, value: undefined })
              }
            >
              {fields.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="How"
              value={ff.op}
              onChange={(e) => update({ op: e.target.value as FieldFilterOp })}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {FIELD_FILTER_LABELS[op]}
                </option>
              ))}
            </Select>
            {needsValue &&
              (field?.type === "select" ? (
                <Select
                  aria-label="Value"
                  value={String(ff.value ?? "")}
                  onChange={(e) => update({ value: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {field.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : field?.type === "checkbox" ? (
                <Select
                  aria-label="Value"
                  value={String(ff.value ?? "true")}
                  onChange={(e) => update({ value: e.target.value === "true" })}
                >
                  <option value="true">Ticked</option>
                  <option value="false">Not ticked</option>
                </Select>
              ) : (
                <input
                  aria-label="Value"
                  value={String(ff.value ?? "")}
                  placeholder={field?.type === "date" ? "YYYY-MM-DD" : "Value"}
                  inputMode={field?.type === "number" ? "decimal" : undefined}
                  onChange={(e) =>
                    update({
                      value:
                        field?.type === "number" &&
                        e.target.value !== "" &&
                        Number.isFinite(Number(e.target.value))
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              ))}
            <button
              className="icon-button"
              aria-label="Remove this filter"
              onClick={() =>
                setFieldFilters(fieldFilters.filter((_, i) => i !== n))
              }
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      {fields.length > 0 && fieldFilters.length < 10 && (
        <button
          className="secondary"
          onClick={() =>
            setFieldFilters([
              ...fieldFilters,
              { field: fields[0].id, op: "not_empty" },
            ])
          }
        >
          <Plus size={14} aria-hidden="true" /> Filter by a field
        </button>
      )}
    </div>
  );
}

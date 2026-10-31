import {
  DOC_KINDS,
  FIELD_FILTER_LABELS,
  FIELD_FILTER_OPS,
  STATUSES,
  statusLabels,
  type CustomField,
  type FieldFilter,
  type FieldFilterOp,
  type Folder,
  type Project,
  type Tag,
  type TaskList,
  type Team,
  type ViewDefinition,
  type ViewFilters,
} from "@orbyn/core";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Field, IconButton, Input, SelectBox } from "../../ui/kit";
import type { Refine } from "./refine";

const KIND_LABELS: Record<string, string> = {
  doc: "Pages",
  note: "Notes",
  agenda: "Agendas",
  meeting: "Meeting notes",
};

type Due = "any" | "overdue" | "today" | "tomorrow" | "week" | "month" | "none";
const DUE_LABELS: Record<Due, string> = {
  any: "Any time",
  overdue: "Overdue",
  today: "Today",
  tomorrow: "By tomorrow",
  week: "In the next 7 days",
  month: "In the next 30 days",
  none: "No deadline",
};
const DUE_DAYS: Partial<Record<Due, number>> = {
  today: 0,
  tomorrow: 1,
  week: 7,
  month: 30,
};

const dueOf = (f: ViewFilters): Due => {
  if (f.overdue) return "overdue";
  if (f.no_due) return "none";
  const found = (Object.keys(DUE_DAYS) as Due[]).find(
    (key) => DUE_DAYS[key] === f.due_within_days,
  );
  return found ?? "any";
};

const tidy = (f: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(f).filter(
      ([, v]) => v !== undefined && v !== "" && v !== false,
    ),
  ) as ViewFilters;

/** Words, status, team, project, list, tag, who, when, and your own fields. */
export function Filters({
  def,
  teams,
  projects,
  folders,
  lists,
  tags,
  fields,
  refine,
  onChange,
  onRefine,
}: {
  def: ViewDefinition;
  teams: Team[];
  projects: Project[];
  folders: Folder[];
  lists: TaskList[];
  tags: Tag[];
  fields: CustomField[];
  refine: Refine;
  onChange: (filters: ViewFilters) => void;
  onRefine: (next: Refine) => void;
}) {
  const f = def.filters;
  const latest = useRef(f);
  latest.current = f;
  const [words, setWords] = useState(f.text ?? "");
  useEffect(() => setWords(f.text ?? ""), [f.text]);
  const set = (next: Partial<ViewFilters>) =>
    onChange(tidy({ ...latest.current, ...next }));
  useEffect(() => {
    if ((f.text ?? "") === words.trim()) return;
    const timer = setTimeout(
      () => set({ text: words.trim() || undefined }),
      400,
    );
    return () => clearTimeout(timer);
  }, [words]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = def.source;
  const setDue = (due: Due) =>
    set({
      overdue: due === "overdue" || undefined,
      no_due: due === "none" || undefined,
      due_within_days: DUE_DAYS[due],
    });
  const list = f.fields ?? [];
  const setFields = (next: FieldFilter[]) =>
    set({ fields: next.length ? next : undefined });
  return (
    <div className="vw-filters" role="group" aria-label="Filters">
      <Field label="Words">
        <Input
          type="search"
          value={words}
          placeholder="In the name"
          maxLength={200}
          onChange={(e) => setWords(e.target.value)}
        />
      </Field>
      {source !== "pages" && (
        <Field label="Status">
          <SelectBox
            value={f.status ?? "open"}
            onChange={(e) =>
              set({
                status:
                  e.target.value === "open"
                    ? undefined
                    : (e.target.value as ViewFilters["status"]),
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
          </SelectBox>
        </Field>
      )}
      {source !== "pages" && (
        <Field label="Due">
          <SelectBox
            value={dueOf(f)}
            onChange={(e) => setDue(e.target.value as Due)}
          >
            {(Object.keys(DUE_LABELS) as Due[]).map((d) => (
              <option key={d} value={d}>
                {DUE_LABELS[d]}
              </option>
            ))}
          </SelectBox>
        </Field>
      )}
      <Field label="Team">
        <SelectBox
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
        </SelectBox>
      </Field>
      {source !== "projects" && (
        <Field label="Project">
          <SelectBox
            value={f.project ?? ""}
            onChange={(e) => set({ project: e.target.value || undefined })}
          >
            <option value="">Any project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectBox>
        </Field>
      )}
      {source === "tasks" && (
        <>
          <Field label="List">
            <SelectBox
              value={f.list ?? ""}
              onChange={(e) => set({ list: e.target.value || undefined })}
            >
              <option value="">Any list</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label="Assigned">
            <SelectBox
              value={f.assignee ?? ""}
              onChange={(e) =>
                set({
                  assignee: (e.target.value ||
                    undefined) as ViewFilters["assignee"],
                })
              }
            >
              <option value="">Anyone</option>
              <option value="me">Me</option>
            </SelectBox>
          </Field>
        </>
      )}
      {source !== "projects" && (
        <Field label="Tag">
          <SelectBox
            value={f.tag ?? ""}
            onChange={(e) => set({ tag: e.target.value || undefined })}
          >
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectBox>
        </Field>
      )}
      {source === "pages" && (
        <>
          <Field label="Kind">
            <SelectBox
              value={f.kind ?? ""}
              onChange={(e) =>
                set({
                  kind: (e.target.value || undefined) as ViewFilters["kind"],
                })
              }
            >
              <option value="">Any kind</option>
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label="Folder">
            <SelectBox
              value={f.folder ?? ""}
              onChange={(e) => set({ folder: e.target.value || undefined })}
            >
              <option value="">Any folder</option>
              {folders.map((fo) => (
                <option key={fo.id} value={fo.id}>
                  {fo.name}
                </option>
              ))}
            </SelectBox>
          </Field>
        </>
      )}
      <Field label="Changed">
        <SelectBox
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
        </SelectBox>
      </Field>
      {source === "tasks" && (
        <>
          <Field label="Only this status">
            <SelectBox
              value={refine.status}
              onChange={(e) =>
                onRefine({
                  ...refine,
                  status: e.target.value as Refine["status"],
                })
              }
            >
              <option value="">Any listed above</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label="Priority">
            <SelectBox
              value={refine.priority}
              onChange={(e) =>
                onRefine({
                  ...refine,
                  priority: e.target.value as Refine["priority"],
                })
              }
            >
              <option value="">Any priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </SelectBox>
          </Field>
          <Field label="Size">
            <SelectBox
              value={refine.size}
              onChange={(e) => onRefine({ ...refine, size: e.target.value })}
            >
              <option value="">Any size</option>
              <option value="quick">Quick, 15 min or less</option>
              <option value="short">Short, up to an hour</option>
              <option value="long">Long, over an hour</option>
              <option value="none">No estimate</option>
            </SelectBox>
          </Field>
        </>
      )}
      {list.map((ff, n) => {
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
          setFields(list.map((x, i) => (i === n ? { ...x, ...next } : x)));
        return (
          <div key={n} className="vw-field-filter">
            <SelectBox
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
            </SelectBox>
            <SelectBox
              aria-label="How"
              value={ff.op}
              onChange={(e) => update({ op: e.target.value as FieldFilterOp })}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {FIELD_FILTER_LABELS[op]}
                </option>
              ))}
            </SelectBox>
            {needsValue &&
              (field?.type === "select" ? (
                <SelectBox
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
                </SelectBox>
              ) : field?.type === "checkbox" ? (
                <SelectBox
                  aria-label="Value"
                  value={String(ff.value ?? "true")}
                  onChange={(e) => update({ value: e.target.value === "true" })}
                >
                  <option value="true">Ticked</option>
                  <option value="false">Not ticked</option>
                </SelectBox>
              ) : (
                <Input
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
            <IconButton
              label="Remove this filter"
              onClick={() => setFields(list.filter((_, i) => i !== n))}
            >
              <X />
            </IconButton>
          </div>
        );
      })}
      {fields.length > 0 && list.length < 10 && (
        <Button
          onClick={() =>
            setFields([...list, { field: fields[0].id, op: "not_empty" }])
          }
        >
          <Plus aria-hidden="true" /> Filter by a field
        </Button>
      )}
    </div>
  );
}

import { useRef } from "react";
import {
  QUESTION_TYPES,
  SLOT_INTERVALS,
  addDays,
  localDateKey,
} from "@orbyn/core";
import { Button, Field, Input, SelectBox, TextArea } from "../../ui/kit";
import type { PageDraft } from "./page-data";
import { zone } from "./shared";
type Props = {
  value: PageDraft;
  change: <K extends keyof PageDraft>(key: K, value: PageDraft[K]) => void;
  disabled: boolean;
  hosts: { user_id: string; name: string }[];
};
export function PageRules({ value: v, change, disabled, hosts }: Props) {
  const custom = useRef<Extract<PageDraft["availability"], { mode: "custom" }>>(
    v.availability.mode === "custom"
      ? v.availability
      : {
          mode: "custom",
          timezone: zone(),
          weekly: [1, 2, 3, 4, 5].map((day) => ({
            day,
            start: "09:00",
            end: "17:00",
          })),
        },
  );
  if (v.availability.mode === "custom") custom.current = v.availability;
  return (
    <>
      <details data-booking-section="availability">
        <summary>Availability, buffers and limits</summary>
        <div className="booking-web-form-grid">
          {(
            [
              {
                key: "window_days",
                label: "Booking window (days)",
                min: 1,
                max: 90,
              },
              {
                key: "min_notice_minutes",
                label: "Minimum notice (minutes)",
                min: 0,
                max: 20160,
              },
              {
                key: "buffer_before_minutes",
                label: "Buffer before (minutes)",
                min: 0,
                max: 120,
              },
              {
                key: "buffer_after_minutes",
                label: "Buffer after (minutes)",
                min: 0,
                max: 120,
              },
            ] as const
          ).map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                type="number"
                min={f.min}
                max={f.max}
                value={v[f.key] ?? 0}
                disabled={disabled}
                onChange={(e) => change(f.key, Number(e.target.value))}
              />
            </Field>
          ))}
          <Field label="Start-time interval">
            <SelectBox
              value={v.slot_interval_minutes}
              disabled={disabled}
              onChange={(e) =>
                change("slot_interval_minutes", Number(e.target.value))
              }
            >
              {SLOT_INTERVALS.map((n) => (
                <option key={n} value={n}>
                  {n} minutes
                </option>
              ))}
            </SelectBox>
          </Field>
          {(["max_per_day", "max_per_week"] as const).map((key) => (
            <Field
              key={key}
              label={
                key === "max_per_day"
                  ? "Daily booking limit (blank for none)"
                  : "Weekly booking limit (blank for none)"
              }
            >
              <Input
                type="number"
                min={1}
                max={key === "max_per_day" ? 50 : 200}
                disabled={disabled}
                value={v[key] ?? ""}
                onChange={(e) =>
                  change(
                    key,
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
          ))}
        </div>
        <Field label="Availability source">
          <SelectBox
            disabled={disabled}
            value={v.availability.mode}
            onChange={(e) =>
              change(
                "availability",
                e.target.value === "working_hours"
                  ? { mode: "working_hours" }
                  : custom.current,
              )
            }
          >
            <option value="working_hours">
              Each host's planner working hours
            </option>
            <option value="custom">This page's custom hours</option>
          </SelectBox>
        </Field>
        {v.availability.mode === "custom" && (
          <>
            <Field
              label="Availability timezone"
              hint="Weekly hours are wall-clock times in this zone, including daylight-saving changes."
            >
              <Input
                disabled={disabled}
                value={v.availability.timezone}
                onChange={(e) => {
                  if (v.availability.mode === "custom")
                    change("availability", {
                      ...v.availability,
                      timezone: e.target.value,
                    });
                }}
              />
            </Field>
            {v.availability.weekly.map((r, i) => (
              <div className="booking-web-inline-fields" key={i}>
                <Field label="Day">
                  <SelectBox
                    value={r.day}
                    disabled={disabled}
                    onChange={(e) => {
                      if (v.availability.mode === "custom")
                        change("availability", {
                          ...v.availability,
                          weekly: v.availability.weekly.map((row, n) =>
                            n === i
                              ? { ...row, day: Number(e.target.value) }
                              : row,
                          ),
                        });
                    }}
                  >
                    {[
                      "Sunday",
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                    ].map((day, n) => (
                      <option key={day} value={n}>
                        {day}
                      </option>
                    ))}
                  </SelectBox>
                </Field>
                {(["start", "end"] as const).map((key) => (
                  <Field key={key} label={key}>
                    <Input
                      type="time"
                      required
                      disabled={disabled}
                      value={r[key]}
                      onChange={(e) => {
                        if (v.availability.mode === "custom")
                          change("availability", {
                            ...v.availability,
                            weekly: v.availability.weekly.map((row, n) =>
                              n === i ? { ...row, [key]: e.target.value } : row,
                            ),
                          });
                      }}
                    />
                  </Field>
                ))}
                <Button
                  disabled={disabled}
                  onClick={() => {
                    if (v.availability.mode === "custom")
                      change("availability", {
                        ...v.availability,
                        weekly: v.availability.weekly.filter((_, n) => n !== i),
                      });
                  }}
                >
                  Remove hours
                </Button>
                <Button
                  disabled={
                    disabled ||
                    v.availability.mode !== "custom" ||
                    v.availability.weekly.filter((h) => h.day === r.day)
                      .length > 6
                  }
                  onClick={() => {
                    if (v.availability.mode !== "custom") return;
                    const ranges = v.availability.weekly.filter(
                      (h) => h.day === r.day,
                    );
                    change("availability", {
                      ...v.availability,
                      weekly: [0, 1, 2, 3, 4, 5, 6].flatMap((day) =>
                        ranges.map((h) => ({ ...h, day })),
                      ),
                    });
                  }}
                >
                  Copy this weekday's hours to every day
                </Button>
              </div>
            ))}
            <Button
              disabled={disabled || v.availability.weekly.length >= 42}
              onClick={() => {
                if (v.availability.mode === "custom")
                  change("availability", {
                    ...v.availability,
                    weekly: [
                      ...v.availability.weekly,
                      { day: 1, start: "09:00", end: "17:00" },
                    ],
                  });
              }}
            >
              Add weekly hours
            </Button>
          </>
        )}
        <h3>Date overrides</h3>
        <p>
          A date with no ranges is closed. Dates and ranges stay in the
          availability timezone.
        </p>
        {v.date_overrides.map((o, i) => (
          <div className="booking-web-editor-row" key={i}>
            <Field label="Override date">
              <Input
                type="date"
                required
                value={o.date}
                disabled={disabled}
                onChange={(e) =>
                  change(
                    "date_overrides",
                    v.date_overrides.map((r, n) =>
                      n === i ? { ...r, date: e.target.value } : r,
                    ),
                  )
                }
              />
            </Field>
            {o.hours.map((r, j) => (
              <div className="booking-web-inline-fields" key={j}>
                {(["start", "end"] as const).map((key) => (
                  <Field key={key} label={key}>
                    <Input
                      type="time"
                      required
                      value={r[key]}
                      disabled={disabled}
                      onChange={(e) =>
                        change(
                          "date_overrides",
                          v.date_overrides.map((row, n) =>
                            n === i
                              ? {
                                  ...row,
                                  hours: row.hours.map((h, k) =>
                                    k === j
                                      ? { ...h, [key]: e.target.value }
                                      : h,
                                  ),
                                }
                              : row,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
                <Button
                  disabled={disabled}
                  onClick={() =>
                    change(
                      "date_overrides",
                      v.date_overrides.map((r, n) =>
                        n === i
                          ? { ...r, hours: r.hours.filter((_, k) => k !== j) }
                          : r,
                      ),
                    )
                  }
                >
                  Remove range
                </Button>
              </div>
            ))}
            <div className="booking-web-actions">
              <Button
                disabled={disabled || o.hours.length >= 6}
                onClick={() =>
                  change(
                    "date_overrides",
                    v.date_overrides.map((r, n) =>
                      n === i
                        ? {
                            ...r,
                            hours: [
                              ...r.hours,
                              { start: "09:00", end: "17:00" },
                            ],
                          }
                        : r,
                    ),
                  )
                }
              >
                Add range
              </Button>
              <Button
                disabled={disabled}
                onClick={() =>
                  change(
                    "date_overrides",
                    v.date_overrides.filter((_, n) => n !== i),
                  )
                }
              >
                Remove override
              </Button>
            </div>
          </div>
        ))}
        <Button
          disabled={disabled || v.date_overrides.length >= 100}
          onClick={() =>
            change("date_overrides", [
              ...v.date_overrides,
              {
                date: (() => {
                  let day = addDays(localDateKey(new Date(), zone()), 1);
                  const used = new Set(v.date_overrides.map((o) => o.date));
                  while (used.has(day)) day = addDays(day, 1);
                  return day;
                })(),
                hours: [],
              },
            ])
          }
        >
          Add date override
        </Button>
      </details>
      <details data-booking-section="questions">
        <summary>Questions and answer routing</summary>
        {v.questions.map((q, i) => (
          <div key={i} className="booking-web-editor-row">
            <Field label="Question ID">
              <Input
                value={q.id}
                readOnly
                disabled={disabled}
                maxLength={40}
                pattern="[a-z0-9_-]+"
                onChange={(e) =>
                  change(
                    "questions",
                    v.questions.map((r, n) =>
                      n === i ? { ...r, id: e.target.value } : r,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Question label">
              <Input
                required
                maxLength={200}
                disabled={disabled}
                value={q.label}
                onChange={(e) =>
                  change(
                    "questions",
                    v.questions.map((r, n) =>
                      n === i ? { ...r, label: e.target.value } : r,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Answer type">
              <SelectBox
                disabled={disabled}
                value={q.type}
                onChange={(e) =>
                  change(
                    "questions",
                    v.questions.map((r, n) =>
                      n === i
                        ? { ...r, type: e.target.value as typeof q.type }
                        : r,
                    ),
                  )
                }
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll("_", " ")}
                  </option>
                ))}
              </SelectBox>
            </Field>
            <label>
              <input
                type="checkbox"
                checked={q.required}
                disabled={disabled}
                onChange={(e) =>
                  change(
                    "questions",
                    v.questions.map((r, n) =>
                      n === i ? { ...r, required: e.target.checked } : r,
                    ),
                  )
                }
              />
              Required
            </label>
            {q.type === "choice" && (
              <Field label="Choices (one per line, 2–12)">
                <TextArea
                  disabled={disabled}
                  value={q.options.join("\n")}
                  onChange={(e) =>
                    change(
                      "questions",
                      v.questions.map((r, n) =>
                        n === i
                          ? { ...r, options: e.target.value.split("\n") }
                          : r,
                      ),
                    )
                  }
                />
              </Field>
            )}
            <div className="booking-web-actions">
              <Button
                disabled={disabled || i === 0}
                onClick={() => {
                  const rows = [...v.questions];
                  [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
                  change("questions", rows);
                }}
              >
                Move question up
              </Button>
              <Button
                disabled={disabled || i === v.questions.length - 1}
                onClick={() => {
                  const rows = [...v.questions];
                  [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
                  change("questions", rows);
                }}
              >
                Move question down
              </Button>
              <Button
                disabled={disabled}
                onClick={() =>
                  change(
                    "questions",
                    v.questions.filter((_, n) => n !== i),
                  )
                }
              >
                Remove question
              </Button>
            </div>
          </div>
        ))}
        <Button
          disabled={disabled || v.questions.length >= 10}
          onClick={() =>
            change("questions", [
              ...v.questions,
              {
                id: "q_" + crypto.randomUUID().slice(0, 8),
                label: "",
                type: "text",
                required: false,
                options: [],
              },
            ])
          }
        >
          Add question
        </Button>
        <Field label="Assignment">
          <SelectBox
            disabled={disabled}
            value={v.assignment}
            onChange={(e) =>
              change("assignment", e.target.value as typeof v.assignment)
            }
          >
            <option value="collective">
              Collective: required hosts attend
            </option>
            <option value="round_robin">
              Round robin: one host is assigned
            </option>
          </SelectBox>
        </Field>
        <p>
          Routing rules prefer a matching host on round-robin pages. They do not
          force every co-host to attend.
        </p>
        {v.routing.map((r, i) => (
          <div key={i} className="booking-web-editor-row">
            <Field label="Routing question">
              <SelectBox
                disabled={disabled}
                value={r.question_id}
                onChange={(e) =>
                  change(
                    "routing",
                    v.routing.map((row, n) =>
                      n === i ? { ...row, question_id: e.target.value } : row,
                    ),
                  )
                }
              >
                <option value="">Choose question</option>
                {r.question_id &&
                  !v.questions.some((q) => q.id === r.question_id) && (
                    <option value={r.question_id}>
                      Removed question · {r.question_id}
                    </option>
                  )}
                {v.questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label || q.id}
                  </option>
                ))}
              </SelectBox>
            </Field>
            <Field label="Answer equals">
              <Input
                required
                maxLength={200}
                disabled={disabled}
                value={r.equals}
                onChange={(e) =>
                  change(
                    "routing",
                    v.routing.map((row, n) =>
                      n === i ? { ...row, equals: e.target.value } : row,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Preferred host">
              <SelectBox
                value={r.host_user_id}
                disabled={disabled}
                onChange={(e) =>
                  change(
                    "routing",
                    v.routing.map((row, n) =>
                      n === i ? { ...row, host_user_id: e.target.value } : row,
                    ),
                  )
                }
              >
                <option value="">Choose host</option>
                {r.host_user_id &&
                  !hosts.some((h) => h.user_id === r.host_user_id) && (
                    <option value={r.host_user_id}>
                      Saved host unavailable
                    </option>
                  )}
                {hosts.map((h) => (
                  <option key={h.user_id} value={h.user_id}>
                    {h.name}
                  </option>
                ))}
              </SelectBox>
            </Field>
            <Button
              disabled={disabled}
              onClick={() =>
                change(
                  "routing",
                  v.routing.filter((_, n) => n !== i),
                )
              }
            >
              Remove routing rule
            </Button>
          </div>
        ))}
        <Button
          disabled={disabled || v.routing.length >= 20}
          onClick={() =>
            change("routing", [
              ...v.routing,
              { question_id: "", equals: "", host_user_id: "" },
            ])
          }
        >
          Add routing rule
        </Button>
      </details>
    </>
  );
}

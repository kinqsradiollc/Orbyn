import {
  describeRrule,
  measureLabel,
  measureProgress,
  type Item,
  type Tag,
} from "@orbyn/core";
import { Check, Plus, X } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, IconButton, Input, SelectBox } from "../../ui/kit";
import type { Invitee, LinkDraft, Measure } from "./draft";
import {
  alertLabel,
  repeatProblem,
  rruleFromDraft,
  SWATCH_NAMES,
  SWATCHES,
  type RepeatDraft,
  type RepeatFreq,
} from "./format";

/** Text typed into an add row and not yet added, by field. */
export type Pending = Record<string, boolean>;

const onEnter = (run: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
    event.preventDefault();
    run();
  }
};

export function Chip({
  children,
  label,
  onRemove,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <li className="st-chip">
      <span dir="auto">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

/** A row of colour choices, as a radio group. */
export function Swatches({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const selected = Math.max(0, SWATCHES.indexOf(value.toLowerCase()));
  return (
    <div className="st-swatches" role="radiogroup" aria-label={label}>
      {SWATCHES.map((color, index) => {
        const on = value.toLowerCase() === color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            disabled={disabled}
            aria-checked={on}
            aria-label={SWATCH_NAMES[index]}
            tabIndex={selected === index ? 0 : -1}
            style={{ background: color }}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const next = (index + step + SWATCHES.length) % SWATCHES.length;
              onChange(SWATCHES[next]);
              const group = event.currentTarget.parentElement;
              group?.querySelectorAll("button")[next]?.focus();
            }}
            onClick={() => onChange(color)}
          >
            {on && <Check aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

export function TagsField({
  tags,
  selected,
  onChange,
  onCreate,
  disabled,
  pending,
}: {
  tags: Tag[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onCreate?: (name: string) => Promise<Tag | null>;
  disabled?: boolean;
  pending: Pending;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const full = selected.length >= 20;
  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed || !onCreate || busy || full) return;
    const existing = tags.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
    );
    let tag: Tag | null = existing ?? null;
    if (!tag) {
      setBusy(true);
      tag = await onCreate(trimmed);
      setBusy(false);
    }
    if (!tag) return;
    if (!selected.includes(tag.id)) onChange([...selected, tag.id]);
    pending.tags = false;
    setName("");
  };
  return (
    <div className="st-stack">
      {tags.length > 0 && (
        <div className="st-tags" role="group" aria-label="Tags">
          {tags.map((tag) => {
            const on = selected.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                className="st-tag"
                aria-pressed={on}
                disabled={disabled || (!on && full)}
                onClick={() =>
                  onChange(
                    on
                      ? selected.filter((id) => id !== tag.id)
                      : [...selected, tag.id],
                  )
                }
              >
                <i style={{ background: tag.color }} aria-hidden="true" />
                <span dir="auto">{tag.name}</span>
                {on && <Check aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
      {onCreate && (
        <div className="st-add">
          <Input
            aria-label="New tag"
            placeholder="New tag"
            maxLength={40}
            value={name}
            disabled={disabled || busy}
            onKeyDown={onEnter(() => void add())}
            onChange={(event) => {
              setName(event.target.value);
              pending.tags = !!event.target.value.trim();
            }}
          />
          <Button
            disabled={disabled || busy || !name.trim()}
            onClick={() => void add()}
          >
            <Plus aria-hidden="true" /> Add
          </Button>
        </div>
      )}
    </div>
  );
}

const ALERT_PRESETS = [0, 5, 10, 15, 30, 60, 1440];
const UNITS = { min: 1, hours: 60, days: 1440 } as const;

export function AlertsField({
  value,
  onChange,
  hint,
  disabled,
  pending,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  hint?: string;
  disabled?: boolean;
  pending: Pending;
}) {
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState("30");
  const [amount, setAmount] = useState("20");
  const [unit, setUnit] = useState<keyof typeof UNITS>("min");
  const [error, setError] = useState("");
  const free = ALERT_PRESETS.filter((m) => !value.includes(m));
  const show = (on: boolean) => {
    setAdding(on);
    pending.alerts = on;
  };
  const add = () => {
    const minutes =
      choice === "custom" ? Number(amount) * UNITS[unit] : Number(choice);
    if (value.length >= 5) return setError("Up to five alerts.");
    if (
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > 40320 ||
      (choice === "custom" && (!amount.trim() || Number(amount) < 1))
    )
      return setError("Use a whole number, up to four weeks before.");
    setError("");
    onChange([...new Set([...value, minutes])].sort((a, b) => a - b));
    show(false);
  };
  return (
    <div className="st-stack">
      {value.length ? (
        <ul className="st-chips">
          {value.map((m) => (
            <Chip
              key={m}
              label={`Remove the alert ${alertLabel(m)}`}
              disabled={disabled}
              onRemove={() => onChange(value.filter((x) => x !== m))}
            >
              {alertLabel(m)}
            </Chip>
          ))}
        </ul>
      ) : (
        <p className="st-hint">No reminder</p>
      )}
      {hint && <p className="st-hint">{hint}</p>}
      {adding ? (
        <div className="st-add">
          <SelectBox
            aria-label="When to remind"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            {free.map((m) => (
              <option key={m} value={m}>
                {alertLabel(m)}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </SelectBox>
          {choice === "custom" && (
            <>
              <Input
                type="number"
                min={1}
                aria-label="How many"
                value={amount}
                onKeyDown={onEnter(add)}
                onChange={(event) => setAmount(event.target.value)}
              />
              <SelectBox
                aria-label="Unit"
                value={unit}
                onChange={(event) =>
                  setUnit(event.target.value as keyof typeof UNITS)
                }
              >
                <option value="min">minutes before</option>
                <option value="hours">hours before</option>
                <option value="days">days before</option>
              </SelectBox>
            </>
          )}
          <Button onClick={add}>Add</Button>
          <Button variant="ghost" onClick={() => show(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        value.length < 5 && (
          <div>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => show(true)}
            >
              <Plus aria-hidden="true" /> Add alert
            </Button>
          </div>
        )
      )}
      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const LINK = /^https?:\/\/\S+$/i;

export function LinksField({
  value,
  onChange,
  state,
  disabled,
  pending,
}: {
  value: LinkDraft[];
  onChange: (next: LinkDraft[]) => void;
  state: "loading" | "ready" | "failed";
  disabled?: boolean;
  pending: Pending;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const typed = (u: string, t: string) => {
    pending.links = !!u.trim() || !!t.trim();
  };
  const add = () => {
    const address = url.trim();
    if (!LINK.test(address))
      return setError("Links start with http:// or https://.");
    if (value.length >= 20) return setError("Up to 20 links.");
    if (value.some((link) => link.url === address))
      return setError("That link is already here.");
    onChange([...value, { url: address, title: title.trim() }]);
    setUrl("");
    setTitle("");
    setError("");
    pending.links = false;
  };
  if (state === "loading") return <p className="st-hint">Loading links…</p>;
  if (state === "failed")
    return (
      <p className="st-hint">Couldn't load the links. They stay as they are.</p>
    );
  return (
    <div className="st-stack">
      {value.length > 0 && (
        <ul className="st-chips">
          {value.map((link, index) => (
            <Chip
              key={link.url}
              label={`Remove the link ${link.title || link.url}`}
              disabled={disabled}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            >
              {link.title || link.url}
            </Chip>
          ))}
        </ul>
      )}
      {value.length < 20 && (
        <div className="st-add">
          <Input
            type="url"
            placeholder="https://"
            aria-label="Link address"
            maxLength={2000}
            value={url}
            disabled={disabled}
            onKeyDown={onEnter(add)}
            onChange={(event) => {
              setUrl(event.target.value);
              setError("");
              typed(event.target.value, title);
            }}
          />
          <Input
            placeholder="Title (optional)"
            aria-label="Link title (optional)"
            maxLength={200}
            value={title}
            disabled={disabled}
            onKeyDown={onEnter(add)}
            onChange={(event) => {
              setTitle(event.target.value);
              typed(url, event.target.value);
            }}
          />
          <Button disabled={disabled || !url.trim()} onClick={add}>
            <Plus aria-hidden="true" /> Add
          </Button>
        </div>
      )}
      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ANSWERS: Record<string, string> = {
  accepted: "Going",
  declined: "Not going",
  tentative: "Maybe",
  needs_action: "No answer yet",
};

export function InviteesField({
  value,
  onChange,
  state,
  disabled,
  pending,
}: {
  value: Invitee[];
  onChange: (next: Invitee[]) => void;
  state: "loading" | "ready" | "failed";
  disabled?: boolean;
  pending: Pending;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) return setError("Enter an email address.");
    if (value.some((person) => person.email === address))
      return setError("That person is already invited.");
    if (value.length >= 50) return setError("Up to 50 people.");
    onChange([...value, { email: address, name: name.trim() || undefined }]);
    setEmail("");
    setName("");
    setError("");
    pending.invitees = false;
  };
  if (state === "loading") return <p className="st-hint">Loading invitees…</p>;
  if (state === "failed")
    return (
      <p className="st-hint">Couldn't load invitees. They stay as they are.</p>
    );
  return (
    <div className="st-stack">
      {value.length > 0 && (
        <ul className="st-chips">
          {value.map((person) => (
            <Chip
              key={person.email}
              label={`Remove ${person.name || person.email}`}
              disabled={disabled}
              onRemove={() =>
                onChange(value.filter((p) => p.email !== person.email))
              }
            >
              {person.name || person.email}
              {person.status && (
                <small> · {ANSWERS[person.status] ?? person.status}</small>
              )}
            </Chip>
          ))}
        </ul>
      )}
      <div className="st-add">
        <Input
          type="email"
          placeholder="name@example.com"
          aria-label="Invite by email"
          value={email}
          disabled={disabled}
          onKeyDown={onEnter(add)}
          onChange={(event) => {
            setEmail(event.target.value);
            setError("");
            pending.invitees = !!event.target.value.trim();
          }}
        />
        <Input
          placeholder="Name (optional)"
          aria-label="Their name (optional)"
          maxLength={120}
          value={name}
          disabled={disabled}
          onKeyDown={onEnter(add)}
          onChange={(event) => {
            setName(event.target.value);
            pending.invitees = !!email.trim() || !!event.target.value.trim();
          }}
        />
        <Button disabled={disabled || !email.trim()} onClick={add}>
          <Plus aria-hidden="true" /> Invite
        </Button>
      </div>
      <p className="st-hint">
        They get an email and answer from a link, no account needed.
      </p>
      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function WaitsOnField({
  selfId,
  items,
  selected,
  onChange,
  disabled,
}: {
  selfId: string | null;
  items: Item[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const open = items.filter(
    (item) =>
      item.kind === "task" &&
      item.id !== selfId &&
      item.status !== "done" &&
      item.status !== "cancelled" &&
      !selected.includes(item.id),
  );
  const full = selected.length >= 14;
  return (
    <div className="st-stack">
      {selected.length > 0 && (
        <ul className="st-chips">
          {selected.map((id) => (
            <Chip
              key={id}
              label={`Stop waiting on ${byId.get(id)?.title ?? "this task"}`}
              disabled={disabled}
              onRemove={() => onChange(selected.filter((x) => x !== id))}
            >
              {byId.get(id)?.title ?? "A task you can't see"}
            </Chip>
          ))}
        </ul>
      )}
      {open.length > 0 ? (
        <SelectBox
          aria-label="Add a task to wait on"
          disabled={disabled || full}
          value=""
          onChange={(event) => {
            if (event.target.value) onChange([...selected, event.target.value]);
          }}
        >
          <option value="">{full ? "Up to 14 tasks" : "Add a task…"}</option>
          {open.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </SelectBox>
      ) : (
        <p className="st-hint">No other open tasks</p>
      )}
    </div>
  );
}

export function MeasureField({
  value,
  onChange,
  disabled,
}: {
  value: Measure;
  onChange: (next: Measure) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<Measure>) => onChange({ ...value, ...patch });
  const number = (text: string) =>
    text.trim() === "" || !Number.isFinite(Number(text)) ? null : Number(text);
  const numbers = {
    target_value: number(value.target),
    current_value: number(value.current) ?? 0,
    value_unit: value.unit,
  };
  const percent = measureProgress(numbers);
  const noTarget = value.target.trim() === "";
  return (
    <div className="st-stack">
      <div className="st-add">
        <Input
          aria-label="Now"
          type="number"
          inputMode="decimal"
          placeholder="Now"
          value={value.current}
          disabled={disabled || noTarget}
          onChange={(event) => set({ current: event.target.value })}
        />
        <Input
          aria-label="Target"
          type="number"
          inputMode="decimal"
          placeholder="Target"
          value={value.target}
          disabled={disabled}
          onChange={(event) => set({ target: event.target.value })}
        />
        <Input
          aria-label="Unit"
          maxLength={16}
          placeholder="Unit"
          value={value.unit}
          disabled={disabled || noTarget}
          onChange={(event) => set({ unit: event.target.value })}
        />
      </div>
      <p className="st-hint">
        {percent === null
          ? "Progress follows the target."
          : `${measureLabel(numbers)} · ${percent}%`}
      </p>
    </div>
  );
}

const REPEATS: { id: RepeatFreq; label: string }[] = [
  { id: "none", label: "Does not repeat" },
  { id: "DAILY", label: "Daily" },
  { id: "WEEKDAYS", label: "Every weekday" },
  { id: "WEEKLY", label: "Weekly" },
  { id: "MONTHLY", label: "Monthly" },
  { id: "YEARLY", label: "Yearly" },
];
const UNIT_WORDS: Partial<Record<RepeatFreq, string>> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
  YEARLY: "years",
};
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RepeatField({
  value,
  onChange,
  hasDate,
  originalRule,
  disabled,
}: {
  value: RepeatDraft;
  onChange: (next: RepeatDraft) => void;
  hasDate: boolean;
  originalRule?: string | null;
  disabled?: boolean;
}) {
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...value, ...patch });
  const unit = UNIT_WORDS[value.freq];
  const problem = repeatProblem(value);
  const rule = originalRule ?? rruleFromDraft(value);
  return (
    <div className="st-stack">
      <div className="st-add">
        <SelectBox
          aria-label="How often"
          disabled={disabled}
          value={value.freq}
          onChange={(event) => set({ freq: event.target.value as RepeatFreq })}
        >
          {REPEATS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </SelectBox>
        {unit && (
          <label className="st-inline">
            Every
            <Input
              type="number"
              min={1}
              max={99}
              disabled={disabled}
              value={Number.isNaN(value.interval) ? "" : value.interval}
              onChange={(event) =>
                set({ interval: event.target.valueAsNumber })
              }
            />
            {value.interval === 1 ? unit.slice(0, -1) : unit}
          </label>
        )}
      </div>
      {value.freq === "WEEKLY" && (
        <div className="st-days" role="group" aria-label="Repeat on">
          {DAY_NAMES.map((name, day) => {
            const on = value.byDay.includes(day);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                disabled={disabled || (on && value.byDay.length === 1)}
                onClick={() =>
                  set({
                    byDay: on
                      ? value.byDay.filter((x) => x !== day)
                      : [...value.byDay, day].sort(),
                  })
                }
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
      {value.freq !== "none" && (
        <div className="st-add">
          <SelectBox
            aria-label="Ends"
            disabled={disabled}
            value={value.ends}
            onChange={(event) =>
              set({ ends: event.target.value as RepeatDraft["ends"] })
            }
          >
            <option value="never">Never ends</option>
            <option value="count">After a number of times</option>
            <option value="until">On a date</option>
          </SelectBox>
          {value.ends === "count" && (
            <Input
              type="number"
              min={1}
              max={999}
              aria-label="Times"
              disabled={disabled}
              value={Number.isNaN(value.count) ? "" : value.count}
              onChange={(event) => set({ count: event.target.valueAsNumber })}
            />
          )}
          {value.ends === "until" && (
            <Input
              type="date"
              aria-label="Last date"
              disabled={disabled}
              value={value.until}
              onChange={(event) => set({ until: event.target.value })}
            />
          )}
        </div>
      )}
      {problem && (
        <p className="st-error" role="alert">
          {problem}
        </p>
      )}
      {rule && (
        <p className="st-hint">
          {describeRrule(rule)}
          {!hasDate && " · Add a start date."}
        </p>
      )}
    </div>
  );
}

export function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="st-color">
      <Swatches
        label="Colour"
        value={value ?? ""}
        disabled={disabled}
        onChange={onChange}
      />
      {value && (
        <IconButton
          label="Use the default colour"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <X />
        </IconButton>
      )}
    </div>
  );
}

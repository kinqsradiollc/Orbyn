import { SettingsSection } from "./SettingsSection";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarPlus,
  CalendarSync,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  CALENDAR_KINDS,
  CALENDAR_KIND_DEFAULTS,
  CALENDAR_REMINDER_CHOICES,
  guessCalendarKind,
  reminderLabel,
  type CalendarFeedSettings,
  type CalendarKind,
  type CalendarSharing,
  type CalendarSubscription,
} from "@orbyn/core";
import { Select } from "../../components/Select";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Swatches } from "../lists/ListsView";
import { copyText, plural, SWATCHES } from "../../lib/planning";
import { timeAgo } from "../../lib/tasks";

type Props = { report: (e: unknown) => void };

/** A feed link just made: shown once, with a copy button. */
function LinkBox({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-box">
      <strong>{label}</strong>
      <div className="secret-row">
        <code>{url}</code>
        <button
          type="button"
          className="secondary"
          onClick={() => void copyText(url).then(setCopied)}
        >
          <Copy size={13} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <small>Copy it now: links are shown only once. Keep it private.</small>
    </div>
  );
}

/**
 * Your calendar for other apps: the full link, a busy-only link that can be
 * shared without the details, and whether time blocks are included.
 */
export function CalendarFeedCard({ report }: Props) {
  const { ask, tell } = useConfirm();
  const [settings, setSettings] = useState<CalendarFeedSettings | null>(null);
  const [links, setLinks] = useState<{ full?: string; busy?: string }>({});
  const action = useAction(report);

  useEffect(() => {
    client.calendarFeedSettings().then(setSettings, report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const make = (busy: boolean) =>
    void action.run(async () => {
      const had = busy ? settings?.busy_enabled : settings?.enabled;
      const feed = await client.createCalendarFeed({ busy });
      setLinks((l) => ({ ...l, [busy ? "busy" : "full"]: feed.url }));
      setSettings(
        (s) => s && { ...s, [busy ? "busy_enabled" : "enabled"]: true },
      );
      return had
        ? "Made a new link. The old one no longer works."
        : "Your link is ready.";
    });
  const turnOff = async (busy: boolean) => {
    if (
      !(await ask({
        title: busy
          ? "Turn off the busy-only link? Anyone using it stops seeing updates."
          : "Turn off the calendar feed? Subscribed apps stop updating.",
        confirmLabel: "Turn off",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      await client.deleteCalendarFeed({ busy });
      setLinks((l) => ({ ...l, [busy ? "busy" : "full"]: undefined }));
      setSettings(
        (s) => s && { ...s, [busy ? "busy_enabled" : "enabled"]: false },
      );
      return "That link is off and no longer works.";
    });
  };
  const includeBlocks = (on: boolean) =>
    void action.run(async () => {
      setSettings(
        await client.updateCalendarFeedSettings({ include_blocks: on }),
      );
      return on
        ? "Sessions are in the feed now."
        : "Sessions are left out of the feed.";
    });

  const linkSection = (busy: boolean) => {
    const on = busy ? settings?.busy_enabled : settings?.enabled;
    const url = busy ? links.busy : links.full;
    return (
      <div className="feed-link">
        <h3 className="settings-subtitle">
          {busy ? "Busy-only link" : "Full calendar link"}{" "}
          <span className="chip">{on ? "On" : "Off"}</span>
        </h3>
        <p className="muted">
          {busy
            ? "Shows only when you're busy, never what for. Share it with people who need to see your free time."
            : "Everything on your calendar, for your own apps. Anyone with the link can see it."}
        </p>
        {url && (
          <LinkBox label={busy ? "Busy-only link" : "Private link"} url={url} />
        )}
        <div className="button-row start">
          <button
            className={busy ? "secondary" : "primary"}
            disabled={action.pending || !settings}
            onClick={() => make(busy)}
          >
            <CalendarSync size={14} /> {on ? "Regenerate link" : "Create link"}
          </button>
          {on && (
            <button
              className="secondary"
              disabled={action.pending}
              onClick={() => turnOff(busy)}
            >
              Turn off
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="feed-title"
    >
      <h2 id="feed-title">
        <CalendarSync size={16} aria-hidden="true" /> Calendar feed
      </h2>
      <p className="muted">
        In Apple Calendar, Google Calendar or Outlook, choose “Subscribe to
        calendar” (or “From URL”) and paste a link.
      </p>
      {!settings ? (
        <p className="muted">Loading your feed settings…</p>
      ) : (
        <>
          {linkSection(false)}
          {linkSection(true)}
          <label className="switch-line settings-field feed-option">
            <input
              type="checkbox"
              role="switch"
              className="ai-switch"
              checked={settings.include_blocks}
              disabled={action.pending}
              onChange={(e) => includeBlocks(e.target.checked)}
            />
            <span>
              Include sessions
              <small>
                Shown as “Session: task name” with its deadline in the full
                feed. All-day tasks and events show as all-day, with no time.
              </small>
            </span>
          </label>
        </>
      )}
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}

type SubDraft = {
  name: string;
  color: string;
  kind: CalendarKind;
  busy: boolean;
  all_day_busy: boolean;
  visible: boolean;
  sharing: CalendarSharing;
  reminder_minutes: number | null;
};

/** A new calendar's settings: the kind's defaults. */
const draftFor = (kind: CalendarKind, name = "", color = SWATCHES[2]) => {
  const d = CALENDAR_KIND_DEFAULTS[kind];
  return {
    name,
    color,
    kind,
    busy: d.busy,
    all_day_busy: d.all_day_busy,
    visible: true,
    sharing: d.sharing,
    reminder_minutes: d.reminder_minutes,
  } satisfies SubDraft;
};

const draftOf = (s: CalendarSubscription): SubDraft => ({
  name: s.name,
  color: s.color,
  kind: s.kind,
  busy: s.busy,
  all_day_busy: s.all_day_busy,
  visible: s.visible,
  sharing: s.sharing,
  reminder_minutes: s.reminder_minutes,
});

/** "Classes · Busy · Reminds 10 minutes before · Hidden from teammates". */
function summary(s: CalendarSubscription) {
  return [
    CALENDAR_KIND_DEFAULTS[s.kind].label,
    s.busy
      ? s.all_day_busy
        ? "Busy, all-day blocks the day"
        : "Busy"
      : "Not busy",
    s.reminder_minutes != null
      ? `Reminds ${reminderLabel(s.reminder_minutes)}`
      : "",
    s.sharing === "hidden" ? "Kept from teammates" : "",
    s.visible ? "" : "Hidden from calendar",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A subscribed calendar's settings, for adding one and changing it: what it
 * holds (which picks sensible defaults), then each setting on its own.
 */
function SubscriptionFields({
  id,
  draft,
  onChange,
}: {
  id: string;
  draft: SubDraft;
  onChange: (next: SubDraft) => void;
}) {
  return (
    <div className="settings-grid">
      <div className="settings-field wide">
        <span className="settings-label" id={`${id}-kind`}>
          What&apos;s in it
        </span>
        <div
          className="kind-picker"
          role="radiogroup"
          aria-labelledby={`${id}-kind`}
        >
          {CALENDAR_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={draft.kind === k}
              className={draft.kind === k ? "active" : ""}
              onClick={() =>
                onChange({
                  ...draftFor(k, draft.name, draft.color),
                  visible: draft.visible,
                })
              }
            >
              {CALENDAR_KIND_DEFAULTS[k].label}
            </button>
          ))}
        </div>
        <small className="field-hint">
          {CALENDAR_KIND_DEFAULTS[draft.kind].hint}
        </small>
      </div>
      <div className="settings-field wide">
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          required
          maxLength={80}
          placeholder="e.g. Uni timetable"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="settings-field wide">
        <span className="settings-label">Colour</span>
        <Swatches
          label="Calendar colour"
          value={draft.color}
          onChange={(color) => onChange({ ...draft, color })}
        />
      </div>
      <label className="switch-line settings-field">
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          checked={draft.busy}
          onChange={(e) => onChange({ ...draft, busy: e.target.checked })}
        />
        <span>
          Counts as busy
          <small>
            The planner, booking pages and teammates work around it.
          </small>
        </span>
      </label>
      <label className="switch-line settings-field">
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          checked={draft.all_day_busy}
          disabled={!draft.busy}
          onChange={(e) =>
            onChange({ ...draft, all_day_busy: e.target.checked })
          }
        />
        <span>
          All-day events block the day
          <small>
            For exam days and leave. Public holidays usually don&apos;t.
          </small>
        </span>
      </label>
      <label className="switch-line settings-field">
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          checked={draft.visible}
          onChange={(e) => onChange({ ...draft, visible: e.target.checked })}
        />
        <span>
          Show on my calendar
          <small>Hidden calendars still count as busy.</small>
        </span>
      </label>
      <label className="settings-field">
        Teammates see
        <Select
          value={draft.sharing}
          onChange={(e) =>
            onChange({ ...draft, sharing: e.target.value as CalendarSharing })
          }
        >
          <option value="busy">When you&apos;re busy (never titles)</option>
          <option value="hidden">Nothing</option>
        </Select>
      </label>
      <label className="settings-field">
        Reminders
        <Select
          value={String(draft.reminder_minutes)}
          onChange={(e) =>
            onChange({
              ...draft,
              reminder_minutes:
                e.target.value === "null" ? null : Number(e.target.value),
            })
          }
        >
          {CALENDAR_REMINDER_CHOICES.map((m) => (
            <option key={String(m)} value={String(m)}>
              {reminderLabel(m)}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

/**
 * Calendars from other apps by their iCalendar link (webcal:// or https://):
 * add, change, show or hide, refresh now, see when they were last fetched,
 * or remove. Their events show on your calendar, read-only.
 */
export function CalendarSubscriptions({ report }: Props) {
  const { ask } = useConfirm();
  const [subs, setSubs] = useState<CalendarSubscription[] | null>(null);
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<SubDraft>(draftFor("other"));
  /** Once the kind is picked by hand, the name stops guessing it. */
  const [kindPicked, setKindPicked] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<SubDraft>(draft);
  const action = useAction(report);

  const load = () =>
    client.listCalendarSubscriptions().then(setSubs, (e) => {
      setSubs([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const replace = (next: CalendarSubscription) =>
    setSubs((list) => list?.map((s) => (s.id === next.id ? next : s)) ?? null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    void action
      .run(async () => {
        const made = await client.createCalendarSubscription({
          url: url.trim(),
          ...draft,
          name: draft.name.trim(),
        });
        await load();
        return made.last_error
          ? `Added, but it couldn't be read yet: ${made.last_error}`
          : `Added · ${plural(made.event_count, "event")}.`;
      })
      .then((ok) => {
        if (!ok) return;
        setUrl("");
        setDraft(draftFor("other"));
        setKindPicked(false);
      });
  };
  const save = (s: CalendarSubscription) =>
    void action
      .run(async () => {
        replace(
          await client.updateCalendarSubscription(s.id, {
            ...edit,
            name: edit.name.trim(),
          }),
        );
        return "Saved.";
      })
      .then((ok) => ok && setEditing(null));
  const toggleVisible = (s: CalendarSubscription) =>
    void action.run(async () => {
      replace(
        await client.updateCalendarSubscription(s.id, { visible: !s.visible }),
      );
      return s.visible
        ? `${s.name} is hidden. It still counts as busy.`
        : `${s.name} shows on your calendar.`;
    });
  const refresh = (s: CalendarSubscription) =>
    void action.run(async () => {
      const next = await client.refreshCalendarSubscription(s.id);
      replace(next);
      return next.last_error
        ? `Couldn't fetch it: ${next.last_error}`
        : `Refreshed · ${plural(next.event_count, "event")}.`;
    });
  const remove = async (s: CalendarSubscription) => {
    if (
      !(await ask({
        title: `Remove “${s.name}” and its events?`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      await client.deleteCalendarSubscription(s.id);
      await load();
      return "Removed.";
    });
  };

  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="subs-title"
    >
      <h2 id="subs-title">
        <CalendarPlus size={16} aria-hidden="true" /> Subscribed calendars
      </h2>
      <p className="muted">
        Add calendars from other apps by their link, like a timetable or public
        holidays; they refresh every hour and can&apos;t be changed here.
      </p>
      {subs === null ? (
        <p className="muted">Loading your calendars…</p>
      ) : subs.length === 0 ? (
        <p className="muted">No subscribed calendars yet.</p>
      ) : (
        <ul className="settings-list">
          {subs.map((s) =>
            editing === s.id ? (
              <li key={s.id} className="settings-subform">
                <SubscriptionFields
                  id={`sub-${s.id}`}
                  draft={edit}
                  onChange={setEdit}
                />
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={action.pending || !edit.name.trim()}
                    onClick={() => save(s)}
                  >
                    Save
                  </button>
                </div>
              </li>
            ) : (
              <li key={s.id} className={s.visible ? "" : "is-hidden"}>
                <i
                  className="list-dot"
                  style={{ background: s.color }}
                  aria-hidden="true"
                />
                <span className="settings-list-main">
                  <strong>{s.name}</strong>
                  <small>{summary(s)}</small>
                  <small>
                    {s.last_fetched_at
                      ? `Fetched ${timeAgo(s.last_fetched_at)} · ${plural(s.event_count, "event")}`
                      : "Not fetched yet"}
                  </small>
                  {s.last_error && (
                    <small className="field-hint" role="status">
                      Last fetch failed: {s.last_error}
                    </small>
                  )}
                  <small className="sub-url">{s.url}</small>
                </span>
                <button
                  className="icon-button"
                  aria-label={
                    s.visible
                      ? `Hide ${s.name} from your calendar`
                      : `Show ${s.name} on your calendar`
                  }
                  title={s.visible ? "Hide from calendar" : "Show on calendar"}
                  disabled={action.pending}
                  onClick={() => toggleVisible(s)}
                >
                  {s.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Refresh ${s.name} now`}
                  title="Refresh now"
                  disabled={action.pending}
                  onClick={() => refresh(s)}
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Edit ${s.name}`}
                  onClick={() => {
                    setEdit(draftOf(s));
                    setEditing(s.id);
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove ${s.name}`}
                  disabled={action.pending}
                  onClick={() => remove(s)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="settings-subform" onSubmit={add}>
        <h3 className="settings-subtitle">Add a calendar</h3>
        <div className="settings-grid">
          <div className="settings-field wide">
            <label htmlFor="sub-url">Calendar link</label>
            <input
              id="sub-url"
              required
              maxLength={1000}
              inputMode="url"
              spellCheck={false}
              placeholder="webcal://… or https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>
        <SubscriptionFields
          id="sub-new"
          draft={draft}
          onChange={(next) => {
            if (next.kind !== draft.kind) setKindPicked(true);
            // Until a kind is picked by hand, the name suggests one.
            if (!kindPicked && next.name !== draft.name) {
              const guess = guessCalendarKind(next.name);
              if (guess !== next.kind)
                return setDraft({
                  ...draftFor(guess, next.name, next.color),
                  visible: next.visible,
                });
            }
            setDraft(next);
          }}
        />
        <button
          className="primary"
          disabled={action.pending || !url.trim() || !draft.name.trim()}
        >
          <CalendarPlus size={14} />{" "}
          {action.pending ? "Adding and reading it…" : "Add calendar"}
        </button>
      </form>
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}

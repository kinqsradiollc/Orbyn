import { SettingsSection } from "./SettingsSection";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarPlus,
  CalendarSync,
  Copy,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { CalendarFeedSettings, CalendarSubscription } from "@orbyn/core";
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
        ? "Time blocks are in the feed now."
        : "Time blocks are left out of the feed.";
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
          <label className="switch-line settings-field">
            <input
              type="checkbox"
              role="switch"
              className="ai-switch"
              checked={settings.include_blocks}
              disabled={action.pending}
              onChange={(e) => includeBlocks(e.target.checked)}
            />
            <span>
              Include time blocks
              <small>Shown as “Focus: task name” in the full feed.</small>
            </span>
          </label>
        </>
      )}
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}

type SubDraft = { name: string; color: string; busy: boolean };

/**
 * Calendars from other apps by their iCalendar link (webcal:// or https://):
 * add, change, refresh now, see when they were last fetched, or remove.
 * Their events show on your calendar, read-only.
 */
export function CalendarSubscriptions({ report }: Props) {
  const { ask, tell } = useConfirm();
  const [subs, setSubs] = useState<CalendarSubscription[] | null>(null);
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<SubDraft>({
    name: "",
    color: SWATCHES[2],
    busy: false,
  });
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
        await client.createCalendarSubscription({
          url: url.trim(),
          name: draft.name.trim(),
          color: draft.color,
          busy: draft.busy,
        });
        await load();
        return "Added. Its events show on your calendar after the first fetch, in a minute or so.";
      })
      .then((ok) => {
        if (!ok) return;
        setUrl("");
        setDraft({ name: "", color: SWATCHES[2], busy: false });
      });
  };
  const save = (s: CalendarSubscription) =>
    void action
      .run(async () => {
        replace(
          await client.updateCalendarSubscription(s.id, {
            name: edit.name.trim(),
            color: edit.color,
            busy: edit.busy,
          }),
        );
        return "Saved.";
      })
      .then((ok) => ok && setEditing(null));
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
        Add a calendar from another app by its link: a timetable, public
        holidays, a work calendar. Orbyn checks it every hour. Its events show
        on your calendar and can&apos;t be changed here.
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
                <div className="settings-grid">
                  <div className="settings-field wide">
                    <label htmlFor={"sub-name-" + s.id}>Name</label>
                    <input
                      id={"sub-name-" + s.id}
                      required
                      maxLength={80}
                      value={edit.name}
                      onChange={(e) =>
                        setEdit({ ...edit, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="settings-field wide">
                    <span className="settings-label">Colour</span>
                    <Swatches
                      label="Calendar colour"
                      value={edit.color}
                      onChange={(color) => setEdit({ ...edit, color })}
                    />
                  </div>
                  <label className="switch-line settings-field">
                    <input
                      type="checkbox"
                      role="switch"
                      className="ai-switch"
                      checked={edit.busy}
                      onChange={(e) =>
                        setEdit({ ...edit, busy: e.target.checked })
                      }
                    />
                    <span>
                      Counts as busy
                      <small>
                        For the planner, booking pages and teammates.
                      </small>
                    </span>
                  </label>
                </div>
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
              <li key={s.id}>
                <i
                  className="list-dot"
                  style={{ background: s.color }}
                  aria-hidden="true"
                />
                <span className="settings-list-main">
                  <strong>{s.name}</strong>
                  <small>
                    {s.last_fetched_at
                      ? `Fetched ${timeAgo(s.last_fetched_at)} · ${plural(s.event_count, "event")}`
                      : "Not fetched yet"}
                    {s.busy ? " · Counts as busy" : ""}
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
                    setEdit({ name: s.name, color: s.color, busy: s.busy });
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
          <div className="settings-field wide">
            <label htmlFor="sub-name">Name</label>
            <input
              id="sub-name"
              required
              maxLength={80}
              placeholder="Public holidays"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="settings-field wide">
            <span className="settings-label">Colour</span>
            <Swatches
              label="Calendar colour"
              value={draft.color}
              onChange={(color) => setDraft({ ...draft, color })}
            />
          </div>
          <label className="switch-line settings-field">
            <input
              type="checkbox"
              role="switch"
              className="ai-switch"
              checked={draft.busy}
              onChange={(e) => setDraft({ ...draft, busy: e.target.checked })}
            />
            <span>
              Counts as busy
              <small>For the planner, booking pages and teammates.</small>
            </span>
          </label>
        </div>
        <button
          className="primary"
          disabled={action.pending || !url.trim() || !draft.name.trim()}
        >
          <CalendarPlus size={14} /> Add calendar
        </button>
      </form>
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}

import { SettingsSection } from "./SettingsSection";
import { useConfirm } from "../../components/Confirm";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarPlus,
  CalendarSync,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  RefreshCw,
  Trash2,
  MoreHorizontal,
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
import { SettingsEditor } from "./SettingsEditor";
import { Popover } from "../../components/Popover";
import { session as authSession } from "../../lib/session";

function useCalendarOwner() {
  const owner = useRef(authSession.get()).current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && authSession.get() === owner,
    [owner],
  );
}

type Props = { report: (e: unknown) => void };

/** A feed link just made: shown once, with a copy button. */
function LinkBox({ label, url }: { label: string; url: string }) {
  const currentOwner = useCalendarOwner();
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <div
      className="secret-box"
      data-settings-close-guard={
        !copied && !acknowledged
          ? "Save or acknowledge the new calendar link before leaving Settings."
          : undefined
      }
    >
      <strong>{label}</strong>
      <div className="secret-row">
        <code>{url}</code>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void copyText(url)
              .then((ok) => {
                if (!currentOwner()) return;
                setCopied(ok);
                setCopyFailed(!ok);
              })
              .catch(() => {
                if (currentOwner()) setCopyFailed(true);
              })
          }
        >
          <Copy size={13} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <small>Shown once. Keep this link private.</small>
      {copyFailed && (
        <small role="status">
          Copy failed. Select and copy the link manually.
        </small>
      )}
      {!copied && !acknowledged && (
        <button
          type="button"
          className="text-button"
          onClick={() => setAcknowledged(true)}
        >
          I’ve saved the link
        </button>
      )}
    </div>
  );
}

/**
 * Your calendar for other apps: the full link, a busy-only link that can be
 * shared without the details, and whether time blocks are included.
 */
export function CalendarFeedCard(props: Props) {
  return <FeedBody key={authSession.get()} {...props} />;
}

function FeedBody({ report }: Props) {
  const currentOwner = useCalendarOwner();
  const read = useRef(0);
  const { ask } = useConfirm();
  const [settings, setSettings] = useState<CalendarFeedSettings | null>(null);
  const [links, setLinks] = useState<{ full?: string; busy?: string }>({});
  const action = useAction(report);
  const [readFailed, setReadFailed] = useState(false);

  const load = useCallback(async () => {
    const revision = ++read.current;
    setReadFailed(false);
    try {
      const next = await client.calendarFeedSettings();
      if (currentOwner() && revision === read.current) setSettings(next);
    } catch (e) {
      if (currentOwner() && revision === read.current) {
        setReadFailed(true);
        report(e);
      }
    }
  }, [currentOwner, report]);
  useEffect(() => {
    void load();
  }, [load]);

  const make = (busy: boolean) =>
    void action.run(async () => {
      const had = busy ? settings?.busy_enabled : settings?.enabled;
      if (
        had &&
        !(await ask({
          title: "Replace calendar link?",
          body: "The old link will stop working. Subscribed apps will need the new link.",
          confirmLabel: "Replace link",
        }))
      )
        return;
      if (!currentOwner()) return;
      read.current++;
      const feed = await client.createCalendarFeed({ busy });
      if (!currentOwner()) return;
      read.current++;
      setLinks((l) => ({ ...l, [busy ? "busy" : "full"]: feed.url }));
      setSettings(
        (s) => s && { ...s, [busy ? "busy_enabled" : "enabled"]: true },
      );
      return had
        ? "Made a new link. The old one no longer works."
        : "Your link is ready.";
    });
  const turnOff = (busy: boolean) =>
    void action.run(async () => {
      if (
        !(await ask({
          title: "Turn off calendar link?",
          body: busy
            ? "People using this busy-only link will stop receiving updates."
            : "Subscribed apps will stop receiving calendar updates.",
          confirmLabel: "Turn off",
          destructive: true,
        }))
      )
        return;
      if (!currentOwner()) return;
      read.current++;
      await client.deleteCalendarFeed({ busy });
      if (!currentOwner()) return;
      read.current++;
      setLinks((l) => ({ ...l, [busy ? "busy" : "full"]: undefined }));
      setSettings(
        (s) => s && { ...s, [busy ? "busy_enabled" : "enabled"]: false },
      );
      return "That link is off and no longer works.";
    });
  const includeBlocks = (on: boolean) =>
    void action.run(async () => {
      read.current++;
      const next = await client.updateCalendarFeedSettings({
        include_blocks: on,
      });
      if (!currentOwner()) return;
      read.current++;
      setSettings(next);
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
            ? "Shares busy times without titles or details."
            : "Anyone with this link can see your full calendar."}
        </p>
        {url && (
          <LinkBox
            key={url}
            label={busy ? "Busy-only link" : "Private link"}
            url={url}
          />
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
    <SettingsSection className="card settings-card">
      <h2>
        <CalendarSync size={16} aria-hidden="true" /> Calendar feed
      </h2>
      <details>
        <summary>Use a feed link</summary>
        <p className="muted">
          Paste the link into your calendar app’s Subscribe or From URL option.
        </p>
      </details>
      {readFailed && (
        <div role="status">
          <span>Couldn’t load feed settings. </span>
          <button
            className="text-button"
            disabled={action.pending}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}
      {!settings && !readFailed ? (
        <p className="muted">Loading your feed settings…</p>
      ) : (
        settings && (
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
                  Sessions appear with task names and deadlines in the full
                  feed.
                </small>
              </span>
            </label>
          </>
        )
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

/** The connection's purpose, availability and sharing at a glance. */
function summary(s: CalendarSubscription) {
  return [
    CALENDAR_KIND_DEFAULTS[s.kind].label,
    s.busy ? (s.all_day_busy ? "Busy, including all-day" : "Busy") : "Not busy",
    s.sharing === "hidden" ? "Private" : "Busy times shared",
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
  disabled = false,
}: {
  id: string;
  draft: SubDraft;
  onChange: (next: SubDraft) => void;
  disabled?: boolean;
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
              disabled={disabled}
              tabIndex={draft.kind === k ? 0 : -1}
              onKeyDown={(event) => {
                const index = CALENDAR_KINDS.indexOf(k);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? CALENDAR_KINDS.length - 1
                      : ["ArrowRight", "ArrowDown"].includes(event.key)
                        ? (index + 1) % CALENDAR_KINDS.length
                        : ["ArrowLeft", "ArrowUp"].includes(event.key)
                          ? (index + CALENDAR_KINDS.length - 1) %
                            CALENDAR_KINDS.length
                          : -1;
                if (disabled || next < 0) return;
                event.preventDefault();
                onChange({
                  ...draftFor(CALENDAR_KINDS[next], draft.name, draft.color),
                  visible: draft.visible,
                });
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>("button")
                  [next]?.focus();
              }}
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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, busy: e.target.checked })}
        />
        <span>
          Counts as busy
          <small>Planning avoids these times.</small>
        </span>
      </label>
      <label className="switch-line settings-field">
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          checked={draft.all_day_busy}
          disabled={disabled || !draft.busy}
          onChange={(e) =>
            onChange({ ...draft, all_day_busy: e.target.checked })
          }
        />
        <span>
          All-day events block the day
          <small>Includes all-day events in your availability.</small>
        </span>
      </label>
      <label className="switch-line settings-field">
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          checked={draft.visible}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, visible: e.target.checked })}
        />
        <span>
          Show on my calendar
          <small>Visibility doesn’t change availability.</small>
        </span>
      </label>
      <label className="settings-field">
        Teammates see
        <Select
          disabled={disabled}
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
          disabled={disabled}
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
export function CalendarSubscriptions(props: Props) {
  return <SubscriptionsBody key={authSession.get()} {...props} />;
}

function SubscriptionsBody({ report }: Props) {
  const { ask } = useConfirm();
  const currentOwner = useCalendarOwner();
  const id = useId();
  const read = useRef(0);
  const [subs, setSubs] = useState<CalendarSubscription[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<SubDraft>(draftFor("other"));
  const [kindPicked, setKindPicked] = useState(false);
  const [editor, setEditor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(
    null,
  );
  const action = useAction(report);
  const selected = subs?.find((sub) => sub.id === editor);
  const managed = subs?.find((sub) => sub.id === menu?.id);
  const shown = (subs ?? []).filter((sub) =>
    `${sub.name} ${CALENDAR_KIND_DEFAULTS[sub.kind].label}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const load = useCallback(async () => {
    if (!currentOwner()) return false;
    const revision = ++read.current;
    setReadFailed(false);
    try {
      const next = await client.listCalendarSubscriptions();
      if (!currentOwner() || revision !== read.current) return false;
      setSubs(next);
      return true;
    } catch (e) {
      if (currentOwner() && revision === read.current) {
        setReadFailed(true);
        report(e);
      }
      return false;
    }
  }, [currentOwner, report]);
  useEffect(() => {
    void load();
  }, [load]);
  const replace = (next: CalendarSubscription) => {
    if (!currentOwner()) return;
    read.current++;
    setSubs(
      (list) => list?.map((sub) => (sub.id === next.id ? next : sub)) ?? null,
    );
  };
  const closeEditor = () => {
    if (!action.pending) setEditor(null);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      read.current++;
      if (editor === "new") {
        const made = await client.createCalendarSubscription({
          url: url.trim(),
          ...draft,
          name: draft.name.trim(),
        });
        if (!currentOwner()) return;
        setSubs((list) => [...(list ?? []), made]);
        setEditor(null);
        setUrl("");
        setDraft(draftFor("other"));
        setKindPicked(false);
        const refreshed = await load();
        return made.last_error
          ? "Calendar added. Its first refresh failed."
          : refreshed
            ? "Calendar added."
            : "Calendar added. List refresh failed.";
      }
      if (!selected) throw new Error("Calendar unavailable. Reload the list.");
      const saved = await client.updateCalendarSubscription(selected.id, {
        ...draft,
        name: draft.name.trim(),
      });
      if (!currentOwner()) return;
      replace(saved);
      setEditor(null);
      return "Calendar saved.";
    });
  };
  const toggleVisible = (sub: CalendarSubscription) =>
    void action.run(async () => {
      replace(
        await client.updateCalendarSubscription(sub.id, {
          visible: !sub.visible,
        }),
      );
      return sub.visible ? "Calendar hidden." : "Calendar shown.";
    });
  const refresh = (sub: CalendarSubscription) =>
    void action.run(async () => {
      const next = await client.refreshCalendarSubscription(sub.id);
      replace(next);
      if (next.last_error)
        throw new Error(
          "Calendar refresh failed. Check the source link and try again.",
        );
      return `Refreshed · ${plural(next.event_count, "event")}.`;
    });
  const remove = (sub: CalendarSubscription) =>
    void action.run(async () => {
      setMenu(null);
      if (
        !(await ask({
          title: "Remove calendar?",
          body: `${sub.name}. Its subscribed events will be removed from Orbyn.`,
          confirmLabel: "Remove",
          destructive: true,
        }))
      )
        return;
      if (!currentOwner()) return;
      await client.deleteCalendarSubscription(sub.id);
      if (!currentOwner()) return;
      read.current++;
      setSubs((list) => list?.filter((value) => value.id !== sub.id) ?? null);
      return "Calendar removed.";
    });
  const openEditor = (sub?: CalendarSubscription) => {
    if (action.pending) return;
    setMenu(null);
    action.setOutcome(null);
    setDraft(sub ? draftOf(sub) : draftFor("other"));
    setKindPicked(!!sub);
    setUrl("");
    setEditor(sub?.id ?? "new");
  };
  return (
    <SettingsSection className="card settings-card">
      <h2>
        <CalendarPlus size={16} aria-hidden="true" /> Subscribed calendars
      </h2>
      <div className="settings-head">
        <span className="muted">Read-only · refreshes hourly</span>
        <button
          className="secondary"
          disabled={action.pending}
          onClick={() => openEditor()}
        >
          <CalendarPlus size={14} /> Add calendar
        </button>
      </div>
      {!editor && <OutcomeNote outcome={action.outcome} />}
      {readFailed && (
        <div role="status">
          <span>Couldn’t load calendars. </span>
          <button className="text-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {(subs?.length ?? 0) > 4 && (
        <label className="settings-field">
          Find a calendar
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      {subs === null ? (
        !readFailed && <p role="status">Loading calendars…</p>
      ) : !subs.length ? (
        <p className="muted">No subscribed calendars.</p>
      ) : (
        <ul className="settings-list calendar-subscriptions">
          {shown.map((sub) => (
            <li key={sub.id} className={sub.visible ? "" : "is-hidden"}>
              <i
                className="list-dot"
                style={{ background: sub.color }}
                aria-hidden="true"
              />
              <span className="settings-list-main">
                <strong>{sub.name}</strong>
                <small>{summary(sub)}</small>
                <details>
                  <summary>Calendar details</summary>
                  <small>
                    {sub.last_fetched_at
                      ? `Fetched ${timeAgo(sub.last_fetched_at)} · ${plural(sub.event_count, "event")}`
                      : "Not fetched yet"}
                  </small>
                  {sub.last_error && (
                    <small role="status">Last refresh failed.</small>
                  )}
                  <small className="sub-url">{sub.url}</small>
                </details>
              </span>
              <button
                className="icon-button"
                disabled={action.pending}
                aria-label={`${sub.visible ? "Hide" : "Show"} ${sub.name}`}
                onClick={() => toggleVisible(sub)}
              >
                {sub.visible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                className="icon-button"
                disabled={action.pending}
                aria-label={`Manage ${sub.name}`}
                aria-haspopup="dialog"
                aria-expanded={menu?.id === sub.id}
                onClick={(event) =>
                  setMenu({
                    id: sub.id,
                    anchor: event.currentTarget.getBoundingClientRect(),
                  })
                }
              >
                <MoreHorizontal size={16} />
              </button>
            </li>
          ))}
          {!shown.length && <li>No matching calendars.</li>}
        </ul>
      )}
      {menu && managed && (
        <Popover
          anchor={menu.anchor}
          label={`Manage ${managed.name}`}
          onClose={() => setMenu(null)}
          width={240}
        >
          <button disabled={action.pending} onClick={() => openEditor(managed)}>
            <Pencil size={14} /> Edit calendar
          </button>
          <button
            disabled={action.pending}
            onClick={() => {
              setMenu(null);
              refresh(managed);
            }}
          >
            <RefreshCw size={14} /> Refresh now
          </button>
          <button disabled={action.pending} onClick={() => remove(managed)}>
            <Trash2 size={14} /> Remove calendar
          </button>
        </Popover>
      )}
      {editor && (
        <SettingsEditor
          title={editor === "new" ? "Add calendar" : "Edit calendar"}
          pending={action.pending}
          onClose={closeEditor}
        >
          <form onSubmit={save} className="settings-subform">
            {editor === "new" && (
              <label className="settings-field">
                Calendar link
                <input
                  required
                  disabled={action.pending}
                  maxLength={1000}
                  inputMode="url"
                  spellCheck={false}
                  placeholder="webcal://… or https://…"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
            )}
            <SubscriptionFields
              id={id}
              draft={draft}
              disabled={action.pending}
              onChange={(next) => {
                if (next.kind !== draft.kind) setKindPicked(true);
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
            <OutcomeNote outcome={action.outcome} />
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={action.pending}
                onClick={closeEditor}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  action.pending ||
                  !draft.name.trim() ||
                  (editor === "new" && !url.trim())
                }
              >
                {action.pending
                  ? "Saving…"
                  : editor === "new"
                    ? "Add calendar"
                    : "Save"}
              </button>
            </div>
          </form>
        </SettingsEditor>
      )}
    </SettingsSection>
  );
}

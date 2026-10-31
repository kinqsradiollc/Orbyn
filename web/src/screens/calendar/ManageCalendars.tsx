import {
  CALENDAR_KIND_DEFAULTS,
  CALENDAR_KINDS,
  CALENDAR_REMINDER_CHOICES,
  guessCalendarKind,
  reminderLabel,
  type CalendarKind,
  type CalendarSharing,
  type CalendarSubscription,
} from "@orbyn/core";
import {
  Copy,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  Menu,
  Pill,
  SelectBox,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { SWATCHES, timeAgo } from "../shared-task/format";
import { plural } from "./model";

type Draft = {
  name: string;
  color: string;
  kind: CalendarKind;
  busy: boolean;
  all_day_busy: boolean;
  visible: boolean;
  sharing: CalendarSharing;
  reminder_minutes: number | null;
};

const draftFor = (
  kind: CalendarKind,
  name = "",
  color: string = SWATCHES[2],
): Draft => {
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
  };
};

const draftOf = (s: CalendarSubscription): Draft => ({
  name: s.name,
  color: s.color,
  kind: s.kind,
  busy: s.busy,
  all_day_busy: s.all_day_busy,
  visible: s.visible,
  sharing: s.sharing,
  reminder_minutes: s.reminder_minutes,
});

const summary = (s: CalendarSubscription) =>
  [
    CALENDAR_KIND_DEFAULTS[s.kind].label,
    s.busy ? (s.all_day_busy ? "Busy, including all-day" : "Busy") : "Not busy",
    s.sharing === "hidden" ? "Private" : "Busy times shared",
    s.visible ? "" : "Hidden from calendar",
  ]
    .filter(Boolean)
    .join(" · ");

/** Calendars from other apps by their link: read-only, refreshed hourly. */
export function SubscriptionsPanel({ onChanged }: { onChanged: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const subs = useResource(() => client.listCalendarSubscriptions(), []);
  const [editor, setEditor] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<Draft>(draftFor("other"));
  const [kindPicked, setKindPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const list = subs.data ?? [];
  const selected = list.find((s) => s.id === editor);
  const shown = list.filter((s) =>
    `${s.name} ${CALENDAR_KIND_DEFAULTS[s.kind].label}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const replace = (next: CalendarSubscription) =>
    subs.set((all) => all?.map((s) => (s.id === next.id ? next : s)));

  const act = async (work: () => Promise<string | undefined>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const text = await work();
      if (text) toast({ text });
      onChanged();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't change that calendar."));
    } finally {
      setBusy(false);
    }
  };

  const open = (sub?: CalendarSubscription) => {
    setError("");
    setDraft(sub ? draftOf(sub) : draftFor("other"));
    setKindPicked(!!sub);
    setUrl("");
    setEditor(sub?.id ?? "new");
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      if (editor === "new") {
        const made = await client.createCalendarSubscription({
          url: url.trim(),
          ...draft,
          name: draft.name.trim(),
        });
        setEditor(null);
        await subs.reload();
        return made.last_error
          ? "Calendar added. Its first refresh failed."
          : "Calendar added.";
      }
      if (!selected) throw new Error("That calendar is gone. Reload the list.");
      replace(
        await client.updateCalendarSubscription(selected.id, {
          ...draft,
          name: draft.name.trim(),
        }),
      );
      setEditor(null);
      return "Calendar saved.";
    });
  };
  const change = (next: Draft) => {
    if (next.kind !== draft.kind) setKindPicked(true);
    if (!kindPicked && next.name !== draft.name) {
      const guess = guessCalendarKind(next.name);
      if (guess !== next.kind) {
        setDraft({
          ...draftFor(guess, next.name, next.color),
          visible: next.visible,
        });
        return;
      }
    }
    setDraft(next);
  };

  if (editor)
    return (
      <form className="calendar-form" onSubmit={save} aria-busy={busy}>
        <h3>{editor === "new" ? "Add calendar" : "Edit calendar"}</h3>
        {editor === "new" && (
          <Field label="Calendar link">
            <Input
              required
              maxLength={1000}
              inputMode="url"
              spellCheck={false}
              placeholder="webcal://… or https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
        )}
        <Field
          label="What's in it"
          hint={CALENDAR_KIND_DEFAULTS[draft.kind].hint}
        >
          <SelectBox
            value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as CalendarKind;
              change({
                ...draftFor(kind, draft.name, draft.color),
                visible: draft.visible,
              });
            }}
          >
            {CALENDAR_KINDS.map((k) => (
              <option key={k} value={k}>
                {CALENDAR_KIND_DEFAULTS[k].label}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Name">
          <Input
            required
            dir="auto"
            maxLength={80}
            placeholder="Uni timetable"
            value={draft.name}
            onChange={(e) => change({ ...draft, name: e.target.value })}
          />
        </Field>
        <fieldset className="calendar-fieldset">
          <legend>Colour</legend>
          <div
            className="calendar-swatches"
            role="radiogroup"
            aria-label="Calendar colour"
          >
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={draft.color.toLowerCase() === c}
                aria-label={c}
                style={{ background: c }}
                onClick={() => setDraft({ ...draft, color: c })}
              />
            ))}
          </div>
        </fieldset>
        <div className="calendar-checks">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.busy}
              onChange={(e) => setDraft({ ...draft, busy: e.target.checked })}
            />
            Counts as busy, so planning avoids these times
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.all_day_busy}
              disabled={!draft.busy}
              onChange={(e) =>
                setDraft({ ...draft, all_day_busy: e.target.checked })
              }
            />
            All-day events block the day
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.visible}
              onChange={(e) =>
                setDraft({ ...draft, visible: e.target.checked })
              }
            />
            Show on my calendar
          </label>
        </div>
        <div className="calendar-form-grid">
          <Field label="Teammates see">
            <SelectBox
              value={draft.sharing}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  sharing: e.target.value as CalendarSharing,
                })
              }
            >
              <option value="busy">When you're busy, never titles</option>
              <option value="hidden">Nothing</option>
            </SelectBox>
          </Field>
          <Field label="Reminders">
            <SelectBox
              value={String(draft.reminder_minutes)}
              onChange={(e) =>
                setDraft({
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
            </SelectBox>
          </Field>
        </div>
        {error && <ErrorNotice message={error} />}
        <div className="dialog-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setEditor(null)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={!draft.name.trim() || (editor === "new" && !url.trim())}
          >
            {busy ? "Saving" : editor === "new" ? "Add calendar" : "Save"}
          </Button>
        </div>
      </form>
    );

  return (
    <div className="calendar-form">
      <div className="calendar-side-head">
        <span className="small muted">Read-only · refreshes hourly</span>
        <Button onClick={() => open()}>
          <Plus aria-hidden="true" /> Add calendar
        </Button>
      </div>
      {error && <ErrorNotice message={error} />}
      {subs.error && !subs.data && (
        <ErrorNotice message={subs.error} onRetry={() => void subs.reload()} />
      )}
      {subs.loading && !subs.data && <Loading label="Loading calendars" />}
      {list.length > 4 && (
        <Input
          type="search"
          aria-label="Find a calendar"
          placeholder="Find a calendar"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {subs.data && !list.length && <Empty title="No subscribed calendars" />}
      <div className="rows">
        {shown.map((sub) => (
          <div
            key={sub.id}
            className={`calendar-person${sub.visible ? "" : " is-hidden"}`}
          >
            <i
              className="calendar-dot"
              style={{ background: sub.color }}
              aria-hidden="true"
            />
            <span className="row-main">
              <span className="row-title" dir="auto">
                {sub.name}
              </span>
              <small className="muted">
                {summary(sub)}
                {" · "}
                {sub.last_fetched_at
                  ? `Fetched ${timeAgo(sub.last_fetched_at)} · ${plural(sub.event_count, "event")}`
                  : "Not fetched yet"}
              </small>
              {sub.last_error && (
                <small className="field-error">Last refresh failed.</small>
              )}
              <small className="muted calendar-url">{sub.url}</small>
            </span>
            <IconButton
              label={`${sub.visible ? "Hide" : "Show"} ${sub.name}`}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  replace(
                    await client.updateCalendarSubscription(sub.id, {
                      visible: !sub.visible,
                    }),
                  );
                  return sub.visible ? "Calendar hidden." : "Calendar shown.";
                })
              }
            >
              {sub.visible ? <Eye /> : <EyeOff />}
            </IconButton>
            <Menu
              label={`Manage ${sub.name}`}
              trigger={(show, expanded) => (
                <IconButton
                  label={`Manage ${sub.name}`}
                  aria-expanded={expanded}
                  disabled={busy}
                  onClick={show}
                >
                  <MoreHorizontal />
                </IconButton>
              )}
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      open(sub);
                    }}
                  >
                    <Pencil aria-hidden="true" /> Edit calendar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      void act(async () => {
                        const next = await client.refreshCalendarSubscription(
                          sub.id,
                        );
                        replace(next);
                        if (next.last_error)
                          throw new Error(
                            "Refresh failed. Check the source link and try again.",
                          );
                        return `Refreshed · ${plural(next.event_count, "event")}.`;
                      });
                    }}
                  >
                    <RefreshCw aria-hidden="true" /> Refresh now
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => {
                      close();
                      void act(async () => {
                        const yes = await confirm({
                          title: "Remove calendar?",
                          body: `${sub.name}. Its events will be removed from Orbyn.`,
                          action: "Remove",
                          danger: true,
                        });
                        if (!yes) return undefined;
                        await client.deleteCalendarSubscription(sub.id);
                        subs.set((all) => all?.filter((s) => s.id !== sub.id));
                        return "Calendar removed.";
                      });
                    }}
                  >
                    <Trash2 aria-hidden="true" /> Remove calendar
                  </button>
                </>
              )}
            </Menu>
          </div>
        ))}
      </div>
    </div>
  );
}

function LinkBox({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="calendar-secret">
      <b>{label}</b>
      <code>{url}</code>
      <div className="calendar-side-head">
        <small className="muted">Shown once. Keep this link private.</small>
        <Button
          onClick={() =>
            void navigator.clipboard.writeText(url).then(
              () => {
                setCopied(true);
                setFailed(false);
              },
              () => setFailed(true),
            )
          }
        >
          <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {failed && (
        <small role="status" className="field-error">
          Copy failed. Select the link and copy it by hand.
        </small>
      )}
    </div>
  );
}

/** Your calendar for other apps: a full link, a busy-only link, and sessions. */
export function FeedPanel() {
  const confirm = useConfirm();
  const settings = useResource(() => client.calendarFeedSettings(), []);
  const [links, setLinks] = useState<{ full?: string; busy?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = settings.data;

  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't change that link."));
    } finally {
      setBusy(false);
    }
  };
  const make = (forBusy: boolean) =>
    void act(async () => {
      const had = forBusy ? s?.busy_enabled : s?.enabled;
      if (
        had &&
        !(await confirm({
          title: "Replace calendar link?",
          body: "The old link stops working. Subscribed apps need the new link.",
          action: "Replace link",
        }))
      )
        return;
      const feed = await client.createCalendarFeed({ busy: forBusy });
      setLinks((l) => ({ ...l, [forBusy ? "busy" : "full"]: feed.url }));
      settings.set(
        (v) => v && { ...v, [forBusy ? "busy_enabled" : "enabled"]: true },
      );
    });
  const turnOff = (forBusy: boolean) =>
    void act(async () => {
      if (
        !(await confirm({
          title: "Turn off calendar link?",
          body: forBusy
            ? "People using this busy-only link stop receiving updates."
            : "Subscribed apps stop receiving calendar updates.",
          action: "Turn off",
          danger: true,
        }))
      )
        return;
      await client.deleteCalendarFeed({ busy: forBusy });
      setLinks((l) => ({ ...l, [forBusy ? "busy" : "full"]: undefined }));
      settings.set(
        (v) => v && { ...v, [forBusy ? "busy_enabled" : "enabled"]: false },
      );
    });
  const section = (forBusy: boolean) => {
    const on = forBusy ? s?.busy_enabled : s?.enabled;
    const url = forBusy ? links.busy : links.full;
    return (
      <div className="calendar-feed">
        <div className="calendar-side-head">
          <h3>
            {forBusy ? "Busy-only link" : "Full calendar link"}{" "}
            <Pill tone={on ? "green" : undefined}>{on ? "On" : "Off"}</Pill>
          </h3>
          <div className="calendar-answers">
            {on && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => turnOff(forBusy)}
              >
                Turn off
              </Button>
            )}
            <Button disabled={busy} onClick={() => make(forBusy)}>
              {on ? "Regenerate" : "Create link"}
            </Button>
          </div>
        </div>
        <p className="small muted">
          {forBusy
            ? "Shares busy times without titles or details."
            : "Anyone with this link can see your full calendar."}
        </p>
        {url && (
          <LinkBox
            key={url}
            label={forBusy ? "Busy-only link" : "Private link"}
            url={url}
          />
        )}
      </div>
    );
  };

  if (settings.error && !s)
    return (
      <ErrorNotice
        message="Couldn't load feed settings."
        onRetry={() => void settings.reload()}
      />
    );
  if (!s) return <Loading label="Loading feed settings" />;
  return (
    <div className="calendar-form" aria-busy={busy}>
      <p className="small muted">
        Paste a link into your calendar app's Subscribe or From URL option.
      </p>
      {section(false)}
      {section(true)}
      <label className="check">
        <input
          type="checkbox"
          checked={s.include_blocks}
          disabled={busy}
          onChange={(e) => {
            const on = e.target.checked;
            void act(async () => {
              const next = await client.updateCalendarFeedSettings({
                include_blocks: on,
              });
              settings.set(() => next);
            });
          }}
        />
        Include sessions in the full feed, with task names and deadlines
      </label>
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

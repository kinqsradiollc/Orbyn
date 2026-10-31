import {
  type CalendarSet,
  type CalendarSubscription,
  type TaskList,
  type Team,
} from "@orbyn/core";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Segmented,
} from "../../ui/kit";
import { FeedPanel, SubscriptionsPanel } from "./ManageCalendars";
import { FramesPanel, HabitsPanel } from "./ManageRoutines";
import type { Workspace } from "./useWorkspace";

export type ManageTab = "sets" | "subscribed" | "feeds" | "frames" | "habits";

/**
 * Everything behind the calendar in one place: what each set shows, calendars
 * coming in, links going out, and the frames and habits planning works with.
 */
export function ManageDialog({
  tab,
  frameId,
  workspace,
  activeSet,
  onActiveSetGone,
  onClose,
  onChanged,
}: {
  tab: ManageTab;
  frameId?: string;
  workspace: Workspace;
  activeSet: string;
  onActiveSetGone: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState<ManageTab>(tab);
  return (
    <Dialog wide title="Manage calendar" onClose={onClose}>
      <div className="calendar-tabs">
        <Segmented
          label="What to manage"
          value={current}
          options={[
            { value: "sets", label: "Sets" },
            { value: "subscribed", label: "Subscribed" },
            { value: "feeds", label: "Feeds" },
            { value: "frames", label: "Frames" },
            { value: "habits", label: "Habits" },
          ]}
          onChange={setCurrent}
        />
      </div>
      {current === "sets" && (
        <SetsPanel
          sets={workspace.prefs?.calendar_sets ?? []}
          teams={workspace.teams}
          lists={workspace.lists}
          onSave={async (next) => {
            await workspace.savePrefs({ calendar_sets: next });
            if (activeSet && !next.some((s) => s.id === activeSet))
              onActiveSetGone();
          }}
        />
      )}
      {current === "subscribed" && <SubscriptionsPanel onChanged={onChanged} />}
      {current === "feeds" && <FeedPanel />}
      {current === "frames" && (
        <FramesPanel
          workspace={workspace}
          startId={frameId}
          onChanged={onChanged}
        />
      )}
      {current === "habits" && <HabitsPanel onChanged={onChanged} />}
    </Dialog>
  );
}

const newSet = (n: number): CalendarSet => ({
  id: `set-${Date.now().toString(36)}-${n}`,
  name: n === 0 ? "Work" : `Set ${n + 1}`,
  personal: true,
  team_ids: [],
  list_ids: [],
  subscription_ids: [],
});

const flip = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** Named views of what the calendar shows. Keys 1 to 9 switch; 0 shows all. */
function SetsPanel({
  sets,
  teams,
  lists,
  onSave,
}: {
  sets: CalendarSet[];
  teams: Team[];
  lists: TaskList[];
  onSave: (next: CalendarSet[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CalendarSet[]>(() =>
    sets.length ? sets : [newSet(0)],
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const subs = useResource(() => client.listCalendarSubscriptions(), []);
  const subList: CalendarSubscription[] = subs.data ?? [];
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  /** A set from before subscriptions could be picked shows all of them. */
  const subsOf = (s: CalendarSet) =>
    s.subscription_ids ?? subList.map((x) => x.id);
  const update = (id: string, patch: Partial<CalendarSet>) => {
    setSaved(false);
    setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const save = async () => {
    if (draft.some((s) => !s.name.trim())) {
      setError("Give every set a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(draft.map((s) => ({ ...s, name: s.name.trim() })));
      setSaved(true);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save your sets."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="calendar-form">
      <p className="small muted">
        Keys 1 to 9 switch sets; 0 shows everything.
      </p>
      {subs.error && (
        <ErrorNotice message={subs.error} onRetry={() => void subs.reload()} />
      )}
      <Input
        type="search"
        aria-label="Find calendars"
        placeholder="Find calendars"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {draft.map((s, n) => (
        <details
          key={s.id}
          className="calendar-more-section"
          open={draft.length === 1 || undefined}
        >
          <summary>
            {n + 1}. {s.name || "Unnamed set"}
          </summary>
          <fieldset className="calendar-set" disabled={busy}>
            <div className="calendar-person">
              <Field label="Name">
                <Input
                  dir="auto"
                  maxLength={40}
                  value={s.name}
                  onChange={(e) => update(s.id, { name: e.target.value })}
                />
              </Field>
              <IconButton
                label={`Delete ${s.name || "set"}`}
                onClick={() => setDraft((d) => d.filter((x) => x.id !== s.id))}
              >
                <Trash2 />
              </IconButton>
            </div>
            <div className="calendar-checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.personal}
                  onChange={(e) => update(s.id, { personal: e.target.checked })}
                />
                Personal items
              </label>
              {teams
                .filter((t) => matches(t.name))
                .map((t) => (
                  <label key={t.id} className="check">
                    <input
                      type="checkbox"
                      checked={s.team_ids.includes(t.id)}
                      onChange={() =>
                        update(s.id, { team_ids: flip(s.team_ids, t.id) })
                      }
                    />
                    <span dir="auto">{t.name}</span>
                  </label>
                ))}
              {lists.length > 0 && (
                <small className="muted">
                  Lists ·{" "}
                  {s.list_ids.length ? `${s.list_ids.length} picked` : "all"}
                </small>
              )}
              {lists
                .filter((l) => matches(`${l.name} ${l.team_name ?? ""}`))
                .map((l) => (
                  <label key={l.id} className="check">
                    <input
                      type="checkbox"
                      checked={s.list_ids.includes(l.id)}
                      onChange={() =>
                        update(s.id, { list_ids: flip(s.list_ids, l.id) })
                      }
                    />
                    <i
                      className="calendar-dot"
                      style={{ background: l.color }}
                      aria-hidden="true"
                    />
                    <span dir="auto">
                      {l.team_name ? `${l.name} · ${l.team_name}` : l.name}
                    </span>
                  </label>
                ))}
              {subList.length > 0 && (
                <small className="muted">
                  Subscribed · {subsOf(s).length} picked
                </small>
              )}
              {subList
                .filter((c) => matches(c.name))
                .map((c) => (
                  <label key={c.id} className="check">
                    <input
                      type="checkbox"
                      checked={subsOf(s).includes(c.id)}
                      onChange={() =>
                        update(s.id, {
                          subscription_ids: flip(subsOf(s), c.id),
                        })
                      }
                    />
                    <i
                      className="calendar-dot"
                      style={{ background: c.color }}
                      aria-hidden="true"
                    />
                    <span dir="auto">{c.name}</span>
                  </label>
                ))}
            </div>
          </fieldset>
        </details>
      ))}
      {error && <ErrorNotice message={error} />}
      <div className="dialog-actions">
        {draft.length < 9 && (
          <Button
            className="calendar-push"
            disabled={busy}
            onClick={() => setDraft((d) => [...d, newSet(d.length)])}
          >
            <Plus aria-hidden="true" /> Add a set
          </Button>
        )}
        {saved && (
          <span className="small muted" role="status">
            Saved
          </span>
        )}
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          {busy ? "Saving" : "Save sets"}
        </Button>
      </div>
    </div>
  );
}

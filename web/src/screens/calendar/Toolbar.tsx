import type { CalendarSet } from "@orbyn/core";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  PanelRight,
  Pin,
  Users,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Menu, Segmented, SelectBox } from "../../ui/kit";
import { Popover } from "./Details";
import { MODES, type Mode } from "./model";
import type { ManageTab } from "./ManageDialog";
import { MAX_MATES, type Teammates } from "./useWorkspace";

const UNIT: Record<Mode, string> = {
  stage: "week",
  month: "month",
  week: "week",
  day: "day",
  agenda: "two weeks",
};

/** One toolbar and one date navigator for every mode. */
export function Toolbar({
  mode,
  title,
  onToday,
  isToday,
  onStep,
  onMode,
  sets,
  setId,
  onSet,
  showMates,
  mates,
  planOpen,
  onPlan,
  onNewEvent,
  onManage,
  sideOpen,
  onSide,
}: {
  mode: Mode;
  title: string;
  onToday: () => void;
  isToday: boolean;
  onStep: (by: -1 | 1) => void;
  onMode: (mode: Mode) => void;
  sets: CalendarSet[];
  setId: string;
  onSet: (id: string) => void;
  showMates: boolean;
  mates: Teammates;
  planOpen: boolean;
  onPlan: () => void;
  onNewEvent: () => void;
  onManage: (tab: ManageTab) => void;
  sideOpen: boolean;
  onSide: () => void;
}) {
  const [matesAt, setMatesAt] = useState<DOMRect | null>(null);
  const unit = UNIT[mode];
  return (
    <header className="calendar-toolbar">
      <div className="calendar-nav">
        <IconButton
          label={`Previous ${unit}`}
          aria-keyshortcuts="ArrowLeft"
          onClick={() => onStep(-1)}
        >
          <ChevronLeft />
        </IconButton>
        <Button
          variant="ghost"
          title="Jump to today (T)"
          aria-keyshortcuts="T"
          disabled={isToday}
          onClick={onToday}
        >
          Today
        </Button>
        <IconButton
          label={`Next ${unit}`}
          aria-keyshortcuts="ArrowRight"
          onClick={() => onStep(1)}
        >
          <ChevronRight />
        </IconButton>
        <h1 aria-live="polite">{title}</h1>
      </div>
      <div className="calendar-tools">
        {sets.length > 0 && (
          <div className="calendar-set-pick">
            <SelectBox
              aria-label="Calendar set"
              title="Calendar set (number keys)"
              value={setId}
              onChange={(e) => onSet(e.target.value)}
            >
              <option value="">Everything</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectBox>
          </div>
        )}
        {showMates && (
          <Button
            variant="ghost"
            aria-label="Show teammates' busy times"
            aria-haspopup="dialog"
            aria-expanded={!!matesAt}
            title="Show teammates' busy times"
            onClick={(e) => {
              mates.load();
              setMatesAt(
                matesAt ? null : e.currentTarget.getBoundingClientRect(),
              );
            }}
          >
            <Users aria-hidden="true" />
            <span className="calendar-roomy">Teammates</span>
            {mates.selected.length > 0 && ` ${mates.selected.length}`}
          </Button>
        )}
        <Menu
          label="More calendar options"
          trigger={(open, expanded) => (
            <IconButton
              label="More calendar options"
              aria-expanded={expanded}
              onClick={open}
            >
              <MoreHorizontal />
            </IconButton>
          )}
        >
          {(close) =>
            (
              [
                ["sets", "Calendar sets"],
                ["subscribed", "Subscribed calendars"],
                ["feeds", "Feed links"],
                ["frames", "Frames"],
                ["habits", "Habits"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  close();
                  onManage(tab);
                }}
              >
                {label}
              </button>
            ))
          }
        </Menu>
        <Segmented
          label="Calendar view"
          value={mode}
          options={MODES.map((m) => ({ value: m.id, label: m.label }))}
          onChange={onMode}
        />
        <IconButton
          label="New event"
          title="New event (C)"
          aria-keyshortcuts="C"
          onClick={onNewEvent}
        >
          <CalendarPlus />
        </IconButton>
        <IconButton
          label={sideOpen ? "Hide the side panel" : "Show the side panel"}
          className="calendar-wide"
          aria-pressed={sideOpen}
          onClick={onSide}
        >
          <PanelRight />
        </IconButton>
        <Button
          variant="primary"
          aria-pressed={planOpen}
          aria-keyshortcuts="P"
          title="Plan (P)"
          onClick={onPlan}
        >
          <Wand2 aria-hidden="true" /> Plan
        </Button>
      </div>
      {matesAt && (
        <Popover
          anchor={matesAt}
          label="Show teammates"
          onClose={() => setMatesAt(null)}
        >
          <h3>Show teammates</h3>
          <small className="muted">
            Busy times for up to {MAX_MATES} people. Event details stay private.
          </small>
          {mates.error ? (
            <p className="small field-error" role="alert">
              {mates.error}
              <Button variant="ghost" onClick={mates.retry}>
                Try again
              </Button>
            </p>
          ) : mates.mates === null ? (
            <p className="small muted">Loading your teams</p>
          ) : !mates.mates.length ? (
            <p className="small muted">No teammates available.</p>
          ) : (
            <div className="calendar-checks">
              {mates.mates.map((m) => {
                const on = mates.selected.includes(m.user_id);
                return (
                  <label key={m.user_id} className="check">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && mates.selected.length >= MAX_MATES}
                      onChange={() => mates.toggle(m.user_id)}
                    />
                    <span dir="auto">{m.name}</span>
                    {m.pinned && (
                      <Pin aria-label="Pinned" className="calendar-icon" />
                    )}
                    {on && (
                      <i
                        className="calendar-dot"
                        style={{ background: mates.colorOf(m.user_id) }}
                        aria-hidden="true"
                      />
                    )}
                  </label>
                );
              })}
            </div>
          )}
          {mates.selected.length > 0 && (
            <Button variant="ghost" onClick={mates.clear}>
              Hide everyone
            </Button>
          )}
        </Popover>
      )}
    </header>
  );
}

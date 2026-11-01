import { useEffect, useRef, useState } from "react";
import {
  addDays,
  dayTime,
  hasTeamPermission,
  localDateKey,
  weekStartOf,
  type PlannerPrefs,
  type TeamDetail,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input } from "../../ui/kit";
import { refreshPlanner } from "../shared-task/store";
import { Availability } from "./Availability";
import { Capacity } from "./Capacity";
import { Insights } from "./Insights";
import { FindMeetings } from "./FindMeetings";
import {
  ActionState,
  ReadState,
  useCommand,
  useRead,
  useTeamsExit,
  useTeamsLeave,
  useOwned,
} from "./state";
import type { PermissionCheck } from "./Workspace";
export function Planning({
  team,
  canManage,
  check,
}: {
  team: TeamDetail;
  canManage: boolean;
  check: PermissionCheck;
}) {
  const owned = useOwned();
  const prefs = useRead(() => client.getPlannerPrefs()),
    [week, setWeek] = useState(() =>
      weekStartOf(
        localDateKey(
          new Date(),
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      ),
    ),
    touched = useRef(false),
    leave = useTeamsLeave(),
    command = useCommand();
  useTeamsExit({
    live: command.live,
    pending: command.pending,
    uncertain: command.unknown,
  });
  useEffect(() => {
    if (prefs.data && !touched.current)
      setWeek(weekStartOf(localDateKey(new Date(), prefs.data.timezone)));
  }, [prefs.data]);
  const zone = prefs.data?.timezone ?? "UTC",
    from = dayTime(week, 0, zone),
    to = dayTime(addDays(week, 7), 0, zone),
    canWrite = hasTeamPermission(team.role, "items:write");
  const changeWeek = (next: string) =>
    void leave().then((ok) => {
      if (ok && owned()) {
        touched.current = true;
        setWeek(weekStartOf(next));
      }
    });
  const pin = (id: string) => {
    if (!prefs.data || !prefs.fresh || command.blocked) return;
    const previous = prefs.data.pinned_user_ids,
      next = previous.includes(id)
        ? previous.filter((x) => x !== id)
        : [...previous, id].slice(-20);
    void command.run<PlannerPrefs>({
      label: previous.includes(id) ? "Unpin teammate" : "Pin teammate",
      prepare: async () => {
        const fresh = await client.getPlannerPrefs();
        if (JSON.stringify(fresh.pinned_user_ids) !== JSON.stringify(previous))
          throw Error("Pinned teammates changed. Refresh before editing them.");
      },
      perform: () => client.updatePlannerPrefs({ pinned_user_ids: next }),
      validate: (r) =>
        JSON.stringify(r.pinned_user_ids) === JSON.stringify(next),
      check: async () => {
        const r = await client.getPlannerPrefs();
        return {
          done: JSON.stringify(r.pinned_user_ids) === JSON.stringify(next),
          value: r,
        };
      },
      saved: (r) => {
        if (r) prefs.commit(r);
        void refreshPlanner();
      },
    });
  };
  return (
    <div className="teams-planning">
      <header className="teams-heading">
        <div>
          <h3>Team time</h3>
          <p className="small">
            {week} – {addDays(week, 6)} · {zone}
          </p>
        </div>
        <div className="teams-actions">
          <Button onClick={() => changeWeek(addDays(week, -7))}>
            Previous week
          </Button>
          <Button onClick={() => changeWeek(addDays(week, 7))}>
            Next week
          </Button>
        </div>
      </header>
      <ReadState read={prefs} label="your planning preferences" />
      <ActionState command={command} />
      <Field label="Week containing">
        <Input
          type="date"
          value={week}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))
              changeWeek(e.target.value);
          }}
        />
      </Field>
      {prefs.data && (
        <>
          <Availability
            key={`availability:${week}:${zone}`}
            teamId={team.id}
            from={from.toISOString()}
            to={to.toISOString()}
            zone={zone}
            pinned={prefs.data.pinned_user_ids}
            onPin={pin}
            pinBlocked={command.blocked || !prefs.fresh}
          />
          <Capacity
            key={`capacity:${week}:${zone}`}
            teamId={team.id}
            from={from}
            to={to}
            canWrite={canWrite}
          />
          <Insights
            key={`insights:${week}:${zone}`}
            team={team}
            from={from.toISOString()}
            to={to.toISOString()}
            week={week}
            canManage={canManage}
            check={check}
          />
          <FindMeetings team={team} canWrite={canWrite} zone={zone} />
        </>
      )}
    </div>
  );
}

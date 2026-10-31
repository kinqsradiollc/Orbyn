import type { Item } from "@orbyn/core";
import { useEffect, useId, useSyncExternalStore } from "react";
import { FocusBanner, FocusMode } from "../calendar/Focus";
import { usePath } from "../../lib/router";
import { tasks, useTaskLayer } from "./host-store";
import { canWriteIn, refreshPlanner, useItems, usePlanning } from "./store";
import { NewItem } from "./NewItem";
import { Peek } from "./Peek";
import { TaskPanel } from "./TaskPanel";
import "./shared-task.css";

const hosts: string[] = [];
const watchers = new Set<() => void>();
const announce = () => watchers.forEach((watch) => watch());
const watch = (listener: () => void) => {
  watchers.add(listener);
  return () => void watchers.delete(listener);
};

/**
 * Draws the task panel, the new-item dialog and focus mode. Mount it once
 * near the top of a screen, or once in the shell; extra copies draw nothing.
 */
export function TaskHost() {
  const id = useId();
  useEffect(() => {
    hosts.push(id);
    announce();
    return () => {
      hosts.splice(hosts.indexOf(id), 1);
      announce();
    };
  }, [id]);
  const active = useSyncExternalStore(watch, () => hosts[0] === id);
  const { open, create, focus, peek } = useTaskLayer();
  if (!active) return null;
  return (
    <>
      {peek && !open && (
        <Peek key={peek.target.id} target={peek.target} pinned={peek.pinned} />
      )}
      {open && (
        <TaskPanel
          key={open.id}
          id={open.id}
          listed={open.item}
          occurrence={open.options.occurrence}
          onClose={() => tasks.close()}
        />
      )}
      {create && (
        <NewItem
          key="new"
          text={create.text}
          prefill={create.prefill}
          onClose={() => tasks.closeCreate()}
        />
      )}
      {focus ? <HostFocus item={focus} /> : <ReturnToFocus />}
    </>
  );
}

/** Focus mode, from anywhere in the app. */
function HostFocus({ item }: { item: Item }) {
  const all = useItems();
  const planning = usePlanning();
  return (
    <FocusMode
      key={item.id}
      item={item}
      items={all}
      canWrite={canWriteIn(planning.teams, item.team_id)}
      breakLevel={planning.prefs?.break_level}
      onClose={() => tasks.closeFocus()}
      onSwitch={(next) => tasks.focus(next)}
      onChanged={() => refreshPlanner()}
    />
  );
}

/** A way back to a running session. Calendar shows its own. */
function ReturnToFocus() {
  const all = useItems();
  const path = usePath();
  if (path === "/app/calendar") return null;
  return (
    <div className="focus-return">
      <FocusBanner
        items={all}
        hidden={false}
        version={path}
        onOpen={(item) => tasks.focus(item)}
      />
    </div>
  );
}

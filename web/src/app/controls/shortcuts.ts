import {
  COMMANDS,
  SETTING_COMMANDS,
  effectiveKeys,
  keysId,
  setShortcut,
  type ShortcutOverrides,
} from "@orbyn/core";

/** Display may omit inactive actions; shared account keys must still see their collisions. */
export const SHORTCUT_CATALOG = [...COMMANDS, ...SETTING_COMMANDS].filter(
  (command) => command.on !== "phone",
);
export function shortcutConflicts(
  overrides: ShortcutOverrides,
  id: string,
  keys: string[],
) {
  if (!keys.length) return [];
  const wanted = keysId(keys);
  return SHORTCUT_CATALOG.filter(
    (command) =>
      command.id !== id && keysId(effectiveKeys(command, overrides)) === wanted,
  );
}
/** Reset is an assignment of the command's original keys, with the same conflict decision. */
export function assignShortcut(
  overrides: ShortcutOverrides,
  id: string,
  keys: string[] | null,
): ShortcutOverrides {
  const command = SHORTCUT_CATALOG.find((command) => command.id === id);
  if (!command) return overrides;
  const chosen = keys ?? command.keys ?? [];
  const next = setShortcut(SHORTCUT_CATALOG, overrides, id, keys);
  for (const conflict of shortcutConflicts(next, id, chosen))
    next[conflict.id] = [];
  return next;
}

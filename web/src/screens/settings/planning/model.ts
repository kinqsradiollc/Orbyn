import {
  HttpError,
  type PlannerPrefs,
  type PlannerPrefsInput,
} from "@orbyn/core";
export const unknownOutcome = (error: unknown) =>
  !(error instanceof HttpError) ||
  error.statusCode >= 500 ||
  [408, 429].includes(error.statusCode);
export const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export function matchesSaved(value: unknown, patch: unknown): boolean {
  const expected = object(patch),
    actual = object(value);
  return expected && actual
    ? Object.keys(expected).every((key) =>
        matchesSaved(actual[key], expected[key]),
      )
    : equal(value, patch);
}
export type EditablePrefs = Omit<
  PlannerPrefs,
  "calendar_sets" | "pinned_user_ids"
>;
export function editable(prefs: PlannerPrefs): EditablePrefs {
  const { calendar_sets: _sets, pinned_user_ids: _people, ...fields } = prefs;
  return fields;
}
/** Only edited fields are sent; calendar sets and pinned people have separate owners. */
export function preferencePatch(
  before: PlannerPrefsInput,
  next: PlannerPrefsInput,
): PlannerPrefsInput {
  const previous = object(before)!,
    changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (equal(previous[key], value)) continue;
    if (
      ["digest", "default_alerts", "planner_notices"].includes(key) &&
      object(value)
    ) {
      const prior = object(previous[key]) ?? {};
      changed[key] = Object.fromEntries(
        Object.entries(object(value)!).filter(
          ([name, field]) => !equal(prior[name], field),
        ),
      );
    } else changed[key] = value;
  }
  return changed;
}
export const zoneNames = () => {
  try {
    return ["UTC", ...Intl.supportedValuesOf("timeZone")];
  } catch {
    return ["UTC"];
  }
};

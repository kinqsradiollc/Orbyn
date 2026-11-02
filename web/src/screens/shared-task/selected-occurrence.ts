import {
  occurrencesBetween,
  resolveOccurrenceTimes,
  type Item,
  type ItemInput,
  type ItemOverride,
} from "@orbyn/core";
import type { OccurrenceRef } from "./draft";

type Source = ItemInput &
  Partial<Pick<Item, "series_start" | "exdates">> & {
    overrides?: ItemOverride[];
  };
export type SelectedView = {
  source: Source;
  item: Item | ItemInput;
  occurrence: OccurrenceRef | null;
  state: "series" | "loading" | "ready" | "unavailable";
};

/** Opening coordinates are a loading snapshot; original key + stored overrides own current times. */
export function selectedOccurrence(
  source: Source,
  selected: OccurrenceRef | null,
): SelectedView {
  if (!selected)
    return { source, item: source, occurrence: null, state: "series" };
  const unavailable = (): SelectedView => ({
    source,
    item: { ...source, due_at: null, end_at: null },
    occurrence: selected,
    state: "unavailable",
  });
  if (
    ![
      selected.occurrence,
      selected.start_at,
      ...(selected.end_at ? [selected.end_at] : []),
    ].every((value) => Number.isFinite(Date.parse(value)))
  )
    return unavailable();
  if (!Array.isArray(source.overrides))
    return {
      source,
      item: { ...source, due_at: selected.start_at, end_at: selected.end_at },
      occurrence: selected,
      state: "loading",
    };
  try {
    const at = new Date(selected.occurrence);
    const due = source.due_at;
    const start = source.series_start;
    const exdates = source.exdates;
    if (
      !due ||
      !source.rrule ||
      !Number.isFinite(at.getTime()) ||
      (source.kind === "task" && at.getTime() < Date.parse(due)) ||
      occurrencesBetween(
        new Date(start ?? due),
        source.rrule,
        source.timezone || "UTC",
        at,
        new Date(at.getTime() + 1),
        exdates ?? [],
        1,
      ).length !== 1
    )
      return unavailable();
    const change = source.overrides.find(
      (value) => Date.parse(value.occurrence) === at.getTime(),
    );
    const times = resolveOccurrenceTimes(
      {
        due_at: due,
        end_at: source.end_at ?? null,
        all_day: !!source.all_day,
        timezone: source.timezone || "UTC",
      },
      at,
      change,
    );
    const resolved = {
      occurrence: at.toISOString(),
      start_at: times.start.toISOString(),
      end_at: times.end?.toISOString() ?? null,
    };
    // Only fields in the stored occurrence contract can overlay canonical authority.
    const fields = change
      ? {
          ...(change.title !== undefined ? { title: change.title } : {}),
          ...(change.notes !== undefined ? { notes: change.notes } : {}),
          ...(change.location !== undefined
            ? { location: change.location }
            : {}),
          ...(change.meeting_url !== undefined
            ? { meeting_url: change.meeting_url }
            : {}),
          ...(change.busy !== undefined ? { busy: change.busy } : {}),
          ...(change.color !== undefined ? { color: change.color } : {}),
          ...(change.alerts !== undefined ? { alerts: change.alerts } : {}),
        }
      : {};
    return {
      source,
      item: {
        ...source,
        ...fields,
        due_at: resolved.start_at,
        end_at: resolved.end_at,
      },
      occurrence: resolved,
      state: "ready",
    };
  } catch {
    return unavailable();
  }
}

import { Alert } from "react-native";
import type { EditScope, Item, Kind } from "@orbyn/core";

/** One occurrence of a repeating item: its original start, and its times now. */
export type OccurrenceRef = {
  itemId: string;
  /** The occurrence's original start (what the server calls `occurrence`). */
  occurrence: string;
  start: string;
  end: string | null;
};

/**
 * Ask which occurrences of a repeating item a change is for: this one, this
 * and every later one, or all of them. Resolves null when cancelled.
 */
export function askScope(
  kind: Kind,
  action: "save" | "move" | "delete",
): Promise<EditScope | null> {
  const noun = kind === "event" ? "event" : "task";
  const title =
    action === "delete"
      ? `Delete a repeating ${noun}`
      : action === "move"
        ? `Move a repeating ${noun}`
        : `Change a repeating ${noun}`;
  return new Promise((resolve) => {
    let answered = false;
    const pick = (scope: EditScope | null) => () => {
      if (answered) return;
      answered = true;
      resolve(scope);
    };
    Alert.alert(
      title,
      action === "delete" ? `Which ${noun}s go?` : `Which ${noun}s change?`,
      [
        { text: `This ${noun}`, onPress: pick("this") },
        { text: "This and following", onPress: pick("following") },
        {
          text: `All ${noun}s`,
          style: action === "delete" ? "destructive" : "default",
          onPress: pick("all"),
        },
        { text: "Cancel", style: "cancel", onPress: pick(null) },
      ],
      { cancelable: true, onDismiss: pick(null) },
    );
  });
}

/**
 * The series' new times when a change to one occurrence applies to all of
 * them: the whole series moves by as much as the occurrence moved, and takes
 * the occurrence's new length.
 */
export function seriesTimes(
  series: Pick<Item, "due_at" | "end_at">,
  was: { start: string; end: string | null },
  now: { start: string; end: string | null },
) {
  if (!series.due_at) return { due_at: now.start, end_at: now.end };
  const delta = Date.parse(now.start) - Date.parse(was.start);
  const due = new Date(Date.parse(series.due_at) + delta);
  const end = now.end
    ? new Date(due.getTime() + Date.parse(now.end) - Date.parse(now.start))
    : series.end_at
      ? new Date(Date.parse(series.end_at) + delta)
      : null;
  return { due_at: due.toISOString(), end_at: end ? end.toISOString() : null };
}

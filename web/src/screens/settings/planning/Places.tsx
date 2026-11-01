import { placeInput, TRAVEL_MODES, type Place } from "@orbyn/core";
import { useRef, useState } from "react";
import { client } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  Loading,
  SelectBox,
  useConfirm,
} from "../../../ui/kit";
import { refreshPlanner } from "../../shared-task";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
import { equal, unknownOutcome } from "./model";

type Draft = {
  label: string;
  match: string;
  travel: string;
  peak: string;
  mode: string;
};
const fromPlace = (place?: Place): Draft => ({
  label: place?.label ?? "",
  match: place?.match ?? "",
  travel: String(place?.travel_minutes ?? 0),
  peak: place?.peak_minutes == null ? "" : String(place.peak_minutes),
  mode: place?.mode ?? "",
});
type PlaceSave = {
  kind: "save";
  id: string | null;
  input: ReturnType<typeof placeInput.parse>;
  priorIds: readonly string[];
};
const matchesSave = (row: Place, submitted: PlaceSave) =>
  (submitted.id
    ? row.id === submitted.id
    : !submitted.priorIds.includes(row.id)) &&
  row.label === submitted.input.label &&
  row.match === submitted.input.match &&
  row.travel_minutes === submitted.input.travel_minutes &&
  (row.mode ?? null) === (submitted.input.mode ?? null) &&
  (row.peak_minutes ?? null) === (submitted.input.peak_minutes ?? null);
export function PlanningPlaces() {
  const owned = useSettingsOwner(),
    confirm = useConfirm(),
    read = useSettingsRead(() => client.listPlaces());
  const [editing, setEditing] = useState<Place | "new" | null>(null),
    [draft, setDraft] = useState<Draft>(() => fromPlace()),
    [base, setBase] = useState<Draft>(() => fromPlace()),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [matches, setMatches] = useState<Place[] | null>(null);
  const lock = useRef(false),
    unknown = useRef(false),
    current = useRef({ editing, draft, read });
  current.current = { editing, draft, read };
  const attempt = useRef<PlaceSave | { kind: "delete"; id: string } | null>(
    null,
  );
  const dirty = !!editing && !equal(draft, base);
  useSettingsExit({
    dirty,
    pending: busy || confirming,
    sensitive: uncertain,
    message: uncertain
      ? "Resolve the unconfirmed place change before leaving."
      : undefined,
  });
  const frozen = busy || confirming || uncertain;
  const open = (place: Place | "new") => {
    if (!owned() || lock.current || unknown.current) return;
    const value = fromPlace(place === "new" ? undefined : place);
    setEditing(place);
    setDraft(value);
    setBase(value);
    setError("");
    setStatus("");
  };
  const cancel = async () => {
    if (!owned() || lock.current || unknown.current) return;
    const target = editing,
      buffer = draft;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard place changes?",
          action: "Discard changes",
          danger: true,
        }))
      )
        return;
      if (
        owned() &&
        current.current.editing === target &&
        current.current.draft === buffer
      )
        setEditing(null);
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const save = async () => {
    if (!owned() || lock.current || unknown.current || !editing || !read.fresh)
      return;
    if (!draft.travel.trim()) {
      setError("Enter the travel time in minutes.");
      return;
    }
    const checked = placeInput.safeParse({
      label: draft.label,
      match: draft.match,
      travel_minutes: Number(draft.travel),
      peak_minutes: draft.peak.trim() ? Number(draft.peak) : null,
      mode: draft.mode || null,
    });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Check this place.");
      return;
    }
    const target = editing,
      body = checked.data;
    lock.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    read.invalidate();
    setMatches(null);
    attempt.current = null;
    let dispatched = false;
    try {
      const prior = target === "new" ? await client.listPlaces() : [];
      if (!owned() || current.current.editing !== target) return;
      const submitted: PlaceSave = {
        kind: "save",
        id: target === "new" ? null : target.id,
        input: structuredClone(body),
        priorIds: prior.map((row) => row.id),
      };
      attempt.current = submitted;
      dispatched = true;
      const place =
        target === "new"
          ? await client.createPlace(body)
          : await client.updatePlace(target.id, body);
      if (!owned() || current.current.editing !== target) return;
      read.commit([
        ...(read.data ?? []).filter((row) => row.id !== place.id),
        place,
      ]);
      setEditing(null);
      attempt.current = null;
      setStatus("Place saved.");
      if (owned())
        await refreshPlanner(true).catch(() => {
          if (owned())
            setStatus("Place saved. Calendar could not be refreshed.");
        });
    } catch (failure) {
      if (owned()) {
        unknown.current = dispatched && unknownOutcome(failure);
        setUncertain(unknown.current);
        setError(
          messageOf(failure, "Couldn't save this place. Your draft is kept."),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const remove = async (place: Place) => {
    if (!owned() || lock.current || unknown.current || !read.fresh) return;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        !(await confirm({
          title: `Delete the place “${place.label}”?`,
          body: "Matching events will use the default travel time.",
          action: "Delete place",
          danger: true,
        }))
      )
        return;
      if (
        !owned() ||
        !current.current.read.fresh ||
        current.current.read.data?.find((row) => row.id === place.id) !== place
      )
        return;
      setBusy(true);
      setError("");
      read.invalidate();
      setMatches(null);
      attempt.current = { kind: "delete", id: place.id };
      await client.deletePlace(place.id);
      if (!owned()) return;
      read.commit((read.data ?? []).filter((row) => row.id !== place.id));
      attempt.current = null;
      setStatus("Place deleted.");
      if (owned())
        await refreshPlanner(true).catch(() => {
          if (owned())
            setStatus("Place deleted. Calendar could not be refreshed.");
        });
    } catch (failure) {
      if (owned()) {
        unknown.current = unknownOutcome(failure);
        setUncertain(unknown.current);
        setError(
          messageOf(
            failure,
            "Couldn't confirm deletion. Refresh the saved places before another change.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) {
        setBusy(false);
        setConfirming(false);
      }
    }
  };
  const checkSaved = async () => {
    if (!owned() || lock.current || !attempt.current) return;
    lock.current = true;
    setBusy(true);
    const submitted = attempt.current;
    try {
      const rows = await client.listPlaces();
      if (!owned() || attempt.current !== submitted) return;
      read.commit(rows);
      if (submitted.kind === "delete") {
        if (!rows.some((row) => row.id === submitted.id)) {
          unknown.current = false;
          setUncertain(false);
          attempt.current = null;
          setStatus("The place is no longer saved.");
          setError("");
        } else {
          setMatches(null);
          setError(
            "The place is still saved. The earlier deletion may still finish; keep checking before making another change.",
          );
        }
      } else {
        setMatches(rows.filter((row) => matchesSave(row, submitted)));
        setError(
          "The outcome is unconfirmed. Choose an existing matching place to continue without creating another.",
        );
      }
    } catch (failure) {
      if (owned()) setError(messageOf(failure, "Couldn't check saved places."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const useMatch = async (place: Place) => {
    const submitted = attempt.current;
    if (
      !owned() ||
      lock.current ||
      !matches?.some((row) => row === place) ||
      submitted?.kind !== "save" ||
      !matchesSave(place, submitted)
    )
      return;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        !(await confirm({
          title: "Use this saved place?",
          body: "Keep this existing place and discard the unconfirmed local change.",
          action: "Use saved place",
        }))
      )
        return;
      if (
        !owned() ||
        attempt.current !== submitted ||
        !matches?.includes(place) ||
        !matchesSave(place, submitted)
      )
        return;
      unknown.current = false;
      setUncertain(false);
      attempt.current = null;
      setMatches(null);
      setEditing(null);
      setError("");
      setStatus("Using the saved place.");
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  return (
    <SettingsSection
      title="Places"
      description="Location matches and travel time used by the planner."
    >
      {error && <ErrorNotice message={error} />}{" "}
      {status && <p role="status">{status}</p>}
      {read.error && (
        <ErrorNotice
          message={read.error}
          onRetry={uncertain ? undefined : () => void read.reload()}
        />
      )}
      {read.loading && !read.data && <Loading label="Loading places" />}
      {uncertain && (
        <div className="settings-planning-recovery">
          <p>
            Your change is unconfirmed. No automatic retry will create another
            place.
          </p>
          <Button
            disabled={busy || confirming}
            onClick={() => void checkSaved()}
          >
            Check saved places
          </Button>
          {matches?.length === 0 && (
            <p>No matching place was found. Keep this draft and check again.</p>
          )}
          {matches?.map((place) => (
            <div key={place.id}>
              <strong dir="auto">{place.label}</strong>
              <p dir="auto">
                {place.match} · {place.travel_minutes} minutes ·{" "}
                {place.mode ?? "No travel mode"} · Peak{" "}
                {place.peak_minutes ?? place.travel_minutes} minutes
              </p>
              <Button
                disabled={busy || confirming}
                onClick={() => void useMatch(place)}
              >
                Use saved place
              </Button>
            </div>
          ))}
        </div>
      )}
      {editing ? (
        <form
          className="settings-planning-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={frozen} className="settings-planning-fields">
            <legend>{editing === "new" ? "Add place" : "Edit place"}</legend>
            <Field label="Name">
              <Input
                maxLength={60}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </Field>
            <Field label="Text in event locations">
              <Input
                maxLength={200}
                value={draft.match}
                onChange={(e) => setDraft({ ...draft, match: e.target.value })}
              />
            </Field>
            <div className="settings-planning-grid">
              <Field label="Travel time (minutes)">
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={draft.travel}
                  onChange={(e) =>
                    setDraft({ ...draft, travel: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Peak-hour time (optional)"
                hint="Weekdays 07:00–09:00 and 16:00–18:00. Blank uses the usual time."
              >
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={draft.peak}
                  onChange={(e) => setDraft({ ...draft, peak: e.target.value })}
                />
              </Field>
              <Field label="Travel mode (label only)">
                <SelectBox
                  value={draft.mode}
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
                >
                  <option value="">No mode</option>
                  {TRAVEL_MODES.map((mode) => (
                    <option key={mode}>{mode}</option>
                  ))}
                </SelectBox>
              </Field>
            </div>
          </fieldset>
          <div className="settings-planning-actions">
            <Button disabled={frozen} onClick={() => void cancel()}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={
                confirming || uncertain || !draft.label.trim() || !read.fresh
              }
            >
              Save place
            </Button>
            {!read.fresh && !uncertain && (
              <Button
                disabled={busy || confirming}
                onClick={() => void read.reload()}
              >
                Refresh saved places
              </Button>
            )}
          </div>
        </form>
      ) : (
        <>
          {!read.fresh && !read.loading && !uncertain && (
            <Button
              disabled={busy || confirming}
              onClick={() => void read.reload()}
            >
              Refresh saved places
            </Button>
          )}
          <Button disabled={frozen || !read.fresh} onClick={() => open("new")}>
            Add place
          </Button>
          {!read.loading && read.data?.length === 0 && (
            <p className="muted">No places yet.</p>
          )}
          <ul className="settings-planning-list">
            {read.data?.map((place) => (
              <li key={place.id}>
                <div>
                  <strong dir="auto">{place.label}</strong>
                  <p className="muted" dir="auto">
                    Matches “{place.match}” · {place.travel_minutes} min
                    {place.mode ? ` · ${place.mode}` : ""}
                    {place.peak_minutes != null
                      ? ` · Peak ${place.peak_minutes} min`
                      : ""}
                  </p>
                </div>
                <div className="settings-planning-actions">
                  <Button
                    disabled={frozen || !read.fresh}
                    onClick={() => open(place)}
                  >
                    Edit {place.label}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={frozen || !read.fresh}
                    onClick={() => void remove(place)}
                  >
                    Delete {place.label}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </SettingsSection>
  );
}

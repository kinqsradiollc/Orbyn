import { PageMaintenanceStore, watchDocRefresh } from "@orbyn/api-client";
import {
  blockText,
  DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET,
  maintainedPageBindingInput,
  MAX_MAINTAINED_BLOCKS,
  type Doc,
  type MaintainedPageBinding,
  type MaintainedPageBindingInput,
} from "@orbyn/core";
import { MoreHorizontal } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { client, getSessionVersion, onToken } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import { pageWatcher } from "../streams";
import { useLibraryOwner } from "../lifetime";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  Menu,
  Pill,
  TextArea,
  useConfirm,
} from "../../../ui/kit";

type ScheduleDraft = {
  selected: string[];
  instruction: string;
  frequency: string;
  budget: string;
  nextRun: string;
  timezone: string;
  paused: boolean;
};

const localTime = (date: Date) => {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
};
const blankDraft = (): ScheduleDraft => ({
  selected: [],
  instruction: "",
  frequency: "FREQ=DAILY",
  budget: String(DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET),
  nextRun: localTime(new Date(Date.now() + 24 * 60 * 60_000)),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  paused: true,
});

const REPEATS = [
  { value: "FREQ=DAILY", label: "Every day" },
  { value: "FREQ=WEEKLY", label: "Every week" },
  { value: "FREQ=MONTHLY", label: "Every month" },
];

const RUN_STATE = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting for your review",
  done: "Run finished",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Scheduled updates over chosen blocks; review shows the saved proposal. */
type Props = { id: string; onChanged: (doc: Doc) => void; onClose: () => void };

export function MaintenanceDialog(props: Props) {
  const owner = useSyncExternalStore(onToken, getSessionVersion);
  return <MaintenanceBody key={`${owner}:${props.id}`} {...props} />;
}

function MaintenanceBody({ id, onChanged, onClose }: Props) {
  const confirm = useConfirm();
  const current = useLibraryOwner();
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const store = useMemo(
    () =>
      new PageMaintenanceStore(
        client,
        id,
        () => String(getSessionVersion()),
        (doc) => current() && changed.current(doc),
      ),
    [id, current],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [form, setForm] = useState(false);
  const [editing, setEditing] = useState<MaintainedPageBinding>();
  const [draft, setDraft] = useState(blankDraft);
  const initialDraft = useRef(JSON.stringify(draft));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [receipt, setReceipt] = useState<MaintainedPageBinding | null>(null);
  const request = useRef<{
    input: MaintainedPageBindingInput;
    editing?: MaintainedPageBinding;
    beforeIds: string[];
  } | null>(null);
  const busy = state.busy || saving;
  const dirty = JSON.stringify(draft) !== initialDraft.current;
  const change = (value: Partial<ScheduleDraft>) => {
    setDraft((was) => ({ ...was, ...value }));
    setSaveError("");
  };
  useEffect(() => {
    void store.prepare();
    return () => store.dispose();
  }, [store]);
  useEffect(() => {
    const watcher = watchDocRefresh({
      api: pageWatcher,
      id,
      session: () => String(getSessionVersion()),
      load: () => client.listPageMaintenanceRuns(id),
      received: store.receiveRuns,
      failed: store.receiveRunsError,
    });
    return watcher.dispose;
  }, [id, store]);
  const edit = (binding: MaintainedPageBinding) => {
    setForm(true);
    setEditing(binding);
    const next = {
      selected: binding.snapshot.blocks.map((block) => block.block_id),
      instruction: binding.instruction,
      frequency: binding.rrule,
      budget: String(
        binding.token_budget ?? DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET,
      ),
      nextRun: localTime(new Date(binding.next_run_at)),
      timezone: binding.timezone,
      paused: binding.paused,
    };
    setDraft(next);
    initialDraft.current = JSON.stringify(next);
    setSaveError("");
    setReceipt(null);
    request.current = null;
  };
  const reset = () => {
    setForm(false);
    setEditing(undefined);
    const next = blankDraft();
    setDraft(next);
    initialDraft.current = JSON.stringify(next);
    setSaveError("");
    request.current = null;
  };
  const mayDiscard = async () =>
    !dirty ||
    (await confirm({
      title: "Discard schedule changes?",
      body: "Your changes haven't been saved.",
      action: "Discard",
      danger: true,
    }));
  const close = async () => {
    if (!busy && !savingRef.current && (await mayDiscard()) && current())
      onClose();
  };
  const save = async () => {
    const doc = store.getSnapshot().doc;
    if (!doc || busy || savingRef.current || !current()) return;
    const at = new Date(draft.nextRun);
    if (!Number.isFinite(at.getTime())) {
      setSaveError("Choose a valid next run time.");
      return;
    }
    if (
      (!editing ||
        draft.nextRun !== localTime(new Date(editing.next_run_at))) &&
      at.getTime() <= Date.now()
    ) {
      setSaveError("Choose a future next run time.");
      return;
    }
    // An unchanged time retains its original seconds and timezone semantics.
    const parsed = maintainedPageBindingInput.safeParse({
      block_ids: draft.selected,
      instruction: draft.instruction,
      rrule: draft.frequency,
      timezone: draft.timezone,
      next_run_at:
        editing && draft.nextRun === localTime(new Date(editing.next_run_at))
          ? editing.next_run_at
          : at.toISOString(),
      expected_doc_version: doc.version,
      token_budget: Number(draft.budget),
      paused: draft.paused,
    });
    if (!parsed.success) {
      setSaveError(
        parsed.error.issues[0]?.message ?? "Check the schedule fields.",
      );
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      // These routes do not support Idempotency-Key. An explicit retry first
      // checks whether the prior attempt saved, retaining its original intent.
      const previous = request.current;
      if (previous) {
        const rows = await client.listPageMaintenance(id);
        if (!current()) return;
        const sameBlocks = (row: MaintainedPageBinding) =>
          JSON.stringify(
            row.snapshot.blocks.map((one) => one.block_id).sort(),
          ) === JSON.stringify([...previous.input.block_ids].sort());
        const saved = rows.find(
          (row) =>
            (previous.editing
              ? row.id === previous.editing.id &&
                row.revision > previous.editing.revision
              : !previous.beforeIds.includes(row.id)) &&
            row.instruction === previous.input.instruction &&
            row.rrule === previous.input.rrule &&
            row.timezone === previous.input.timezone &&
            row.next_run_at === previous.input.next_run_at &&
            row.paused === previous.input.paused &&
            row.token_budget === previous.input.token_budget &&
            sameBlocks(row),
        );
        if (saved) {
          setReceipt(saved);
          reset();
          await store.refresh();
          return;
        }
      }
      request.current = {
        input: parsed.data,
        editing,
        beforeIds: store.getSnapshot().bindings.map((one) => one.id),
      };
      const saved = editing
        ? await client.updatePageMaintenance(id, editing.id, {
            ...parsed.data,
            expected_revision: editing.revision,
          })
        : await client.createPageMaintenance(id, parsed.data);
      if (!current()) return;
      setReceipt(saved);
      reset();
      await store.refresh();
    } catch (failure) {
      if (current())
        setSaveError(
          `${messageOf(failure, "Couldn't save the schedule.")} Your changes are kept. Retry checks saved schedules first.`,
        );
    } finally {
      savingRef.current = false;
      if (current()) setSaving(false);
    }
  };
  const blocks = (state.doc?.content ?? []).filter(
    (block) => block.id && "text" in block,
  );
  const known = REPEATS.some((one) => one.value === draft.frequency);
  return (
    <Dialog title="Page updates" wide onClose={() => void close()}>
      {receipt && (
        <p className="small" role="status">
          Schedule saved{receipt.paused ? " and paused" : ""}.
          {state.error
            ? " Refresh to see the latest schedules; don't add it again."
            : ""}
        </p>
      )}
      {saveError && <ErrorNotice message={saveError} />}
      {state.error && (
        <ErrorNotice
          message={state.error}
          onRetry={() => void (state.doc ? store.refresh() : store.prepare())}
        />
      )}
      {!state.doc && !state.error && <Loading label="Loading page updates" />}
      {state.doc && !receipt && (form || !state.bindings.length) ? (
        <form
          className="lib-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="page-blocks" disabled={busy}>
            <legend className="small">
              Blocks to maintain · up to {MAX_MAINTAINED_BLOCKS}
            </legend>
            {blocks.map((block) => (
              <label key={block.id} className="check small">
                <input
                  type="checkbox"
                  checked={draft.selected.includes(block.id!)}
                  onChange={(event) =>
                    change({
                      selected: event.target.checked
                        ? [...draft.selected, block.id!]
                        : draft.selected.filter((one) => one !== block.id),
                    })
                  }
                />
                <span dir="auto">{blockText(block).slice(0, 120)}</span>
              </label>
            ))}
          </fieldset>
          <Field label="What should stay current">
            <TextArea
              value={draft.instruction}
              maxLength={4000}
              disabled={busy}
              onChange={(event) =>
                change({ instruction: event.currentTarget.value })
              }
            />
          </Field>
          <div className="page-share-options">
            <Field label="Repeat">
              <select
                className="input"
                value={draft.frequency}
                disabled={busy}
                onChange={(event) =>
                  change({ frequency: event.currentTarget.value })
                }
              >
                {!known && (
                  <option value={draft.frequency}>Current rule</option>
                )}
                {REPEATS.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Token budget per run"
              hint="1,000–20,000 estimated tokens; Overnight limits also apply."
            >
              <Input
                type="number"
                min={1000}
                max={DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET}
                step={1}
                disabled={busy}
                value={draft.budget}
                onChange={(event) =>
                  change({ budget: event.currentTarget.value })
                }
              />
            </Field>
          </div>
          <div className="page-share-options">
            <Field label="Next run (your local time)">
              <Input
                type="datetime-local"
                required
                disabled={busy}
                value={draft.nextRun}
                onChange={(event) =>
                  change({ nextRun: event.currentTarget.value })
                }
              />
            </Field>
            <Field
              label="Schedule timezone"
              hint="Repeating runs follow this timezone."
            >
              <Input
                required
                disabled={busy}
                value={draft.timezone}
                onChange={(event) =>
                  change({ timezone: event.currentTarget.value })
                }
              />
            </Field>
          </div>
          <label className="check small">
            <input
              type="checkbox"
              checked={!draft.paused}
              disabled={busy}
              onChange={(event) =>
                change({ paused: !event.currentTarget.checked })
              }
            />
            Enable scheduled updates
          </label>
          <p className="small muted">
            {draft.paused
              ? "Saved paused. No runs start until you enable it."
              : "Overnight can work on these blocks from the next run time."}
          </p>
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  if ((await mayDiscard()) && current()) {
                    if (state.bindings.length) reset();
                    else onClose();
                  }
                })()
              }
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={
                !draft.selected.length ||
                draft.selected.length > MAX_MAINTAINED_BLOCKS ||
                !draft.instruction.trim()
              }
            >
              {editing ? "Save schedule" : "Add schedule"}
            </Button>
          </div>
        </form>
      ) : null}
      {state.doc && !form && state.bindings.length > 0 && (
        <section>
          <div className="page-panel-head">
            <h3>Schedules</h3>
            <Button
              disabled={busy}
              onClick={() => {
                reset();
                setReceipt(null);
                setForm(true);
              }}
            >
              New schedule
            </Button>
          </div>
          <ul className="lib-picklist">
            {state.bindings.map((binding) => (
              <li key={binding.id} className="row">
                <span className="row-main">
                  <span className="row-title" dir="auto">
                    {binding.instruction}
                  </span>
                  <span className="small muted">
                    {REPEATS.find((one) => one.value === binding.rrule)
                      ?.label ?? binding.rrule}{" "}
                    · {binding.snapshot.blocks.length} blocks ·{" "}
                    {binding.timezone} · next{" "}
                    {new Date(binding.next_run_at).toLocaleString()}
                  </span>
                </span>
                {binding.paused && <Pill>Paused</Pill>}
                <Menu
                  label="Schedule options"
                  trigger={(show, expanded) => (
                    <IconButton
                      label="Schedule options"
                      aria-expanded={expanded}
                      onClick={show}
                    >
                      <MoreHorizontal />
                    </IconButton>
                  )}
                >
                  {(close) => (
                    <>
                      <button
                        disabled={busy}
                        type="button"
                        onClick={() => {
                          close();
                          edit(binding);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        disabled={busy}
                        type="button"
                        onClick={() => {
                          close();
                          void store.pause(binding);
                        }}
                      >
                        {binding.paused ? "Resume" : "Pause"}
                      </button>
                      <button
                        disabled={busy}
                        type="button"
                        className="is-danger"
                        onClick={() => {
                          close();
                          void store.remove(binding);
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </Menu>
              </li>
            ))}
          </ul>
        </section>
      )}
      {state.runs.length > 0 && (
        <section>
          <div className="page-panel-head">
            <h3>Recent runs</h3>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void store.refresh()}
            >
              Refresh
            </Button>
          </div>
          <ul className="lib-picklist">
            {state.runs.map((run) => (
              <li key={run.id} className="row">
                <span className="row-main">
                  <span className="row-title" dir="auto">
                    {run.error || RUN_STATE[run.state]}
                  </span>
                  <span className="small muted">
                    {new Date(run.scheduled_for).toLocaleString()}
                  </span>
                </span>
                {run.can_review && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => void store.decide(run, true)}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void store.decide(run, false)}
                    >
                      Decline
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}

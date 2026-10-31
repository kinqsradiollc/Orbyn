import { PageMaintenanceStore, watchDocRefresh } from "@orbyn/api-client";
import {
  blockText,
  DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET,
  type Doc,
  type MaintainedPageBinding,
} from "@orbyn/core";
import { MoreHorizontal } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { client, getToken } from "../../../lib/session";
import { pageWatcher } from "../streams";
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
} from "../../../ui/kit";

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
export function MaintenanceDialog({
  id,
  onChanged,
  onClose,
}: {
  id: string;
  onChanged: (doc: Doc) => void;
  onClose: () => void;
}) {
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const store = useMemo(
    () =>
      new PageMaintenanceStore(client, id, getToken, (doc) =>
        changed.current(doc),
      ),
    [id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [form, setForm] = useState(false);
  const [editing, setEditing] = useState<MaintainedPageBinding>();
  const [selected, setSelected] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [frequency, setFrequency] = useState("FREQ=DAILY");
  const [budget, setBudget] = useState(
    String(DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET),
  );
  useEffect(() => {
    void store.prepare();
    return () => store.dispose();
  }, [store]);
  useEffect(() => {
    const watcher = watchDocRefresh({
      api: pageWatcher,
      id,
      session: getToken,
      load: () => client.listPageMaintenanceRuns(id),
      received: store.receiveRuns,
      failed: store.receiveRunsError,
    });
    return watcher.dispose;
  }, [id, store]);
  const edit = (binding: MaintainedPageBinding) => {
    setForm(true);
    setEditing(binding);
    setSelected(binding.snapshot.blocks.map((block) => block.block_id));
    setInstruction(binding.instruction);
    setFrequency(binding.rrule);
    setBudget(
      String(binding.token_budget ?? DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET),
    );
  };
  const reset = () => {
    setForm(false);
    setEditing(undefined);
    setSelected([]);
    setInstruction("");
  };
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const blocks = (state.doc?.content ?? []).filter(
    (block) => block.id && "text" in block,
  );
  const known = REPEATS.some((one) => one.value === frequency);
  return (
    <Dialog title="Page updates" wide onClose={() => !state.busy && onClose()}>
      {state.error && (
        <ErrorNotice
          message={state.error}
          onRetry={() => void (state.doc ? store.refresh() : store.prepare())}
        />
      )}
      {!state.doc && !state.error && <Loading label="Loading page updates" />}
      {state.doc && (form || !state.bindings.length) ? (
        <form
          className="lib-form"
          onSubmit={(event) => {
            event.preventDefault();
            void store
              .save(
                {
                  block_ids: selected,
                  instruction: instruction.trim(),
                  rrule: frequency,
                  timezone: timeZone,
                  expected_doc_version: state.doc!.version,
                  token_budget: Number(budget),
                  ...(editing ? { paused: editing.paused } : {}),
                } as never,
                editing,
              )
              .then(reset);
          }}
        >
          <fieldset className="page-blocks">
            <legend className="small">Blocks to maintain</legend>
            {blocks.map((block) => (
              <label key={block.id} className="check small">
                <input
                  type="checkbox"
                  checked={selected.includes(block.id!)}
                  onChange={(event) =>
                    setSelected((was) =>
                      event.target.checked
                        ? [...was, block.id!]
                        : was.filter((one) => one !== block.id),
                    )
                  }
                />
                <span dir="auto">{blockText(block).slice(0, 120)}</span>
              </label>
            ))}
          </fieldset>
          <Field label="What should stay current">
            <TextArea
              value={instruction}
              onChange={(event) => setInstruction(event.currentTarget.value)}
            />
          </Field>
          <div className="page-share-options">
            <Field label="Repeat">
              <select
                className="input"
                value={frequency}
                onChange={(event) => setFrequency(event.currentTarget.value)}
              >
                {!known && <option value={frequency}>Current rule</option>}
                {REPEATS.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Token budget per run">
              <Input
                type="number"
                min={1}
                value={budget}
                onChange={(event) => setBudget(event.currentTarget.value)}
              />
            </Field>
          </div>
          <div className="dialog-actions">
            {!!state.bindings.length && (
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              busy={state.busy}
              disabled={!selected.length || !instruction.trim()}
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
            <Button onClick={() => setForm(true)}>New schedule</Button>
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
                    · {binding.snapshot.blocks.length} blocks
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
                        type="button"
                        onClick={() => {
                          close();
                          edit(binding);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          void store.pause(binding);
                        }}
                      >
                        {binding.paused ? "Resume" : "Pause"}
                      </button>
                      <button
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
              disabled={state.busy}
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
                      disabled={state.busy}
                      onClick={() => void store.decide(run, true)}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={state.busy}
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

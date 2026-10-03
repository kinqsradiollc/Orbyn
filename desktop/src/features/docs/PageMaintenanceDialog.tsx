import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PageMaintenanceStore } from "@orbyn/api-client";
import {
  blockText,
  serializeDoc,
  type Doc,
  type MaintainedPageBinding,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import "./page-maintenance.css";

/** Scoped updates over the existing page; review always shows the saved proposal. */
export function PageMaintenanceDialog({
  id,
  onChanged,
  onClose,
}: {
  id: string;
  onChanged: (doc: Doc) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const store = useMemo(
    () =>
      new PageMaintenanceStore(
        client,
        id,
        () => session.get(),
        (doc) => changed.current(doc),
      ),
    [id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [showForm, setShowForm] = useState(true);
  useEffect(() => {
    if (state.bindings.length) setShowForm(false);
  }, [state.bindings.length]);
  const [selected, setSelected] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [frequency, setFrequency] = useState("FREQ=DAILY");
  const [editing, setEditing] = useState<MaintainedPageBinding>();
  useEffect(() => {
    dialog.current?.showModal();
    void store.prepare();
    return () => {
      dialog.current?.close();
      store.dispose();
    };
  }, [store]);
  const edit = (binding: MaintainedPageBinding) => {
    setShowForm(true);
    setEditing(binding);
    setSelected(binding.snapshot.blocks.map((block) => block.block_id));
    setInstruction(binding.instruction);
    setFrequency(binding.rrule);
  };
  return (
    <dialog
      ref={dialog}
      className="page-maintenance modal"
      aria-labelledby="page-maintenance-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!state.busy) onClose();
      }}
    >
      <header className="section-heading">
        <h2 id="page-maintenance-title">Page updates</h2>
        <button
          className="icon-button"
          aria-label="Close page updates"
          disabled={state.busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="page-maintenance-body">
        {state.error && <p role="alert">{state.error}</p>}
        {!state.doc && <p className="muted">Loading…</p>}
        {!showForm && (
          <button
            className="button"
            disabled={state.busy}
            onClick={() => {
              setEditing(undefined);
              setSelected([]);
              setInstruction("");
              setShowForm(true);
            }}
          >
            Add schedule
          </button>
        )}
        {showForm && (
          <>
            <section>
              <h3>{editing ? "Edit schedule" : "New schedule"}</h3>
              <p className="muted">
                Choose the blocks your assistant may update using your
                configured model.
              </p>
              <fieldset disabled={state.busy}>
                <legend>Blocks to maintain</legend>
                <div className="page-maintenance-blocks">
                  {state.doc?.content.map(
                    (block, index) =>
                      block.id && (
                        <label key={block.id}>
                          <input
                            type="checkbox"
                            checked={selected.includes(block.id)}
                            onChange={() =>
                              setSelected((ids) =>
                                ids.includes(block.id!)
                                  ? ids.filter((id) => id !== block.id)
                                  : [...ids, block.id!],
                              )
                            }
                          />
                          <span>
                            {index + 1}.{" "}
                            {blockText(block).slice(0, 140) || block.type}
                          </span>
                        </label>
                      ),
                  )}
                </div>
                <label>
                  Instructions
                  <textarea
                    value={instruction}
                    maxLength={4000}
                    onChange={(event) => setInstruction(event.target.value)}
                  />
                </label>
                <div
                  role="group"
                  aria-label="Repeat"
                  className="page-maintenance-actions"
                >
                  {["FREQ=DAILY", "FREQ=WEEKLY"].map((value) => (
                    <button
                      key={value}
                      className="button"
                      aria-pressed={frequency === value}
                      onClick={() => setFrequency(value)}
                    >
                      {value === "FREQ=DAILY" ? "Daily" : "Weekly"}
                    </button>
                  ))}
                </div>
                {!["FREQ=DAILY", "FREQ=WEEKLY"].includes(frequency) && (
                  <p className="muted">Current rule: {frequency}</p>
                )}
                <p className="muted">
                  Starts when enabled. Overnight handles these updates when
                  follow-through is enabled.
                </p>
                <button
                  className="button primary"
                  disabled={
                    !state.doc ||
                    !selected.length ||
                    selected.length > 100 ||
                    !instruction.trim()
                  }
                  onClick={() =>
                    void store.save(
                      {
                        instruction,
                        rrule: frequency,
                        timezone:
                          editing?.timezone ??
                          Intl.DateTimeFormat().resolvedOptions().timeZone,
                        next_run_at: new Date().toISOString(),
                        block_ids: selected,
                        expected_doc_version: state.doc!.version,
                        paused: false,
                      },
                      editing,
                    )
                  }
                >
                  {editing ? "Save and enable" : "Enable updates"}
                </button>
                {editing && (
                  <button
                    className="button"
                    onClick={() => {
                      setEditing(undefined);
                      setSelected([]);
                      setInstruction("");
                    }}
                  >
                    New schedule
                  </button>
                )}
              </fieldset>
            </section>
          </>
        )}
        {!showForm && (
          <>
            <section>
              <h3>Schedules</h3>
              {!state.bindings.length && (
                <p className="muted">No schedules yet.</p>
              )}
              {state.bindings.map((binding) => (
                <div className="page-maintenance-row" key={binding.id}>
                  <span>
                    {binding.instruction}
                    <small>
                      {binding.paused
                        ? "Paused"
                        : binding.schedule_exhausted
                          ? "Ended"
                          : binding.rrule}{" "}
                      · {binding.snapshot.blocks.length}{" "}
                      {binding.snapshot.blocks.length === 1
                        ? "block"
                        : "blocks"}
                    </small>
                  </span>
                  <details>
                    <summary aria-label="Schedule options">⋯</summary>
                    <button disabled={state.busy} onClick={() => edit(binding)}>
                      Edit
                    </button>
                    <button
                      disabled={state.busy}
                      onClick={() => void store.pause(binding)}
                    >
                      {binding.paused ? "Resume" : "Pause"}
                    </button>
                    <button
                      disabled={state.busy}
                      onClick={() => void store.remove(binding)}
                    >
                      Remove schedule
                    </button>
                  </details>
                </div>
              ))}
            </section>
            <section>
              <div className="section-heading">
                <h3>Recent runs</h3>
                <button
                  className="button"
                  disabled={state.busy}
                  onClick={() => void store.refresh()}
                >
                  Refresh
                </button>
              </div>
              {state.runs.map((run) => (
                <article key={run.id} className="page-maintenance-run">
                  <strong>
                    {run.lane === "overnight" ? "Overnight" : "Background"} ·{" "}
                    {run.state}
                  </strong>
                  <small>
                    {new Date(run.scheduled_for).toLocaleString()} ·{" "}
                    {run.estimated_tokens} estimated tokens
                  </small>
                  {run.error && <p>{run.error}</p>}
                  {run.can_review && run.replacements && (
                    <>
                      <h4>Proposed replacement blocks</h4>
                      <pre>{serializeDoc(run.replacements)}</pre>
                      <div className="page-maintenance-actions">
                        <button
                          className="button primary"
                          disabled={state.busy}
                          onClick={() => void store.decide(run, true)}
                        >
                          Apply update
                        </button>
                        <button
                          className="button"
                          disabled={state.busy}
                          onClick={() => void store.decide(run, false)}
                        >
                          Decline
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </dialog>
  );
}

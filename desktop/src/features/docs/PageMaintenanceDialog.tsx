import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useModalFocus } from "../../hooks/useModalFocus";
import { PageMaintenanceStore, watchDocRefresh } from "@orbyn/api-client";
import {
  blockText,
  DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET,
  maintainedPageTokenBudget,
  serializeDoc,
  type Doc,
  type MaintainedPageBinding,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import "./page-maintenance.css";

/** Scoped updates over the existing page; review always shows the saved proposal. */
export function PageMaintenanceDialog(
  props: Parameters<typeof PageMaintenanceBody>[0],
) {
  return <PageMaintenanceBody key={props.id} {...props} />;
}

function PageMaintenanceBody({
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
      new PageMaintenanceStore(
        client,
        id,
        () => session.get(),
        (doc) => changed.current(doc),
      ),
    [id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const focus = useModalFocus(onClose, state.busy);
  const [showForm, setShowForm] = useState(false);
  useEffect(() => {
    if (state.bindings.length) setShowForm(false);
  }, [state.bindings.length]);
  const [selected, setSelected] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [frequency, setFrequency] = useState("FREQ=DAILY");
  const [budget, setBudget] = useState(
    String(DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET),
  );
  const [editing, setEditing] = useState<MaintainedPageBinding>();
  useEffect(() => {
    (focus.ref.current as HTMLDialogElement)?.showModal();
    void store.prepare();
    return () => {
      (focus.ref.current as HTMLDialogElement)?.close();
      store.dispose();
    };
  }, [store]);
  useEffect(() => {
    const watcher = watchDocRefresh({
      api: client,
      id,
      session: () => session.get(),
      load: () => client.listPageMaintenanceRuns(id),
      received: store.receiveRuns,
      failed: store.receiveRunsError,
    });
    return watcher.dispose;
  }, [id, store]);
  const edit = (binding: MaintainedPageBinding) => {
    setShowForm(true);
    setEditing(binding);
    setSelected(binding.snapshot.blocks.map((block) => block.block_id));
    setInstruction(binding.instruction);
    setFrequency(binding.rrule);
    setBudget(
      String(binding.token_budget ?? DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET),
    );
  };
  return (
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      data-modal-owner={focus.id}
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
        {state.error && (
          <p role="alert">
            {state.error}{" "}
            <button
              className="text-button"
              disabled={state.busy}
              onClick={() =>
                void (state.doc ? store.refresh() : store.prepare())
              }
            >
              Retry
            </button>
          </p>
        )}
        {!state.doc && !state.error && (
          <p className="muted" role="status">
            Loading…
          </p>
        )}
        {!showForm && (
          <button
            className="secondary"
            disabled={state.busy || !state.doc}
            onClick={() => {
              setEditing(undefined);
              setSelected([]);
              setInstruction("");
              setFrequency("FREQ=DAILY");
              setBudget(String(DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET));
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
                Your configured model may update only the selected blocks.
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
                            {index + 1}. {blockText(block) || block.type}
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
                      className="secondary"
                      aria-pressed={frequency === value}
                      onClick={() => setFrequency(value)}
                    >
                      {value === "FREQ=DAILY" ? "Daily" : "Weekly"}
                    </button>
                  ))}
                </div>
                <label>
                  Tokens per update
                  <input
                    inputMode="numeric"
                    value={budget}
                    maxLength={5}
                    onChange={(event) => setBudget(event.target.value)}
                    aria-describedby="page-update-budget-help"
                  />
                </label>
                <p id="page-update-budget-help" className="muted">
                  1,000–20,000 estimated tokens. Overnight’s shared budget also
                  applies.
                </p>
                {!["FREQ=DAILY", "FREQ=WEEKLY"].includes(frequency) && (
                  <p className="muted">Current rule: {frequency}</p>
                )}
                <p className="muted">
                  Starts now; runs through Overnight when follow-through is
                  enabled.
                </p>
                <button
                  className="primary"
                  disabled={
                    !state.doc ||
                    !selected.length ||
                    selected.length > 100 ||
                    !instruction.trim() ||
                    !maintainedPageTokenBudget.safeParse(Number(budget)).success
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
                        token_budget: Number(budget),
                      },
                      editing,
                    )
                  }
                >
                  {editing ? "Save and enable" : "Enable updates"}
                </button>
                <button
                  className="secondary"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                {editing && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setEditing(undefined);
                      setSelected([]);
                      setInstruction("");
                      setFrequency("FREQ=DAILY");
                      setBudget(String(DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET));
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
              {state.doc && !state.bindings.length && (
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
                      {" · "}
                      {(
                        binding.token_budget ??
                        DEFAULT_MAINTAINED_PAGE_TOKEN_BUDGET
                      ).toLocaleString()}{" "}
                      tokens/update
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
                  className="secondary"
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
                  {run.can_review && (run.replacements || run.reply) && (
                    <>
                      <h4>
                        {run.reply
                          ? "Proposed reply"
                          : "Proposed replacement blocks"}
                      </h4>
                      <pre>
                        {run.reply ?? serializeDoc(run.replacements ?? [])}
                      </pre>
                      <div className="page-maintenance-actions">
                        <button
                          className="primary"
                          disabled={state.busy}
                          onClick={() => void store.decide(run, true)}
                        >
                          {run.reply ? "Post reply" : "Apply update"}
                        </button>
                        <button
                          className="secondary"
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

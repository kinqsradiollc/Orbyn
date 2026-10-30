import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RoutineSetupStore } from "@orbyn/api-client";
import {
  ASSISTANT_CHANGE_KINDS,
  describeRrule,
  type AgentRoutineInput,
  type ApprovalScopes,
  type AssistantChangeKind,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { CHANGE_KIND_LABELS } from "./assistant-labels";
const binding = () => {
  const b = session.binding();
  return `${b.generation}:${b.token}`;
};
export function RoutineSetupReview({
  input,
  active = true,
  ruleLabel,
  onBack,
  onSaved,
  onBusy,
  onUncertain,
  onCheckUpcoming,
}: {
  input: AgentRoutineInput;
  active?: boolean;
  ruleLabel: (rule: ApprovalScopes[AssistantChangeKind]) => string;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onUncertain: (value: boolean) => void;
  onCheckUpcoming: () => void;
}) {
  const [store] = useState(
    () =>
      new RoutineSetupStore(client, input, () => crypto.randomUUID(), binding),
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.load();
    return () => store.dispose();
  }, [store]);
  useEffect(() => onBusy(state.saving), [state.saving, onBusy]);
  useEffect(() => onUncertain(state.uncertain), [state.uncertain, onUncertain]);
  const reported = useRef(false);
  useEffect(() => {
    if (active && state.result && !reported.current) {
      reported.current = true;
      void onSaved();
    }
  }, [active, state.result, onSaved]);
  const save = () => store.save();
  return (
    <section className="settings-subform" aria-label="Review routine setup">
      <h3>Review routine</h3>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {input.instruction}
      </p>
      <p>
        {describeRrule(input.rrule)} ·{" "}
        {new Date(input.next_run_at).toLocaleString()} · {input.timezone}
      </p>
      <h4>Execution scope</h4>
      <p>
        Uses your assistant’s current access across all permitted projects and
        spaces. Its existing rules still apply.
      </p>
      {state.loading && <p role="status">Loading current permissions…</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {state.context && (
        <>
          <p>
            Each run has a maximum of{" "}
            {state.context.max_run_tokens.toLocaleString()} tokens. Account and
            Overnight limits can stop it sooner. Retries are off until you
            configure recovery.
          </p>
          <details>
            <summary>Automatic changes · optional</summary>
            <p>
              Unchecked categories keep their saved settings. “Always”
              permissions still apply. Sensitive actions follow your current
              assistant rules.
            </p>
            {!state.context.can_preauthorize && (
              <p>
                Automatic permissions are unavailable with your current
                assistant access. You can still save the schedule.
              </p>
            )}
            {ASSISTANT_CHANGE_KINDS.map((kind) => {
              const prior = state.context!.approval_scopes[kind],
                selected = state.selected.includes(kind);
              return (
                <div className="settings-field" key={kind}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={
                        !state.context!.can_preauthorize ||
                        state.saving ||
                        state.uncertain ||
                        !!state.result
                      }
                      checked={selected}
                      onChange={(event) =>
                        store.select(kind, event.target.checked)
                      }
                    />{" "}
                    Allow {CHANGE_KIND_LABELS[kind].toLowerCase()} for this
                    routine
                  </label>
                  {prior && (
                    <small>Saved permission: {ruleLabel(prior)}.</small>
                  )}
                  {selected && prior && (
                    <small role="status">
                      Replaces this category’s saved permission. The previous
                      goal, routine or Always setting will use normal approval
                      checks.
                    </small>
                  )}
                </div>
              );
            })}
          </details>
        </>
      )}
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          disabled={state.saving || state.uncertain}
          onClick={onBack}
        >
          Back to schedule
        </button>
        {!state.context && !state.loading && (
          <button
            type="button"
            className="secondary"
            onClick={() => void store.load()}
          >
            Reload permissions
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={
            !state.context || state.loading || state.saving || !!state.result
          }
          onClick={() => void save()}
        >
          {state.saving
            ? "Saving…"
            : state.uncertain
              ? "Check and retry same save"
              : "Add routine"}
        </button>
        {state.uncertain && (
          <button
            type="button"
            className="secondary"
            disabled={state.saving}
            onClick={onCheckUpcoming}
          >
            Close and check Upcoming
          </button>
        )}
      </div>
    </section>
  );
}

import { RoutineSetupStore } from "@orbyn/api-client";
import {
  ASSISTANT_CHANGE_KINDS,
  describeRrule,
  type AgentRoutineInput,
  type ApprovalScopes,
  type AssistantChangeKind,
} from "@orbyn/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { client, getToken } from "../../../lib/session";
import { Button, ErrorNotice, Field, Input } from "../../../ui/kit";
import { Check, More } from "../parts";
import { CHANGE_KINDS, uuid } from "../words";

/** Review the schedule, limits and optional permissions together, once. */
export function RoutineSetup({
  input,
  ruleLabel,
  onBack,
  onSaved,
  onBusy,
  onUncertain,
  onCheck,
}: {
  input: AgentRoutineInput;
  ruleLabel: (rule: ApprovalScopes[AssistantChangeKind]) => string;
  onBack: () => void;
  onSaved: () => void;
  onBusy: (busy: boolean) => void;
  onUncertain: (value: boolean) => void;
  onCheck: () => void;
}) {
  const [store] = useState(
    () => new RoutineSetupStore(client, input, uuid, getToken),
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
    if (state.result && !reported.current) {
      reported.current = true;
      onSaved();
    }
  }, [state.result, onSaved]);
  const frozen = state.saving || state.uncertain;
  return (
    <section className="agents-stack" aria-label="Review routine setup">
      <p className="agents-prewrap" dir="auto">
        {input.instruction}
      </p>
      <p className="muted small">
        {describeRrule(input.rrule)} ·{" "}
        {new Date(input.next_run_at).toLocaleString()} · {input.timezone}
      </p>
      <h3>Execution scope</h3>
      <p className="small">
        Uses your assistant's current access across all permitted projects and
        spaces. Its existing rules still apply.
      </p>
      {state.loading && (
        <p className="muted small" role="status">
          Loading current permissions…
        </p>
      )}
      {state.error && <ErrorNotice message={state.error} />}
      {state.context && (
        <>
          <h3>Limits for each automatic attempt</h3>
          <div className="agents-pair">
            <Field
              label={`Token allowance (1–${state.context.max_run_tokens.toLocaleString()})`}
            >
              <Input
                type="number"
                min={1}
                max={state.context.max_run_tokens}
                value={state.runLimits.token_limit}
                disabled={frozen}
                onChange={(event) =>
                  store.setRunLimits({
                    ...state.runLimits,
                    token_limit: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field
              label={`Active AI work in minutes (1–${state.context.max_active_work_minutes})`}
            >
              <Input
                type="number"
                min={1}
                max={state.context.max_active_work_minutes}
                value={state.runLimits.active_work_minutes}
                disabled={frozen}
                onChange={(event) =>
                  store.setRunLimits({
                    ...state.runLimits,
                    active_work_minutes: Number(event.target.value),
                  })
                }
              />
            </Field>
          </div>
          <p className="muted small">
            Active AI work time counts while the attempt runs, including
            resumes. Queueing and waiting for your decision do not use this
            allowance. Account, Overnight and recovery limits can stop work
            sooner.
          </p>
          <p className="muted small">
            Approving an existing saved plan uses its separate short
            finalization window. These limits do not enable retries or new
            permissions.
          </p>
          <More summary="Automatic changes · optional">
            <p className="muted small">
              Unchecked categories keep their saved settings. "Always"
              permissions still apply. Sensitive actions follow your current
              assistant rules.
            </p>
            {!state.context.can_preauthorize && (
              <p className="small">
                Automatic permissions are unavailable with your current
                assistant access. You can still save the schedule.
              </p>
            )}
            {ASSISTANT_CHANGE_KINDS.map((kind) => {
              const prior = state.context!.approval_scopes[kind];
              const selected = state.selected.includes(kind);
              return (
                <div key={kind} className="agents-stack">
                  <Check
                    label={`Allow ${CHANGE_KINDS[kind].toLowerCase()} for this routine`}
                    checked={selected}
                    disabled={
                      !state.context!.can_preauthorize ||
                      frozen ||
                      !!state.result
                    }
                    onChange={(event) =>
                      store.select(kind, event.target.checked)
                    }
                  />
                  {prior && (
                    <p className="muted small">
                      Saved permission: {ruleLabel(prior)}.
                    </p>
                  )}
                  {selected && prior && (
                    <p className="small" role="status">
                      Replaces this category's saved permission. The previous
                      goal, routine or Always setting will use normal approval
                      checks.
                    </p>
                  )}
                </div>
              );
            })}
          </More>
        </>
      )}
      <div className="agents-buttons agents-end">
        <Button variant="ghost" disabled={frozen} onClick={onBack}>
          Back to schedule
        </Button>
        {!state.context && !state.loading && (
          <Button onClick={() => void store.load()}>Reload permissions</Button>
        )}
        {state.uncertain && (
          <Button disabled={state.saving} onClick={onCheck}>
            Close and check Upcoming
          </Button>
        )}
        <Button
          variant="primary"
          busy={state.saving}
          disabled={!state.context || state.loading || !!state.result}
          onClick={() => void store.save()}
        >
          {state.saving
            ? "Saving…"
            : state.uncertain
              ? "Check and retry same save"
              : "Add routine"}
        </Button>
      </div>
    </section>
  );
}

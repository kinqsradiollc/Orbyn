import { HttpError, type AssistantBudgetView } from "@orbyn/core";
import { messageOf } from "../../lib/resource";
import { useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  useConfirm,
} from "../../ui/kit";
import {
  useOwned,
  LANE_NAME,
  useAgentEditorState,
  type AgentEditorState,
  type Lane,
} from "./hooks";
import { More } from "./parts";

const FIELDS = [
  {
    key: "daily_token_limit",
    label: "Daily tokens",
    min: 1000,
    max: 10_000_000,
  },
  { key: "hourly_start_limit", label: "Starts per hour", min: 1, max: 100 },
  {
    key: "per_run_token_limit",
    label: "Tokens per run",
    min: 1000,
    max: 200_000,
  },
] as const;
type Key = (typeof FIELDS)[number]["key"];

/** A lane's own work limits. Estimates govern Orbyn work, not provider billing. */
type LimitsProps = {
  lane: Lane;
  onClose: () => void;
  onSaved?: () => void;
  onStateChange?: (state: AgentEditorState) => void;
};
export function LimitsDialog(props: LimitsProps) {
  return <LimitsBody key={props.lane} {...props} />;
}
function LimitsBody({ lane, onClose, onSaved, onStateChange }: LimitsProps) {
  const owned = useOwned();
  const confirm = useConfirm();
  const pending = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [budget, setBudget] = useState<AssistantBudgetView | null>(null);
  const [draft, setDraft] = useState<Record<Key, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false),
    [fresh, setFresh] = useState(true),
    [observed, setObserved] = useState<AssistantBudgetView | null>(null);
  const uncertainRef = useRef(false);
  const submitted = useRef<Pick<AssistantBudgetView, "revision" | Key> | null>(
    null,
  );

  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    if (!owned()) return;
    setError("");
    setBudget(null);
    setDraft(null);
    setLoadFailed(false);
    void client.assistantBudgets().then(
      (all) => {
        if (!live || !owned()) return;
        setFresh(true);
        setObserved(null);
        const one = all[lane];
        setBudget(one);
        setDraft({
          daily_token_limit: String(one.daily_token_limit),
          hourly_start_limit: String(one.hourly_start_limit),
          per_run_token_limit: String(one.per_run_token_limit),
        });
      },
      () => {
        if (live && owned()) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane, attempt]);

  const dirty =
    !!budget &&
    !!draft &&
    FIELDS.some(({ key }) => draft[key] !== String(budget[key]));
  useAgentEditorState(onStateChange, {
    dirty,
    pending: saving || confirming,
    uncertain,
  });
  const locked = saving || confirming || uncertain;
  const leave = async (reload = false) => {
    if (!owned() || pending.current || uncertainRef.current) return;
    pending.current = true;
    setConfirming(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: reload ? "Reload limits?" : "Discard limit changes?",
          body: "Your unsaved limits will be lost.",
          action: reload ? "Reload" : "Discard",
          danger: true,
        }))
      )
        return;
      if (!owned()) return;
      if (reload) setAttempt((n) => n + 1);
      else onClose();
    } finally {
      pending.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const save = async () => {
    if (
      !owned() ||
      !budget ||
      !draft ||
      !dirty ||
      pending.current ||
      uncertainRef.current ||
      !fresh
    )
      return;
    const values = Object.fromEntries(
      FIELDS.map(({ key }) => [key, Number(draft[key])]),
    ) as Record<Key, number>;
    if (
      FIELDS.some(
        ({ key, min, max }) =>
          !Number.isInteger(values[key]) ||
          values[key] < min ||
          values[key] > max,
      )
    ) {
      setError("Check the limit values.");
      return;
    }
    const input = Object.freeze({ revision: budget.revision, ...values });
    submitted.current = input;
    setObserved(null);
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await client.replaceAssistantBudget(lane, input);
      if (!owned()) return;
      if (
        submitted.current !== input ||
        saved.lane !== lane ||
        saved.revision !== input.revision + 1 ||
        FIELDS.some(({ key }) => saved[key] !== input[key])
      )
        throw new Error(
          "The saved limits receipt does not match this change. Check saved state.",
        );
      onSaved?.();
      if (owned()) onClose();
    } catch (failure) {
      if (owned()) {
        const unknown =
          !(failure instanceof HttpError) ||
          failure.statusCode >= 500 ||
          [408, 429].includes(failure.statusCode);
        uncertainRef.current = unknown;
        setUncertain(unknown);
        setFresh(false);
        setError(
          messageOf(failure, "Couldn't save limits. Your draft is kept."),
        );
      }
    } finally {
      pending.current = false;
      if (owned()) setSaving(false);
    }
  };
  const checkSaved = async () => {
    const input = submitted.current;
    if (!owned() || pending.current || !uncertainRef.current || !input) return;
    pending.current = true;
    setSaving(true);
    try {
      const saved = await client.assistantBudgets().then((all) => all[lane]);
      if (owned() && submitted.current === input) {
        if (saved.lane !== lane)
          throw new Error("These limits belong to another runtime.");
        setObserved(saved);
        if (saved.revision <= input.revision)
          setError(
            "The saved revision has not advanced. The earlier request may still commit; keep checking before leaving.",
          );
        else setError("");
      }
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't check the saved limits."));
    } finally {
      pending.current = false;
      if (owned()) setSaving(false);
    }
  };
  const canAdopt =
    !!observed &&
    !!submitted.current &&
    observed.lane === lane &&
    observed.revision > submitted.current.revision;
  const keepSaved = async () => {
    const input = submitted.current;
    if (
      !owned() ||
      pending.current ||
      !observed ||
      !uncertainRef.current ||
      !input ||
      !canAdopt
    )
      return;
    const saved = observed;
    pending.current = true;
    setConfirming(true);
    try {
      if (
        !(await confirm({
          title: "Use saved limits?",
          body: "Discard this local draft and keep the current saved version. This does not prove which request saved it.",
          action: "Use saved limits",
          danger: true,
        }))
      )
        return;
      if (
        !owned() ||
        observed !== saved ||
        submitted.current !== input ||
        saved.lane !== lane ||
        saved.revision <= input.revision
      )
        return;
      uncertainRef.current = false;
      setUncertain(false);
      onSaved?.();
      if (owned()) onClose();
    } finally {
      pending.current = false;
      if (owned()) setConfirming(false);
    }
  };
  return (
    <Dialog
      title={`${LANE_NAME[lane]} limits`}
      onClose={() => void leave()}
      actions={
        draft && (
          <>
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() => void leave()}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={saving}
              disabled={confirming || uncertain || !fresh || !dirty}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save limits"}
            </Button>
          </>
        )
      }
    >
      {loadFailed && (
        <ErrorNotice
          message="Couldn't load limits."
          onRetry={() => void leave(true)}
        />
      )}
      {!budget && !loadFailed && <Loading label="Loading limits" />}
      {budget && draft && (
        <>
          <p className="muted small">
            {budget.estimated_tokens.toLocaleString()} /{" "}
            {budget.daily_token_limit.toLocaleString()} estimated tokens today ·{" "}
            {budget.starts_last_hour} / {budget.hourly_start_limit} starts this
            hour · {budget.active_reserved_tokens.toLocaleString()} tokens
            reserved
          </p>
          {error && (
            <>
              <ErrorNotice message={error} />
              <Button disabled={locked} onClick={() => void leave(true)}>
                Reload latest limits
              </Button>
            </>
          )}
          {uncertain && (
            <div>
              <p>
                The save is unconfirmed. Your draft is kept and cannot be sent
                again.
              </p>
              <Button
                disabled={saving || confirming}
                onClick={() => void checkSaved()}
              >
                Check saved limits
              </Button>
              {observed && (
                <>
                  <details>
                    <summary>Current saved limits</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(observed, null, 2)}
                    </pre>
                  </details>
                  <Button
                    disabled={saving || confirming || !canAdopt}
                    onClick={() => void keepSaved()}
                  >
                    Use saved limits
                  </Button>
                </>
              )}
            </div>
          )}
          {FIELDS.map(({ key, label, min, max }) => (
            <Field key={key} label={label}>
              <Input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={draft[key]}
                disabled={locked}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              />
            </Field>
          ))}
          <More summary="About these numbers">
            <p className="muted small">
              Estimates control Orbyn work. Provider usage and billing are
              separate.
            </p>
          </More>
        </>
      )}
    </Dialog>
  );
}

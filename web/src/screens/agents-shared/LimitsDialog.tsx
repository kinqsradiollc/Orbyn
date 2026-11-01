import type { AssistantBudgetView } from "@orbyn/core";
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
import { useOwned, LANE_NAME, type Lane } from "./hooks";
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
export function LimitsDialog({
  lane,
  onClose,
  onSaved,
}: {
  lane: Lane;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const owned = useOwned();
  const confirm = useConfirm();
  const pending = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [budget, setBudget] = useState<AssistantBudgetView | null>(null);
  const [draft, setDraft] = useState<Record<Key, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
  const locked = saving || confirming;
  const leave = async (reload = false) => {
    if (!owned() || pending.current) return;
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
    if (!owned() || !budget || !draft || !dirty || pending.current) return;
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
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await client.replaceAssistantBudget(lane, {
        revision: budget.revision,
        ...values,
      });
      if (!owned()) return;
      onSaved?.();
      if (owned()) onClose();
    } catch {
      if (owned())
        setError(
          "Couldn't save limits. Your draft is kept. Retry, or reload the latest limits.",
        );
    } finally {
      pending.current = false;
      if (owned()) setSaving(false);
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
              disabled={confirming || !dirty}
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

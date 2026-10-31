import type { AssistantBudgetView } from "@orbyn/core";
import { useEffect, useState } from "react";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
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
}: {
  lane: Lane;
  onClose: () => void;
}) {
  const owned = useOwned();
  const [budget, setBudget] = useState<AssistantBudgetView | null>(null);
  const [draft, setDraft] = useState<Record<Key, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
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
  const save = async () => {
    if (!budget || !draft || saving) return;
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
    setSaving(true);
    setError("");
    try {
      await client.replaceAssistantBudget(lane, {
        revision: budget.revision,
        ...values,
      });
      if (owned()) onClose();
    } catch {
      if (owned())
        setError(
          "Couldn't save limits. Your draft is kept. Retry, or reload the latest limits.",
        );
    } finally {
      if (owned()) setSaving(false);
    }
  };
  return (
    <Dialog
      title={`${LANE_NAME[lane]} limits`}
      onClose={() => {
        if (!saving) onClose();
      }}
      actions={
        draft && (
          <>
            <Button variant="ghost" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={saving}
              disabled={!dirty}
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
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {!budget && !loadFailed && <Loading label="Loading limits" />}
      {budget && draft && (
        <>
          <p className="muted small">
            {budget.estimated_tokens.toLocaleString()} /{" "}
            {budget.daily_token_limit.toLocaleString()} estimated tokens today ·{" "}
            {budget.starts_last_hour} / {budget.hourly_start_limit} starts this
            hour
          </p>
          {error && (
            <ErrorNotice
              message={error}
              onRetry={
                error.startsWith("Couldn't")
                  ? () => setAttempt((n) => n + 1)
                  : undefined
              }
            />
          )}
          {FIELDS.map(({ key, label, min, max }) => (
            <Field key={key} label={label}>
              <Input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={draft[key]}
                disabled={saving}
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

import { useEffect, useState } from "react";
import type { AssistantBudgetView } from "@orbyn/core";
import { client } from "../../lib/api";
import { SettingsSection } from "./SettingsSection";
import "./assistant-rules.css";

type Lane = "background" | "overnight";
type Budgets = Record<Lane, AssistantBudgetView>;
type Draft = {
  daily_token_limit: string;
  hourly_start_limit: string;
  per_run_token_limit: string;
};
const fields: { key: keyof Draft; label: string; min: number; max: number }[] =
  [
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
  ];
const draftOf = (budget: AssistantBudgetView): Draft => ({
  daily_token_limit: String(budget.daily_token_limit),
  hourly_start_limit: String(budget.hourly_start_limit),
  per_run_token_limit: String(budget.per_run_token_limit),
});

export function AssistantBudgetSettings({ userId }: { userId: string }) {
  const [budgets, setBudgets] = useState<Budgets | null>(null);
  const [lane, setLane] = useState<Lane>("background");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    setBudgets(null);
    setDraft(null);
    if (!userId) return;
    void client.assistantBudgets().then(
      (value) => live && setBudgets(value),
      () => live && setError("Couldn't load limits."),
    );
    return () => {
      live = false;
    };
  }, [userId]);
  const current = budgets?.[lane];
  const save = async () => {
    if (!current || !draft || busy) return;
    const values = Object.fromEntries(
      fields.map(({ key }) => [key, Number(draft[key])]),
    ) as Record<keyof Draft, number>;
    if (
      fields.some(
        ({ key, min, max }) =>
          !Number.isInteger(values[key]) ||
          values[key] < min ||
          values[key] > max,
      )
    ) {
      setError("Check the limit values.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await client.replaceAssistantBudget(lane, {
        revision: current.revision,
        ...values,
      });
      setBudgets((before) => before && { ...before, [lane]: updated });
      setDraft(null);
      setNotice("Limits saved");
    } catch {
      setError("Couldn't save limits. Reload if they changed elsewhere.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection className="card settings-card assistant-budget-settings">
      <h2>Work limits</h2>
      <div className="assistant-budget-lanes" role="group" aria-label="Agent">
        {(["background", "overnight"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={option === lane ? "primary" : "secondary"}
            aria-pressed={option === lane}
            onClick={() => {
              setLane(option);
              setDraft(null);
              setError("");
              setNotice("");
            }}
          >
            {option === "background" ? "Background" : "Overnight"}
          </button>
        ))}
      </div>
      {current ? (
        <>
          <p className="muted assistant-budget-summary">
            {current.estimated_tokens.toLocaleString()} /{" "}
            {current.daily_token_limit.toLocaleString()} estimated tokens today
            · {current.starts_last_hour} / {current.hourly_start_limit} starts
            this hour
          </p>
          {draft ? (
            <div className="assistant-budget-fields">
              {fields.map(({ key, label, min, max }) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    value={draft[key]}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft(
                        (old) => old && { ...old, [key]: event.target.value },
                      )
                    }
                  />
                </label>
              ))}
              <div className="assistant-rule-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "Saving…" : "Save limits"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => setDraft(draftOf(current))}
            >
              Edit limits
            </button>
          )}
        </>
      ) : (
        <p className="muted">{error || "Loading limits…"}</p>
      )}
      {error && current && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
      <details>
        <summary>About these numbers</summary>
        <p className="muted">
          Estimates control Orbyn work. Provider usage and billing are separate.
        </p>
      </details>
    </SettingsSection>
  );
}

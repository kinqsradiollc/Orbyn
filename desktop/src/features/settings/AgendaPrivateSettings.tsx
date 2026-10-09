import { agendaPrivateSummaryText } from "@orbyn/core";
import { useAgendaPrivateSettings } from "../../hooks/useAgendaPrivateSettings";
/** Explicit scheduled use is separate from morning emails and interactive requests. */
export function AgendaPrivateSettings({ userId }: { userId: string }) {
  const { data, error, busy, canEnable, enablementMessage, save, refresh } =
    useAgendaPrivateSettings(userId);
  return (
    <section
      className="settings-subform"
      aria-label="Scheduled Agenda summaries"
    >
      <h3>Morning summary</h3>
      <p className="muted">
        Uses your ChatGPT plan. Keep Orbyn desktop online for morning summaries.
      </p>
      {!data && !error && <p role="status">Loading summary settings…</p>}
      {data && (
        <>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              role="switch"
              className="ai-switch"
              checked={data.permission.enabled}
              disabled={busy || (!data.permission.enabled && !canEnable)}
              onChange={(e) => void save(e.target.checked)}
            />
            Use ChatGPT
          </label>
          {data.permission.enabled && (
            <p className="muted">
              {data.permission.active
                ? `On · ${data.permission.model}`
                : "Review your model choice to resume."}
            </p>
          )}
          {!canEnable && !data.permission.active && (
            <small className="field-hint">{enablementMessage}</small>
          )}
          {data.permission.enabled && !data.permission.active && (
            <button
              type="button"
              className="secondary"
              disabled={busy || !canEnable}
              onClick={() => void save(true)}
            >
              Use reviewed model
            </button>
          )}
          {canEnable && data.permission.enabled && (
            <small className="field-hint">
              {data.catalog?.preference.model} ·{" "}
              {data.choice.fallback_to_default
                ? "Orbyn fallback"
                : "No fallback"}
            </small>
          )}
          {data.permission.enabled && (
            <p role="status">
              {data.summary.run ? `${data.summary.run.local_day} · ` : ""}
              {agendaPrivateSummaryText(data.summary)}
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {(data?.permission.enabled || error) && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={refresh}
        >
          Refresh summary
        </button>
      )}
    </section>
  );
}

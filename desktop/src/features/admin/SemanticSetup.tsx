import { useEffect, useState } from "react";
import { Check, Circle, ChevronDown } from "lucide-react";
import { AI_PROVIDERS, type AiProvider, type AiSettings } from "@orbyn/core";
import { Select } from "../../components/Select";
import { client } from "../../lib/api";
import { useEmbeddingModelCatalog } from "../../hooks/useEmbeddingModelCatalog";

/**
 * Search by meaning's own setup, apart from the assistant: off by default.
 * Turning it on needs the pgvector database image, the measuring service, a
 * model that measures text, and the admin's agreement that every page
 * (except those in projects kept out of the assistant) is sent to the
 * provider to be measured. Without it, word search works as always.
 */
export function SemanticSetup({
  settings,
  providers,
  busy,
  act,
  onChanged,
}: {
  settings: AiSettings | undefined;
  providers: AiProvider[];
  busy: boolean;
  act: (fn: () => Promise<void>) => void;
  onChanged: () => Promise<void>;
}) {
  const [model, setModel] = useState(settings?.embedding_model ?? "");
  const [accept, setAccept] = useState(false);
  const [providerId, setProviderId] = useState(
    settings?.embedding_provider_id ?? "",
  );
  useEffect(() => {
    setModel(settings?.embedding_model ?? "");
    setProviderId(settings?.embedding_provider_id ?? "");
    setAccept(false);
  }, [
    settings?.embedding_model,
    settings?.embedding_provider_id,
    settings?.embedding_generation,
  ]);
  const selected = providers.find((provider) => provider.id === providerId);
  const discovery = useEmbeddingModelCatalog(selected);
  useEffect(() => {
    setAccept(false);
  }, [selected?.id, selected?.embedding_revision, selected?.enabled]);
  if (!settings) return null;
  const eligible = providers.filter(
    (provider) =>
      provider.enabled && AI_PROVIDERS[provider.kind].format !== "anthropic",
  );
  const providerName = providers.find(
    (provider) => provider.id === settings.embedding_provider_id,
  )?.name;
  const on = settings.semantic_search && !!settings.semantic_accepted_at;
  const steps: { done: boolean; text: string }[] = [
    {
      done: settings.semantic_possible,
      text: settings.semantic_possible
        ? "The database can store measurements."
        : "Database measurements are unavailable.",
    },
    {
      done: !!settings.measure_running,
      text: settings.measure_running
        ? "The measuring service is running."
        : "The measuring service is offline.",
    },
    {
      done:
        !!selected && eligible.some((provider) => provider.id === selected.id),
      text:
        selected && eligible.some((provider) => provider.id === selected.id)
          ? "An independent embedding provider is selected."
          : "Select an embedding provider.",
    },
  ];
  const ready = !!selected?.embedding_revision && steps.every((s) => s.done);
  const change = (next: boolean) =>
    act(async () => {
      try {
        await client.setSemanticSearch(
          next
            ? {
                on: true,
                embedding_model: model.trim(),
                embedding_provider_id: providerId,
                expected_generation: settings.embedding_generation,
                expected_provider_revision: selected?.embedding_revision,
                accept,
              }
            : { on: false, expected_generation: settings.embedding_generation },
        );
      } finally {
        setAccept(false);
        await onChanged();
      }
    });
  return (
    <details
      className="card semantic-setup fade-up"
      open={on || settings.embedding_needs_validation}
    >
      <summary className="semantic-summary">
        <strong>Search by meaning</strong>
        <span>
          {on
            ? "On"
            : settings.embedding_needs_validation
              ? "Validation needed"
              : "Off"}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <p className="muted">
        Uses an embedding provider to index pages. Projects and teams kept out
        of the assistant are excluded.
      </p>
      <ul className="semantic-steps">
        {steps.map((step) => (
          <li key={step.text} className={step.done ? "is-done" : ""}>
            {step.done ? (
              <Check size={14} aria-label="Done" />
            ) : (
              <Circle size={14} aria-label="Not yet" />
            )}
            <span>{step.text}</span>
          </li>
        ))}
      </ul>
      {settings.embedding_needs_validation && (
        <p role="status" className="muted">
          The saved provider changed or was removed. Select a provider and
          validate it again before any more page text is sent.
        </p>
      )}
      {on ? (
        <div className="semantic-on">
          <p role="status">
            {typeof settings.embedding_indexed_pages === "number" &&
            typeof settings.embedding_pending_pages === "number"
              ? `${settings.embedding_indexed_pages} pages measured; ${settings.embedding_pending_pages} pages waiting.`
              : "Indexing status is unavailable. Refresh to check again."}
            {!settings.measure_running &&
              " The measuring service is offline; queued pages will wait until it starts."}
          </p>
          {!!settings.embedding_failed_pages && (
            <p role="status" className="muted">
              {settings.embedding_failed_pages} pages could not be measured.
              {settings.embedding_next_retry_at
                ? ` Next retry due ${new Date(settings.embedding_next_retry_at).toLocaleString()}.`
                : " Retry time is unavailable."}{" "}
              Check the provider and measuring service if failures continue.
            </p>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => act(onChanged)}
          >
            Refresh indexing status
          </button>
          <p>
            Measuring with <strong>{settings.embedding_model}</strong>
            {providerName ? ` on ${providerName}` : ""}. Turned on{" "}
            {new Date(settings.semantic_accepted_at!).toLocaleDateString()}.{" "}
            {settings.embedding_dimensions
              ? `${settings.embedding_dimensions} dimensions verified.`
              : ""}
            {settings.embedding_search_strategy === "exact" &&
              " Exact vector search."}
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => change(false)}
          >
            Turn off and forget the measurements
          </button>
        </div>
      ) : (
        <form
          className="semantic-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && accept && model.trim()) change(true);
          }}
        >
          <label>
            Embedding provider
            <Select
              value={providerId}
              disabled={busy}
              onChange={(event) => {
                setProviderId(event.target.value);
                setModel("");
                setAccept(false);
              }}
            >
              <option value="">Choose a provider</option>
              {eligible.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </Select>
          </label>
          {!eligible.length && (
            <p className="muted">
              Add and enable an OpenAI-compatible or Azure provider below. Chat
              can remain off.
            </p>
          )}
          <label>
            Model that measures text
            <input
              value={model}
              maxLength={200}
              placeholder="text-embedding-3-small"
              disabled={
                busy || !selected?.enabled || !selected.embedding_revision
              }
              onChange={(e) => {
                setModel(e.target.value);
                setAccept(false);
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={
              busy ||
              discovery.loading ||
              !selected?.enabled ||
              !selected.embedding_revision
            }
            onClick={() => void discovery.load()}
          >
            {discovery.loading
              ? "Loading models…"
              : "Load embedding model catalog"}
          </button>
          {discovery.error && (
            <p role="alert" className="muted">
              {discovery.error}
            </p>
          )}
          {discovery.catalog && (
            <>
              <p className="muted">
                {discovery.catalog.catalog_kind === "manual"
                  ? "Type the deployment or model name manually."
                  : discovery.catalog.catalog_kind === "unclassified"
                    ? "Provider models. Embedding support is checked when you validate."
                    : "Embedding models. Dimensions are checked when you validate."}
              </p>
              {discovery.catalog.models.length > 0 ? (
                <label>
                  Choose a catalog model
                  <Select
                    searchable
                    value={model}
                    disabled={busy}
                    onChange={(event) => {
                      setModel(event.target.value);
                      setAccept(false);
                    }}
                  >
                    <option value="">Choose a model</option>
                    {model && !discovery.catalog.models.includes(model) && (
                      <option value={model}>{model} (manual)</option>
                    )}
                    {discovery.catalog.models.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : (
                discovery.catalog.catalog_kind !== "manual" && (
                  <p className="muted">
                    No models returned. You can type a model manually.
                  </p>
                )
              )}
            </>
          )}
          <label className="check-line">
            <input
              type="checkbox"
              checked={accept}
              disabled={!ready}
              onChange={(e) => setAccept(e.target.checked)}
            />
            <span>
              I understand that the words of every page in this workspace
              (except projects and teams kept out of the assistant) are sent to{" "}
              {selected?.name ?? "the selected embedding provider"} to be
              measured, and that this is described in the Privacy Policy.
            </span>
          </label>
          <button
            className="primary"
            disabled={busy || !ready || !accept || !model.trim()}
          >
            Validate and turn on search by meaning
          </button>
        </form>
      )}
    </details>
  );
}

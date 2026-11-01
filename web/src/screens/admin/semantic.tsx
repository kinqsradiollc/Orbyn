import { useEffect, useState } from "react";
import { AI_PROVIDERS, type AiProvidersResponse } from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, SelectBox } from "../../ui/kit";
import { Facts, Outcome, useExit, useOperation } from "./shared";
export function Semantic({
  data,
  refresh,
}: {
  data: AiProvidersResponse;
  refresh: () => Promise<void>;
}) {
  const op = useOperation("ai:manage"),
    settings = data.settings,
    [id, setId] = useState(settings.embedding_provider_id || ""),
    [model, setModel] = useState(settings.embedding_model || ""),
    [accept, setAccept] = useState(false),
    [candidates, setCandidates] = useState<string[]>([]),
    [kind, setKind] = useState(""),
    provider = data.providers.find((p) => p.id === id),
    eligible = data.providers.filter(
      (p) => p.enabled && AI_PROVIDERS[p.kind].format !== "anthropic",
    ),
    generation = settings.embedding_generation,
    revision = provider?.embedding_revision;
  const dirty =
    id !== (settings.embedding_provider_id || "") ||
    model !== (settings.embedding_model || "") ||
    accept;
  useExit({ dirty });
  useEffect(() => {
    setAccept(false);
    setCandidates([]);
    setKind("");
  }, [id, revision, generation]);
  const ready =
    !!settings.semantic_possible &&
    !!settings.measure_running &&
    !!provider?.enabled &&
    eligible.some((p) => p.id === id) &&
    !!revision &&
    !!generation;
  return (
    <section className="admin-detail">
      <h3>Search by meaning</h3>
      <Facts
        value={{
          on: settings.semantic_search,
          possible: settings.semantic_possible,
          worker_running: settings.measure_running,
          provider_id: settings.embedding_provider_id,
          model: settings.embedding_model,
          dimensions: settings.embedding_dimensions,
          strategy: settings.embedding_search_strategy,
          generation,
          needs_validation: settings.embedding_needs_validation,
          accepted_at: settings.semantic_accepted_at,
          pending_pages: settings.embedding_pending_pages,
          indexed_pages: settings.embedding_indexed_pages,
          failed_pages: settings.embedding_failed_pages,
          next_retry_at: settings.embedding_next_retry_at,
        }}
      />
      {!settings.semantic_possible && (
        <p role="status">
          The database does not currently support semantic search.
        </p>
      )}
      {!settings.measure_running && (
        <p role="status">
          The measurement worker is not running. Enabling is unavailable.
        </p>
      )}
      <fieldset disabled={op.blocked}>
        <Field label="Embedding provider">
          <SelectBox value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Choose independently of the chat provider</option>
            {id && !eligible.some((p) => p.id === id) && (
              <option value={id}>Saved provider unavailable</option>
            )}
            {eligible.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Embedding model">
          <Input
            maxLength={200}
            value={model}
            list="admin-embedding-models"
            onChange={(e) => {
              setModel(e.target.value);
              setAccept(false);
            }}
          />
          <datalist id="admin-embedding-models">
            {candidates.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        {kind && (
          <p>
            Catalog classification: {kind}. A listed model still needs
            validation.
          </p>
        )}
        <Button
          disabled={!provider || !revision}
          onClick={() => {
            if (!provider || !revision) return;
            void op.run(
              () => client.listAiEmbeddingModels(provider.id, revision),
              (r) => {
                if (r.provider_revision && r.provider_revision !== revision)
                  throw new Error("Embedding provider changed.");
                setCandidates(r.models);
                setKind(r.catalog_kind);
              },
              {
                title: "Load embedding model catalog?",
                body: "Contacts this provider with its saved credential. It does not send pages.",
                action: "Load embedding models",
              },
            );
          }}
        >
          Load embedding models
        </Button>
        <label>
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
          />
          I authorize sending every page to this embedding provider to measure
          it.
        </label>
        <div className="admin-actions">
          <Button
            disabled={!ready || !model.trim() || !accept}
            onClick={() => {
              if (!ready || !revision || !generation || !accept) return;
              void op.run(
                () =>
                  client.setSemanticSearch({
                    on: true,
                    embedding_provider_id: id,
                    embedding_model: model.trim(),
                    expected_generation: generation,
                    expected_provider_revision: revision,
                    accept: true,
                  }),
                (r) => {
                  if (
                    !r.semantic_search ||
                    r.embedding_provider_id !== id ||
                    r.embedding_model !== model.trim()
                  )
                    throw new Error("Semantic setup receipt mismatch.");
                  setAccept(false);
                  void refresh();
                },
                {
                  title: "Enable semantic search and send pages?",
                  body: "This may send all saved page content to the selected provider and incur usage. Exact generation and provider revisions are checked.",
                  action: "Enable and measure pages",
                  danger: true,
                },
              );
            }}
          >
            Enable or revalidate semantic search
          </Button>
          <Button
            disabled={!settings.semantic_search || !generation}
            onClick={() =>
              void op.run(
                () =>
                  client.setSemanticSearch({
                    on: false,
                    expected_generation: generation,
                  }),
                (r) => {
                  if (r.semantic_search)
                    throw new Error("Disable receipt mismatch.");
                  setAccept(false);
                  void refresh();
                },
                {
                  title: "Disable search by meaning?",
                  body: "Stops semantic search using this generation. Keyword search remains available.",
                  action: "Disable semantic search",
                },
              )
            }
          >
            Disable semantic search
          </Button>
        </div>
      </fieldset>
      <Outcome op={op} />
    </section>
  );
}

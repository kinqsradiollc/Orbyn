import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";
import {
  CircleCheck,
  CircleX,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  AI_PROVIDERS,
  AI_PROVIDER_KINDS,
  type AiProvider,
  type AiProviderKind,
  type AiProvidersResponse,
  type AiTestResult,
} from "@orbyn/core";
import { client } from "../../lib/api";
import type { TeamActions } from "../teams/TeamDetail";
import { stagger } from "../../lib/motion";
import "./ai.css";

type Props = Pick<TeamActions, "busy" | "revision" | "act" | "report">;

const SOURCE_LABELS = {
  database: "Admin console",
  environment: "Server settings (.env)",
  none: "Not configured",
} as const;

const CLOUD_KINDS = AI_PROVIDER_KINDS.filter((k) => !AI_PROVIDERS[k].local);
const LOCAL_KINDS = AI_PROVIDER_KINDS.filter((k) => AI_PROVIDERS[k].local);

/** AI provider management for admins with `ai:manage`; the server enforces it too. */
export function AdminAi({ busy, revision, act, report }: Props) {
  const [data, setData] = useState<AiProvidersResponse | null>(null);
  const [editing, setEditing] = useState<AiProvider | "new" | null>(null);
  /** Model chosen per provider row. */
  const [models, setModels] = useState<Record<string, string>>({});
  /** Models returned by "Load models", per provider. */
  const [loaded, setLoaded] = useState<Record<string, string[]>>({});
  const [tests, setTests] = useState<Record<string, AiTestResult>>({});
  const formRef = useRef<HTMLElement>(null);
  const reportRef = useRef(report);
  reportRef.current = report;

  const load = useCallback(async () => {
    try {
      setData(await client.listAiProviders());
    } catch (e) {
      reportRef.current(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);

  useEffect(() => {
    if (editing) formRef.current?.scrollIntoView({ block: "nearest" });
  }, [editing]);

  const settings = data?.settings;
  const providers = data?.providers ?? [];
  const activeId =
    settings?.source === "database" ? settings.provider_id : null;
  const active = providers.find((p) => p.id === activeId);

  const modelFor = (p: AiProvider) =>
    models[p.id] ??
    (p.id === activeId && settings?.model
      ? settings.model
      : (AI_PROVIDERS[p.kind]?.suggestedModels[0] ?? ""));

  /** Run a mutation, then reload the list. */
  const mutate = (fn: () => Promise<unknown>) =>
    void act(async () => {
      try {
        await fn();
      } finally {
        await load();
      }
    });

  const loadModels = (p: AiProvider) =>
    void act(async () => {
      const { models: list } = await client.listAiModels(p.id);
      setLoaded((m) => ({ ...m, [p.id]: list }));
      if (list.length && !models[p.id] && !list.includes(modelFor(p)))
        setModels((m) => ({ ...m, [p.id]: list[0] }));
    });

  const test = (p: AiProvider) =>
    void act(async () => {
      setTests(({ [p.id]: _, ...rest }) => rest);
      const result = await client.testAiProvider(
        p.id,
        modelFor(p).trim() || undefined,
      );
      setTests((t) => ({ ...t, [p.id]: result }));
    });

  const remove = (p: AiProvider) => {
    const note =
      p.id === activeId
        ? " The assistant will fall back to the server settings (.env)."
        : "";
    if (
      !window.confirm(`Delete ${p.name}? Its saved key is removed too.${note}`)
    )
      return;
    mutate(async () => {
      await client.deleteAiProvider(p.id);
      if (editing !== "new" && editing?.id === p.id) setEditing(null);
    });
  };

  return (
    <>
      {settings && !settings.secrets_ready && (
        <div className="ai-warning fade-up" role="note">
          <TriangleAlert size={16} />
          <span>
            Set SECRETS_KEY on the server before saving API keys (see
            docs/setup.md).
          </span>
        </div>
      )}

      <section className="card ai-assistant fade-up">
        <div className="section-heading">
          <h2>Assistant</h2>
          <button
            className="secondary"
            disabled={busy || !settings || settings.provider_id === null}
            onClick={() =>
              mutate(() => client.updateAiSettings({ provider_id: null }))
            }
          >
            <Server size={14} /> Use server settings (.env)
          </button>
        </div>
        <dl className="ai-facts">
          <div>
            <dt>Configured from</dt>
            <dd>{settings ? SOURCE_LABELS[settings.source] : "–"}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>
              {!settings
                ? "–"
                : settings.source === "database"
                  ? (active?.name ?? "Unknown provider")
                  : settings.source === "environment"
                    ? "Server settings (.env)"
                    : "None"}
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{settings?.model || "–"}</dd>
          </div>
        </dl>
        {settings?.source === "none" && (
          <p className="muted pad ai-note">
            The assistant is off until you add a provider here or configure one
            in the server&apos;s .env file.
          </p>
        )}
      </section>

      {editing && settings && (
        <ProviderForm
          key={editing === "new" ? "new" : editing.id}
          ref={formRef}
          editing={editing}
          busy={busy}
          secretsReady={settings.secrets_ready}
          onCancel={() => setEditing(null)}
          onSave={(save) =>
            mutate(async () => {
              await save();
              setEditing(null);
            })
          }
          onRemoveKey={(p) => {
            if (
              !window.confirm(
                `Remove the saved key for ${p.name}? Requests will be sent without one.`,
              )
            )
              return;
            mutate(() => client.updateAiProvider(p.id, { api_key: "" }));
          }}
        />
      )}

      <section className="card">
        <div className="section-heading">
          <h2>
            Providers <span>{providers.length}</span>
          </h2>
          <button
            className="primary"
            disabled={busy || !settings}
            onClick={() => setEditing("new")}
          >
            <Plus size={14} /> Add provider
          </button>
        </div>
        <div className="table-wrap">
          <table className="data-table ai-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Key</th>
                <th>Enabled</th>
                <th>Model</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p, n) => {
                const def = AI_PROVIDERS[p.kind];
                const model = modelFor(p);
                const choices = loaded[p.id];
                const listId = `ai-models-${p.id}`;
                const result = tests[p.id];
                return (
                  <tr
                    key={p.id}
                    className={
                      "fade-up stagger " + (p.enabled ? "" : "is-disabled")
                    }
                    style={stagger(n)}
                  >
                    <td>
                      <strong>{p.name}</strong>
                      {p.id === activeId && (
                        <span className="status-pill active ai-active">
                          Active
                        </span>
                      )}
                      <small className="ai-kind">{def?.label ?? p.kind}</small>
                    </td>
                    <td className="nowrap">
                      {p.has_key ? (
                        <span className="ai-key">
                          <KeyRound size={12} /> Key saved ({p.key_hint})
                        </span>
                      ) : (
                        <span className="muted">No key</span>
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        role="switch"
                        className="ai-switch"
                        aria-label={`Enable ${p.name}`}
                        checked={p.enabled}
                        disabled={busy}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          mutate(() =>
                            client.updateAiProvider(p.id, { enabled }),
                          );
                        }}
                      />
                    </td>
                    <td>
                      <div className="ai-model">
                        {choices && choices.length > 0 && (
                          <select
                            aria-label={`Loaded models for ${p.name}`}
                            value={choices.includes(model) ? model : ""}
                            onChange={(e) =>
                              setModels((m) => ({
                                ...m,
                                [p.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="" disabled>
                              Choose a model…
                            </option>
                            {choices.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          list={listId}
                          aria-label={
                            def?.listsModels === false
                              ? `Deployment name for ${p.name}`
                              : `Model for ${p.name}`
                          }
                          placeholder={
                            def?.listsModels === false
                              ? "Deployment name"
                              : "Model name"
                          }
                          maxLength={200}
                          value={model}
                          onChange={(e) =>
                            setModels((m) => ({
                              ...m,
                              [p.id]: e.target.value,
                            }))
                          }
                        />
                        <datalist id={listId}>
                          {(choices ?? def?.suggestedModels ?? []).map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                        {def?.listsModels !== false && (
                          <button
                            className="link-button"
                            disabled={busy}
                            onClick={() => loadModels(p)}
                          >
                            <RefreshCw size={12} /> Load models
                          </button>
                        )}
                        {choices && !choices.length && (
                          <small className="muted">
                            No models returned. Type one instead.
                          </small>
                        )}
                      </div>
                      {result && (
                        <p
                          className={"ai-test " + (result.ok ? "ok" : "fail")}
                          role="status"
                        >
                          {result.ok ? (
                            <CircleCheck size={13} />
                          ) : (
                            <CircleX size={13} />
                          )}
                          <span>
                            {result.message}
                            {result.ok && result.latency_ms !== null
                              ? ` (${result.latency_ms} ms)`
                              : ""}
                          </span>
                        </p>
                      )}
                    </td>
                    <td className="row-actions ai-actions">
                      <button
                        className="link-button"
                        disabled={busy}
                        onClick={() => test(p)}
                      >
                        Test connection
                      </button>
                      <button
                        className="link-button"
                        disabled={busy || !p.enabled || !model.trim()}
                        title={
                          !p.enabled
                            ? "Enable this provider first"
                            : !model.trim()
                              ? "Choose a model first"
                              : undefined
                        }
                        onClick={() =>
                          mutate(() =>
                            client.updateAiSettings({
                              provider_id: p.id,
                              model: model.trim(),
                            }),
                          )
                        }
                      >
                        <Sparkles size={12} /> Use for assistant
                      </button>
                      <button
                        className="link-button"
                        aria-label={`Edit ${p.name}`}
                        disabled={busy}
                        onClick={() => setEditing(p)}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        className="danger-text"
                        aria-label={`Delete ${p.name}`}
                        disabled={busy}
                        onClick={() => remove(p)}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data && !providers.length && (
                <tr>
                  <td colSpan={5} className="muted table-empty">
                    No providers yet. Add one to choose the assistant&apos;s
                    model here instead of in the server&apos;s .env file.
                  </td>
                </tr>
              )}
              {!data && (
                <tr>
                  <td colSpan={5} className="muted table-empty">
                    Loading providers…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type SaveFn = () => Promise<unknown>;

type FormProps = {
  ref: Ref<HTMLElement>;
  editing: AiProvider | "new";
  busy: boolean;
  secretsReady: boolean;
  onCancel: () => void;
  onSave: (save: SaveFn) => void;
  onRemoveKey: (p: AiProvider) => void;
};

/** Add or edit a provider. The key is write-only: it is never shown again. */
function ProviderForm({
  ref,
  editing,
  busy,
  secretsReady,
  onCancel,
  onSave,
  onRemoveKey,
}: FormProps) {
  const existing = editing === "new" ? null : editing;
  const [kind, setKind] = useState<AiProviderKind>(existing?.kind ?? "openai");
  const def = AI_PROVIDERS[kind];
  const [name, setName] = useState(existing?.name ?? def.label);
  const [baseUrl, setBaseUrl] = useState(
    existing?.base_url ?? def.defaultBaseUrl,
  );
  const [apiKey, setApiKey] = useState("");
  const [options, setOptions] = useState<Record<string, string>>({
    apiVersion: existing?.options.apiVersion ?? "",
  });

  const changeKind = (next: AiProviderKind) => {
    const prev = AI_PROVIDERS[kind];
    const nextDef = AI_PROVIDERS[next];
    // Follow the catalog defaults unless the admin has typed their own.
    if (!name.trim() || name === prev.label) setName(nextDef.label);
    if (!baseUrl.trim() || baseUrl === prev.defaultBaseUrl)
      setBaseUrl(nextDef.defaultBaseUrl);
    setKind(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const key = apiKey;
    setApiKey("");
    const opts = Object.fromEntries(
      def.options.map((o) => [o.key, options[o.key]?.trim() ?? ""]),
    ) as { apiVersion?: string };
    const body = {
      name: name.trim() || def.label,
      base_url: baseUrl.trim() || undefined,
      options: opts,
      ...(key && secretsReady ? { api_key: key } : {}),
    };
    onSave(() =>
      existing
        ? client.updateAiProvider(existing.id, body)
        : client.createAiProvider({ kind, ...body }),
    );
  };

  const keyHint = !secretsReady
    ? "Set SECRETS_KEY on the server to save keys."
    : !def.requiresKey
      ? def.local
        ? "Not needed for local servers."
        : "Optional. Only if your server asks for one."
      : undefined;

  return (
    <section className="card ai-form-card fade-up" ref={ref}>
      <div className="section-heading">
        <h2>{existing ? `Edit ${existing.name}` : "Add a provider"}</h2>
      </div>
      <form className="ai-form" onSubmit={submit}>
        <label className="wide">
          Provider
          <select
            value={kind}
            disabled={!!existing}
            onChange={(e) => changeKind(e.target.value as AiProviderKind)}
          >
            <optgroup label="Cloud">
              {CLOUD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {AI_PROVIDERS[k].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Local">
              {LOCAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {AI_PROVIDERS[k].label}
                </option>
              ))}
            </optgroup>
          </select>
          <small className="field-hint">
            {def.hint}
            {existing ? " The provider type can't be changed." : ""}
          </small>
        </label>
        <label>
          Name
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Base URL
          <input
            type="url"
            required={!def.defaultBaseUrl}
            maxLength={500}
            placeholder={def.defaultBaseUrl || "https://…"}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          {!def.defaultBaseUrl && (
            <small className="field-hint">
              Required.{" "}
              {kind === "azure"
                ? "Your resource URL, e.g. https://name.openai.azure.com."
                : "The address of your server's OpenAI-compatible API."}
            </small>
          )}
        </label>
        <label>
          API key
          <input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            maxLength={500}
            disabled={!secretsReady}
            placeholder={
              existing?.has_key ? "Leave blank to keep the saved key" : ""
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {keyHint && <small className="field-hint">{keyHint}</small>}
        </label>
        {def.options.map((o) => (
          <label key={o.key}>
            {o.label}
            <input
              required={o.required}
              maxLength={50}
              placeholder={o.placeholder}
              value={options[o.key] ?? ""}
              onChange={(e) =>
                setOptions((v) => ({ ...v, [o.key]: e.target.value }))
              }
            />
          </label>
        ))}
        <div className="button-row wide">
          {existing?.has_key && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => onRemoveKey(existing)}
            >
              <Trash2 size={13} /> Remove saved key
            </button>
          )}
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {existing ? "Save changes" : "Add provider"}
          </button>
        </div>
      </form>
    </section>
  );
}

import { Popover } from "../../components/Popover";
import { AiModelControls } from "./AiModelControls";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { SemanticSetup } from "./SemanticSetup";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";
import {
  ChevronDown,
  CircleCheck,
  CircleX,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  AI_PROVIDERS,
  AI_PROVIDER_KINDS,
  type AiProvider,
  type AiProviderKind,
  type AiProvidersResponse,
  type AiTestResult,
  aiUsageSummary,
} from "@orbyn/core";
import { client } from "../../lib/api";
import type { TeamActions } from "../teams/TeamDetail";
import { stagger } from "../../lib/motion";
import "./ai.css";

type Props = Pick<TeamActions, "busy" | "revision" | "act" | "report">;

const SOURCE_LABELS = {
  database: "Admin console",
  none: "Not set up",
} as const;

const CLOUD_KINDS = AI_PROVIDER_KINDS.filter((k) => !AI_PROVIDERS[k].local);
const LOCAL_KINDS = AI_PROVIDER_KINDS.filter((k) => AI_PROVIDERS[k].local);
/** Kinds offered in the picker, plus `current` so a saved provider still shows. */
const offered = (kinds: readonly AiProviderKind[], current: AiProviderKind) =>
  kinds.filter((k) => AI_PROVIDERS[k].pickerVisible || k === current);

/** AI provider management for admins with `ai:manage`; the server enforces it too. */
export function AdminAi({ busy, revision, act, report }: Props) {
  const { ask, tell } = useConfirm();
  const [data, setData] = useState<AiProvidersResponse | null>(null);
  const [editing, setEditing] = useState<AiProvider | "new" | null>(null);
  /** Model chosen per provider row. */
  const [models, setModels] = useState<Record<string, string>>({});
  /** Models returned by "Load models", per provider. */
  const [loaded, setLoaded] = useState<Record<string, string[]>>({});
  const [tests, setTests] = useState<Record<string, AiTestResult>>({});
  const [nightBudget, setNightBudget] = useState("1000000");
  useEffect(
    () => setNightBudget(String(data?.settings.night_token_budget ?? 1000000)),
    [data?.settings.night_token_budget],
  );
  const formRef = useRef<HTMLElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const loadRequest = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    try {
      const next = await client.listAiProviders();
      if (request !== loadRequest.current) return;
      dataRef.current = next;
      setData(next);
      setLoaded({});
      setTests({});
    } catch (e) {
      if (request === loadRequest.current) reportRef.current(e);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadRequest.current++;
      dataRef.current = null;
    };
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
  const mutate = async (
    fn: () => Promise<unknown>,
    warning = "Apply this AI configuration change? It affects the assistant for everyone.",
    confirmed = false,
  ) => {
    if (
      !confirmed &&
      !(await ask({ title: warning, confirmLabel: "Apply change" }))
    )
      return;
    void act(async () => {
      try {
        await fn();
      } finally {
        await load();
      }
    });
  };

  const loadModels = (p: AiProvider) =>
    void act(async () => {
      const { models: list } = await client.listAiModels(p.id);
      if (
        !dataRef.current?.providers.some(
          (current) =>
            current.id === p.id && current.updated_at === p.updated_at,
        )
      )
        return;
      setLoaded((m) => ({ ...m, [p.id]: list }));
    });

  const test = (p: AiProvider) =>
    void act(async () => {
      setTests(({ [p.id]: _, ...rest }) => rest);
      const result = await client.testAiProvider(
        p.id,
        modelFor(p).trim() || undefined,
      );
      if (
        !dataRef.current?.providers.some(
          (current) =>
            current.id === p.id && current.updated_at === p.updated_at,
        )
      )
        return;
      setTests((t) => ({ ...t, [p.id]: result }));
    });

  const remove = async (p: AiProvider) => {
    if (
      !(await ask({
        title: `Delete ${p.name}? Its saved key is removed too. If the assistant was using it, the assistant turns off until you choose another provider.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void mutate(
      async () => {
        await client.deleteAiProvider(p.id);
        if (editing !== "new" && editing?.id === p.id) setEditing(null);
      },
      "",
      true,
    );
  };

  const turnOff = async () => {
    if (
      !(await ask({
        title:
          "Turn off the assistant? It stays off until you choose a provider again.",
        confirmLabel: "Turn off",
        destructive: true,
      }))
    )
      return;
    void mutate(() => client.updateAiSettings({ provider_id: null }), "", true);
  };

  return (
    <>
      <section className="card ai-assistant fade-up">
        <div className="section-heading">
          <h2>Assistant</h2>
          <button
            className="secondary"
            disabled={busy || !settings || settings.source === "none"}
            onClick={turnOff}
          >
            <Power size={14} /> Turn off assistant
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
                  : "None"}
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{settings?.model || "–"}</dd>
          </div>
        </dl>
        {settings?.source === "none" && (
          <p className="muted pad ai-providers-note">
            The assistant is off. Add a provider below and choose Use for
            assistant.
          </p>
        )}
      </section>

      <details className="card ai-budget">
        <summary>
          <strong>Night-shift budget</strong>
          <span>
            {typeof settings?.night_token_budget === "number"
              ? `${settings.night_token_budget.toLocaleString()} tokens per person`
              : "Budget unavailable"}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="ai-budget-body">
          <p className="muted">
            The shared allowance for one person’s night, across up to ten runs.
            Remaining work appears in the morning review.
          </p>
          <label className="settings-field">
            Tokens per night
            <input
              type="number"
              min={1000}
              max={10000000}
              step={1000}
              value={nightBudget}
              onChange={(e) => setNightBudget(e.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={
              busy ||
              !settings?.settings_revision ||
              !Number.isInteger(Number(nightBudget)) ||
              Number(nightBudget) < 1000 ||
              Number(nightBudget) > 10000000
            }
            onClick={() =>
              settings &&
              void mutate(
                () =>
                  client.updateAiNightBudget({
                    expected_revision: settings.settings_revision!,
                    night_token_budget: Number(nightBudget),
                  }),
                "Change the night-shift budget for everyone?",
              )
            }
          >
            Save night budget
          </button>
        </div>
      </details>
      <SemanticSetup
        settings={settings}
        providers={providers}
        busy={busy}
        act={(fn) => void act(fn)}
        onChanged={load}
      />

      {editing && settings && (
        <ProviderForm
          key={editing === "new" ? "new" : editing.id}
          ref={formRef}
          editing={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(save) =>
            void mutate(
              async () => {
                await save();
                setEditing(null);
              },
              editing === "new"
                ? "Add this AI provider for the workspace?"
                : `Save changes to ${editing?.name}?`,
            )
          }
          onRemoveKey={async (p) => {
            if (
              !(await ask({
                title: `Remove the saved key for ${p.name}? Requests will be sent without one.`,
                confirmLabel: "Remove",
                destructive: true,
              }))
            )
              return;
            void mutate(
              () => client.updateAiProvider(p.id, { api_key: "" }),
              "",
              true,
            );
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
          <table className="data-table ai-providers-table stack-table">
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
                    <td data-label="Key" className="nowrap">
                      {p.has_key ? (
                        <span className="ai-key">
                          <KeyRound size={12} /> Key saved ({p.key_hint})
                        </span>
                      ) : (
                        <span className="muted">No key</span>
                      )}
                    </td>
                    <td data-label="Enabled">
                      <input
                        type="checkbox"
                        role="switch"
                        className="ai-switch"
                        aria-label={`Enable ${p.name}`}
                        checked={p.enabled}
                        disabled={busy}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          void mutate(
                            () => client.updateAiProvider(p.id, { enabled }),
                            `${enabled ? "Enable" : "Disable"} ${p.name} for the workspace?`,
                          );
                        }}
                      />
                    </td>
                    <td data-label="Model">
                      <div className="ai-model">
                        {choices && choices.length > 0 && (
                          <Select
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
                          </Select>
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
                        <AiModelControls
                          provider={p}
                          model={model}
                          busy={busy}
                          onSave={(options, expected_revision) =>
                            void mutate(
                              () =>
                                client.updateAiProvider(p.id, {
                                  options,
                                  expected_revision,
                                }),
                              `Save model controls for ${p.name}?`,
                            )
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
                            {result.usage && (
                              <span className="ai-test-usage">
                                {aiUsageSummary(result.usage)}
                              </span>
                            )}
                          </span>
                        </p>
                      )}
                    </td>
                    <td className="row-actions ai-provider-actions">
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
                          void mutate(
                            () =>
                              client.updateAiSettings({
                                provider_id: p.id,
                                model: model.trim(),
                              }),
                            `Use ${p.name} with ${model.trim()} for the assistant?`,
                          )
                        }
                      >
                        <Sparkles size={12} /> Use for assistant
                      </button>
                      <ProviderManagement
                        provider={p}
                        busy={busy}
                        onEdit={() => setEditing(p)}
                        onDelete={() => remove(p)}
                      />
                    </td>
                  </tr>
                );
              })}
              {data && !providers.length && (
                <tr>
                  <td colSpan={5} className="muted table-empty">
                    No providers yet. Add one to turn on the assistant.
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

/** Rare connection changes use one focused menu rather than repeated row actions. */
function ProviderManagement({
  provider,
  busy,
  onEdit,
  onDelete,
}: {
  provider: AiProvider;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        className="icon-button"
        type="button"
        disabled={busy}
        aria-label={`Manage ${provider.name}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <MoreHorizontal size={16} />
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          label={`Manage ${provider.name}`}
          onClose={() => setAnchor(null)}
          width={220}
        >
          <div className="doc-menu" role="menu">
            <button
              className="doc-menu-item"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setAnchor(null);
                onEdit();
              }}
            >
              <Pencil size={14} /> Edit connection
            </button>
            <button
              className="doc-menu-item danger-text"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setAnchor(null);
                onDelete();
              }}
            >
              <Trash2 size={14} /> Delete connection
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

type FormProps = {
  ref: Ref<HTMLElement>;
  editing: AiProvider | "new";
  busy: boolean;
  onCancel: () => void;
  onSave: (save: SaveFn) => void;
  onRemoveKey: (p: AiProvider) => void;
};

/** Add or edit a provider. The key is write-only: it is never shown again. */
function ProviderForm({
  ref,
  editing,
  busy,
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
    const opts = {
      ...existing?.options,
      ...Object.fromEntries(
        def.options.map((o) => [o.key, options[o.key]?.trim() ?? ""]),
      ),
    };
    const body = {
      name: name.trim() || def.label,
      base_url: baseUrl.trim() || undefined,
      options: opts,
      ...(key ? { api_key: key } : {}),
    };
    onSave(() =>
      existing
        ? client.updateAiProvider(existing.id, body)
        : client.createAiProvider({ kind, ...body }),
    );
  };

  const prefixes = def.keyPrefixes ?? [];
  const keyHint = def.defaultApiKey
    ? "Optional. Leave blank to use the public tier."
    : def.requiresKey
      ? prefixes.length
        ? `${def.label} keys start with ${prefixes.join(" or ")}.`
        : undefined
      : def.local
        ? "Not needed for local servers."
        : "Optional. Only if your server asks for one.";
  // BrainRouter only warns on an unfamiliar prefix; it never blocks.
  const typedKey = apiKey.trim();
  const keyWarning =
    typedKey && prefixes.length && !prefixes.some((p) => typedKey.startsWith(p))
      ? `This doesn't look like a ${def.label} key. Those start with ${prefixes.join(" or ")}.`
      : "";

  return (
    <section className="card ai-form-card fade-up" ref={ref}>
      <div className="section-heading">
        <h2>{existing ? `Edit ${existing.name}` : "Add a provider"}</h2>
      </div>
      <form className="ai-form" onSubmit={submit}>
        <label className="wide">
          Provider
          <Select
            value={kind}
            disabled={!!existing}
            onChange={(e) => changeKind(e.target.value as AiProviderKind)}
          >
            <optgroup label="Cloud">
              {offered(CLOUD_KINDS, kind).map((k) => (
                <option key={k} value={k}>
                  {AI_PROVIDERS[k].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Local">
              {offered(LOCAL_KINDS, kind).map((k) => (
                <option key={k} value={k}>
                  {AI_PROVIDERS[k].label}
                </option>
              ))}
            </optgroup>
          </Select>
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
            placeholder={
              existing?.has_key
                ? "Leave blank to keep the saved key"
                : prefixes[0]
                  ? `${prefixes[0]}…`
                  : ""
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {keyWarning ? (
            <small className="field-hint field-warning" role="status">
              {keyWarning}
            </small>
          ) : (
            keyHint && <small className="field-hint">{keyHint}</small>
          )}
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

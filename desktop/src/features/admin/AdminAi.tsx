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
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import type { TeamActions } from "../teams/TeamDetail";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import "./ai.css";

type Props = Pick<TeamActions, "busy" | "revision" | "act" | "report">;

const SOURCE_LABELS = {
  database: "Configured",
  none: "Off",
} as const;

const CLOUD_KINDS = AI_PROVIDER_KINDS.filter((k) => !AI_PROVIDERS[k].local);
const LOCAL_KINDS = AI_PROVIDER_KINDS.filter((k) => AI_PROVIDERS[k].local);
/** Kinds offered in the picker, plus `current` so a saved provider still shows. */
const offered = (kinds: readonly AiProviderKind[], current: AiProviderKind) =>
  kinds.filter((k) => AI_PROVIDERS[k].pickerVisible || k === current);

/** AI provider management for admins with `ai:manage`; the server enforces it too. */
export function AdminAi({ busy: externalBusy, revision, act, report }: Props) {
  const [pending, setPending] = useState(false);
  const busy = externalBusy || pending;
  const mutation = useRef<object | null>(null);
  const mounted = useRef(true);
  const accountAtRender = session.get();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { ask } = useConfirm();
  const [data, setData] = useState<AiProvidersResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<AiProvider | "new" | null>(null);
  /** Model chosen per provider row. */
  const [models, setModels] = useState<Record<string, string>>({});
  /** Models returned by "Load models", per provider. */
  const [loaded, setLoaded] = useState<Record<string, string[]>>({});
  const [catalogLoading, setCatalogLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>(
    {},
  );
  const [tests, setTests] = useState<Record<string, AiTestResult>>({});
  const [nightBudget, setNightBudget] = useState("1000000");
  const savedBudget = useRef("1000000");
  useEffect(() => {
    const next = String(data?.settings.night_token_budget ?? 1000000);
    const previous = savedBudget.current;
    savedBudget.current = next;
    setNightBudget((current) => (current === previous ? next : current));
  }, [data?.settings.night_token_budget]);
  const dataRef = useRef(data);
  dataRef.current = data;
  const loadRequest = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    const account = session.get();
    setFailed(false);
    setCatalogLoading({});
    setCatalogErrors({});
    try {
      const next = await client.listAiProviders();
      if (
        request !== loadRequest.current ||
        !mounted.current ||
        account !== session.get()
      )
        return;
      dataRef.current = next;
      setData(next);
      setLoaded({});
      setTests({});
    } catch (e) {
      if (
        request === loadRequest.current &&
        mounted.current &&
        account === session.get()
      ) {
        setFailed(true);
        reportRef.current(e);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadRequest.current++;
      dataRef.current = null;
    };
  }, [load, revision]);

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
    warning:
      | string
      | {
          title: string;
          body?: string;
          confirmLabel?: string;
          destructive?: boolean;
        } = {
      title: "Apply this AI change?",
      body: "This changes the assistant for everyone.",
      confirmLabel: "Apply change",
    },
  ): Promise<boolean> => {
    if (
      mutation.current ||
      externalBusy ||
      !mounted.current ||
      session.get() !== accountAtRender
    )
      return false;
    const ticket = {};
    const account = session.get();
    const current = () =>
      mounted.current &&
      mutation.current === ticket &&
      session.get() === account;
    mutation.current = ticket;
    setPending(true);
    let saved = false;
    try {
      if (
        !(await ask(
          typeof warning === "string"
            ? { title: warning, confirmLabel: "Apply change" }
            : warning,
        ))
      )
        return false;
      if (!current()) return false;
      await act(async () => {
        try {
          await fn();
          saved = current();
        } finally {
          if (current()) await load();
        }
      });
      return saved && current();
    } finally {
      if (mutation.current === ticket) {
        mutation.current = null;
        if (mounted.current) setPending(false);
      }
    }
  };

  const loadModels = (p: AiProvider) =>
    void act(async () => {
      const generation = loadRequest.current;
      const account = session.get();
      const current = () =>
        mounted.current &&
        session.get() === account &&
        generation === loadRequest.current &&
        dataRef.current?.providers.some(
          (row) =>
            row.id === p.id &&
            row.updated_at === p.updated_at &&
            row.controls_revision === p.controls_revision,
        );
      setCatalogLoading((state) => ({ ...state, [p.id]: true }));
      setCatalogErrors(({ [p.id]: _, ...rest }) => rest);
      try {
        const { models: list } = await client.listAiModels(
          p.id,
          p.controls_revision,
        );
        if (current()) setLoaded((m) => ({ ...m, [p.id]: list }));
      } catch (error) {
        if (!current()) return;
        setCatalogErrors((state) => ({
          ...state,
          [p.id]: "Couldn't load models. Try again.",
        }));
        throw error;
      } finally {
        if (current())
          setCatalogLoading((state) => ({ ...state, [p.id]: false }));
      }
    });

  const test = (p: AiProvider) =>
    void act(async () => {
      const generation = loadRequest.current;
      const account = session.get();
      const requestedModel = modelFor(p).trim();
      if (!requestedModel || !p.controls_revision) return;
      setTests(({ [p.id]: _, ...rest }) => rest);
      const result = await client.testAiProvider(
        p.id,
        requestedModel,
        p.controls_revision,
      );
      if (
        !mounted.current ||
        session.get() !== account ||
        generation !== loadRequest.current ||
        !dataRef.current?.providers.some(
          (current) =>
            current.id === p.id &&
            current.updated_at === p.updated_at &&
            current.controls_revision === p.controls_revision,
        )
      )
        return;
      if (
        result.provider_revision !== p.controls_revision ||
        result.model !== requestedModel
      )
        return;
      setTests((t) => ({ ...t, [p.id]: result }));
    });

  const remove = (p: AiProvider) =>
    void mutate(
      async () => {
        await client.deleteAiProvider(p.id);
        if (
          mounted.current &&
          session.get() === accountAtRender &&
          editing !== "new" &&
          editing?.id === p.id
        )
          setEditing(null);
      },
      {
        title: `Delete ${p.name}?`,
        body: "Its saved key is removed. If active, the assistant turns off until you choose another provider.",
        confirmLabel: "Delete",
        destructive: true,
      },
    );
  const turnOff = () =>
    void mutate(() => client.updateAiSettings({ provider_id: null }), {
      title: "Turn off the assistant?",
      body: "It stays off until you choose a provider again.",
      confirmLabel: "Turn off",
      destructive: true,
    });

  const loadError = (
    <section className="card" role="alert">
      <p>Couldn't load AI providers.</p>
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        Try again
      </button>
    </section>
  );
  if (!data)
    return failed ? (
      loadError
    ) : (
      <section className="card" aria-busy="true">
        <p className="muted">Loading AI providers…</p>
      </section>
    );

  return (
    <>
      {failed && loadError}
      <section className="card ai-assistant">
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
            <dt>Status</dt>
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
            Choose Use for assistant on a provider.
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
            Shared across up to ten runs each night. Unfinished work appears in
            morning review.
          </p>
          <label className="settings-field">
            Tokens per night
            <input
              type="number"
              min={1000}
              max={10000000}
              step={1000}
              disabled={busy}
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
          editing={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(save) =>
            mutate(
              async () => {
                await save();
                if (mounted.current && session.get() === accountAtRender)
                  setEditing(null);
              },
              editing === "new"
                ? "Add this AI provider for the workspace?"
                : `Save changes to ${editing?.name}?`,
            )
          }
          onRemoveKey={(p) => {
            void mutate(() => client.updateAiProvider(p.id, { api_key: "" }), {
              title: `Remove the saved key for ${p.name}?`,
              body: "Requests will be sent without a key.",
              confirmLabel: "Remove",
              destructive: true,
            });
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
              {providers.map((p) => {
                const def = AI_PROVIDERS[p.kind];
                const model = modelFor(p);
                const choices = loaded[p.id];
                const listId = `ai-models-${p.id}`;
                const result =
                  p.controls_revision &&
                  tests[p.id]?.provider_revision === p.controls_revision &&
                  tests[p.id]?.model === model.trim()
                    ? tests[p.id]
                    : undefined;
                return (
                  <tr key={p.id} className={p.enabled ? "" : "is-disabled"}>
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
                          <KeyRound size={12} /> Key saved
                        </span>
                      ) : (
                        <span className="muted">No key</span>
                      )}
                    </td>
                    <td data-label="Enabled">
                      <label className="ai-provider-toggle">
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
                        />{" "}
                      </label>
                    </td>
                    <td data-label="Model">
                      <div
                        className="ai-model"
                        aria-busy={!!catalogLoading[p.id]}
                      >
                        {choices && choices.length > 0 && (
                          <Select
                            searchable
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
                            <RefreshCw size={12} />
                            {catalogLoading[p.id]
                              ? "Loading models…"
                              : catalogErrors[p.id]
                                ? "Retry loading models"
                                : "Load models"}
                          </button>
                        )}
                        <span
                          role="status"
                          aria-live="polite"
                          className="sr-only"
                        >
                          {catalogLoading[p.id] ? "Loading models…" : ""}
                        </span>
                        {catalogErrors[p.id] && (
                          <small role="alert" className="ai-test fail">
                            {catalogErrors[p.id]}
                          </small>
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
                        disabled={busy || !model.trim() || !p.controls_revision}
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
                    No providers yet.
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
  editing: AiProvider | "new";
  busy: boolean;
  onCancel: () => void;
  onSave: (save: SaveFn) => Promise<boolean>;
  onRemoveKey: (p: AiProvider) => void;
};

/** Add or edit a provider. The key is write-only: it is never shown again. */
function ProviderForm({
  editing,
  busy,
  onCancel,
  onSave,
  onRemoveKey,
}: FormProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const working = busy || saving;
  const focus = useModalFocus(() => {
    if (!pending.current) onCancel();
  }, working);
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending.current || busy) return;
    pending.current = true;
    setSaving(true);
    setSaveError("");
    const key = apiKey.trim();
    const opts = {
      ...existing?.options,
      ...Object.fromEntries(
        def.options.map((o) => [o.key, options[o.key]?.trim() ?? ""]),
      ),
    };
    const body = {
      name: name.trim() || def.label,
      base_url: baseUrl.trim(),
      options: opts,
      ...(key ? { api_key: key } : {}),
    };
    try {
      const saved = await onSave(() =>
        existing
          ? client.updateAiProvider(existing.id, {
              ...body,
              expected_revision: existing.updated_at ?? undefined,
            })
          : client.createAiProvider({ kind, ...body }),
      );
      if (!saved && alive.current)
        setSaveError("Changes were not saved. Review them and try again.");
    } catch (error) {
      if (alive.current)
        setSaveError(
          error instanceof Error
            ? error.message
            : "Couldn’t save this provider. Try again.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
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

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !working) onCancel();
      }}
    >
      <section
        className="modal ai-form-card ai-provider-modal"
        ref={focus.ref}
        data-modal-focus={focus.id}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "Edit provider" : "Add provider"}
        tabIndex={-1}
      >
        <div className="section-heading">
          <h2>{existing ? `Edit ${existing.name}` : "Add a provider"}</h2>
        </div>
        <form className="ai-form" onSubmit={(event) => void submit(event)}>
          <label className="wide">
            Provider
            <Select
              searchable
              aria-label="Providers"
              value={kind}
              disabled={working || !!existing}
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
          </label>
          <details className="wide ai-provider-help">
            <summary>Provider details</summary>
            <p className="field-hint">
              {def.hint}
              {existing ? " The provider type can't be changed." : ""}
            </p>
          </details>
          <label>
            Name
            <input
              required
              maxLength={80}
              disabled={working}
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
              disabled={working}
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
              maxLength={4000}
              placeholder={
                existing?.has_key
                  ? "Leave blank to keep the saved key"
                  : prefixes[0]
                    ? `${prefixes[0]}…`
                    : ""
              }
              disabled={working}
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
                disabled={working}
                value={options[o.key] ?? ""}
                onChange={(e) =>
                  setOptions((v) => ({ ...v, [o.key]: e.target.value }))
                }
              />
            </label>
          ))}
          {saveError && (
            <p className="wide" role="alert">
              {saveError}
            </p>
          )}
          <div className="button-row wide">
            {existing?.has_key && (
              <button
                type="button"
                className="danger"
                disabled={working}
                onClick={() => onRemoveKey(existing)}
              >
                <Trash2 size={13} /> Remove saved key
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={working}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button className="primary" disabled={working}>
              {saving ? "Saving…" : existing ? "Save changes" : "Add provider"}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

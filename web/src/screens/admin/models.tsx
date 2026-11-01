import { useEffect, useRef, useState } from "react";
import {
  AI_PROVIDERS,
  AI_PROVIDER_KINDS,
  aiProviderInput,
  aiProviderUpdate,
  aiModelCapabilities,
  aiModelControlError,
  editedAiModelOptions,
  type AiProvider,
  type AiProviderKind,
  type AiProvidersResponse,
  type AiTestResult,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, SelectBox } from "../../ui/kit";
import {
  Facts,
  requireMatch,
  Outcome,
  ReadState,
  Section,
  useAdminLeave,
  useExit,
  useOperation,
  useRead,
} from "./shared";
import { Semantic } from "./semantic";
export function Models() {
  const read = useRead(() => client.listAiProviders(), [], "ai:manage"),
    leave = useAdminLeave(),
    [editing, setEditing] = useState<string | null>(null),
    [editorEpoch, setEditorEpoch] = useState(0);
  const view = read.data;
  return (
    <>
      <Section title="AI providers">
        <p>
          Changes apply to the managed workspace. Reading saved metadata makes
          no provider request. Catalogs and tests contact the chosen provider
          only after confirmation.
        </p>
        <ReadState read={read}>
          {view && (
            <div key={editorEpoch}>
              <Button
                onClick={() =>
                  void leave().then((ok) => {
                    if (ok && read.owned()) {
                      setEditing("new");
                      setEditorEpoch((n) => n + 1);
                    }
                  })
                }
              >
                Add provider
              </Button>
              <div className="admin-collection">
                {view.providers.map((p) => (
                  <Provider
                    key={p.id}
                    provider={p}
                    data={view}
                    refresh={read.reload}
                    edit={() =>
                      void leave().then((ok) => {
                        if (ok && read.owned()) {
                          setEditing(p.id);
                          setEditorEpoch((n) => n + 1);
                        }
                      })
                    }
                  />
                ))}
              </div>
              {editing && (
                <ProviderForm
                  key={editing}
                  provider={view.providers.find((p) => p.id === editing)}
                  onSaved={() => {
                    setEditing(null);
                    void read.reload();
                  }}
                  onCancel={() =>
                    void leave().then((ok) => {
                      if (ok && read.owned()) {
                        setEditing(null);
                        setEditorEpoch((n) => n + 1);
                      }
                    })
                  }
                />
              )}
              <DefaultModel data={view} refresh={read.reload} />
              <NightBudget data={view} refresh={read.reload} />
              <Semantic data={view} refresh={read.reload} />
            </div>
          )}
        </ReadState>
      </Section>
    </>
  );
}
function ProviderForm({
  provider: incoming,
  onSaved,
  onCancel,
}: {
  provider?: AiProvider;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const provider = useRef(incoming).current;
  const op = useOperation("ai:manage"),
    [kind, setKind] = useState<AiProviderKind>(provider?.kind || "openai"),
    [name, setName] = useState(provider?.name || ""),
    [base, setBase] = useState(provider?.base_url || ""),
    [enabled, setEnabled] = useState(provider?.enabled ?? true),
    [keyMode, setKeyMode] = useState("keep"),
    [key, setKey] = useState(""),
    [apiVersion, setApiVersion] = useState(provider?.options.apiVersion || ""),
    [dirty, setDirty] = useState(false);
  useExit({ dirty });
  const def = AI_PROVIDERS[kind];
  function save() {
    const { apiVersion: _savedApiVersion, ...preservedOptions } =
      provider?.options ?? {};
    const options = {
      ...preservedOptions,
      ...(apiVersion ? { apiVersion } : {}),
    };
    const body = {
      kind,
      name,
      base_url: base,
      enabled,
      options,
      ...(!provider || keyMode === "replace"
        ? { api_key: key }
        : keyMode === "remove"
          ? { api_key: "" }
          : {}),
    };
    const parsed = aiProviderInput.safeParse(body);
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check provider fields.");
      return;
    }
    const update = aiProviderUpdate.safeParse({
      name: parsed.data.name,
      base_url: parsed.data.base_url,
      enabled,
      options: parsed.data.options,
      ...(provider && keyMode === "keep"
        ? {}
        : { api_key: keyMode === "remove" ? "" : key }),
      expected_revision: provider?.controls_revision || provider?.updated_at,
    });
    if (provider && !update.success) {
      op.reject("Check provider revision and fields.");
      return;
    }
    void op.run(
      () =>
        provider && update.success
          ? client.updateAiProvider(provider.id, update.data)
          : client.createAiProvider(parsed.data),
      (r) => {
        if (
          !r.id ||
          r.kind !== kind ||
          r.name !== parsed.data.name ||
          (provider && r.id !== provider.id)
        )
          throw new Error("Provider receipt does not match this attempt.");
        setKey("");
        setDirty(false);
        onSaved();
      },
      {
        title: provider ? "Update provider?" : "Create provider?",
        body: "Saves connection configuration. This does not test the provider or start AI work.",
        action: "Save provider",
      },
    );
  }
  return (
    <form
      className="admin-detail"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset disabled={op.blocked}>
        <legend>{provider ? "Edit provider" : "New provider"}</legend>
        <Field label="Provider kind">
          <SelectBox
            disabled={!!provider}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as AiProviderKind);
              setDirty(true);
            }}
          >
            {AI_PROVIDER_KINDS.filter(
              (k) => AI_PROVIDERS[k].pickerVisible || k === kind,
            ).map((k) => (
              <option key={k} value={k}>
                {AI_PROVIDERS[k].label}
              </option>
            ))}
          </SelectBox>
        </Field>
        <p>{def.hint}</p>
        <Field label="Connection name">
          <Input
            required
            maxLength={80}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Field
          label="Base URL"
          hint={
            def.defaultBaseUrl || "An HTTP or HTTPS API address is required."
          }
        >
          <Input
            type="url"
            maxLength={500}
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        {provider && (
          <Field label="Saved key action">
            <SelectBox
              value={keyMode}
              onChange={(e) => {
                setKeyMode(e.target.value);
                setDirty(true);
              }}
            >
              <option value="keep">Keep saved key</option>
              <option value="replace">Replace key</option>
              <option value="remove">Remove key</option>
            </SelectBox>
          </Field>
        )}
        {(!provider || keyMode === "replace") && (
          <Field label="API key">
            <Input
              autoComplete="new-password"
              type="password"
              maxLength={4000}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
        )}
        {def.options.map((option) => (
          <Field key={option.key} label={option.label}>
            <Input
              required={option.required}
              maxLength={40}
              placeholder={option.placeholder}
              value={apiVersion}
              onChange={(e) => {
                setApiVersion(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
        ))}
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setDirty(true);
            }}
          />
          Enabled
        </label>
        <div className="admin-actions">
          <Button type="submit">Save provider</Button>
          <Button onClick={onCancel}>Cancel provider edit</Button>
        </div>
      </fieldset>
      <Outcome op={op} />
    </form>
  );
}
function Provider({
  provider: p,
  data,
  refresh,
  edit,
}: {
  provider: AiProvider;
  data: AiProvidersResponse;
  refresh: () => Promise<void>;
  edit: () => void;
}) {
  const op = useOperation("ai:manage"),
    [model, setModel] = useState(
      data.settings.provider_id === p.id
        ? data.settings.model
        : AI_PROVIDERS[p.kind].suggestedModels[0] || "",
    ),
    [catalog, setCatalog] = useState<string[]>([]),
    [result, setResult] = useState<AiTestResult | null>(null);
  const revision = p.controls_revision || p.updated_at;
  return (
    <article className="admin-detail">
      <h3>{p.name}</h3>
      <Facts
        value={{
          kind: p.kind,
          base_url: p.base_url,
          enabled: p.enabled,
          has_key: p.has_key,
          key_hint: p.key_hint,
          controls_revision: p.controls_revision,
          embedding_revision: p.embedding_revision,
        }}
      />
      <div className="admin-actions">
        <Button disabled={op.blocked} onClick={edit}>
          Edit connection
        </Button>
        <Button
          disabled={op.blocked}
          onClick={() =>
            void op.run(
              () =>
                client.updateAiProvider(p.id, {
                  enabled: !p.enabled,
                  expected_revision: revision,
                }),
              (r) => {
                if (r.id !== p.id || r.enabled === p.enabled)
                  throw new Error("Provider receipt mismatch.");
                void refresh();
              },
            )
          }
        >
          {p.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          variant="danger"
          disabled={op.blocked}
          onClick={() =>
            void op.run(
              () => client.deleteAiProvider(p.id),
              () => void refresh(),
              {
                title: "Delete provider?",
                body: `Delete ${p.name}. Existing AI defaults may become unavailable.`,
                action: "Delete provider",
                danger: true,
              },
            )
          }
        >
          Delete connection
        </Button>
      </div>
      <Field label={`Model to test on ${p.name}`}>
        <Input
          maxLength={200}
          value={model}
          list={`models-${p.id}`}
          disabled={op.blocked}
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id={`models-${p.id}`}>
          {catalog.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <div className="admin-actions">
        <Button
          disabled={
            op.blocked || !p.enabled || !AI_PROVIDERS[p.kind].listsModels
          }
          onClick={() =>
            void op.run(
              () => client.listAiModels(p.id, revision),
              (r) => {
                if (r.provider_revision && r.provider_revision !== revision)
                  throw new Error("Provider changed during catalog request.");
                setCatalog(r.models);
              },
              {
                title: "Contact provider for model list?",
                body: `Uses ${p.name}'s saved credential. No page content is sent.`,
                action: "Load model catalog",
              },
            )
          }
        >
          Load models
        </Button>
        <Button
          disabled={op.blocked || !p.enabled}
          onClick={() =>
            void op.run(
              () => client.testAiProvider(p.id, model, revision),
              (r) => {
                if (r.provider_revision && r.provider_revision !== revision)
                  throw new Error("Provider changed during test.");
                setResult(r);
              },
              {
                title: "Run real provider test?",
                body: `Sends a small model request to ${p.name}. It can use quota.`,
                action: "Test provider",
              },
            )
          }
        >
          Test provider
        </Button>
      </div>
      {result && <Facts value={result} />}
      <Controls key={p.id} p={p} model={model} refresh={refresh} />
      <Outcome op={op} />
    </article>
  );
}
function Controls({
  p,
  model,
  refresh,
}: {
  p: AiProvider;
  model: string;
  refresh: () => Promise<void>;
}) {
  const op = useOperation("ai:manage"),
    [base, setBase] = useState(p),
    [effort, setEffort] = useState<string>(p.options.reasoningEffort || ""),
    [cache, setCache] = useState<string>(p.options.cacheMode || ""),
    [retention, setRetention] = useState<string>(
      p.options.cacheRetention || "",
    ),
    [dirty, setDirty] = useState(false);
  useExit({ dirty });
  useEffect(() => {
    if (!dirty && !op.unknown) {
      setBase(p);
      setEffort(p.options.reasoningEffort || "");
      setCache(p.options.cacheMode || "");
      setRetention(p.options.cacheRetention || "");
    }
  }, [p, dirty, op.unknown]);
  const caps = aiModelCapabilities(p.kind, model);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const options = editedAiModelOptions(
            base.options,
            effort,
            cache,
            retention,
          ),
          error = aiModelControlError(p.kind, model, options);
        if (error) {
          op.reject(error);
          return;
        }
        void op.run(
          () =>
            client.updateAiProvider(p.id, {
              options,
              expected_revision: base.controls_revision || base.updated_at,
            }),
          (r) => {
            if (r.id !== p.id)
              throw new Error("Model-control receipt mismatch.");
            requireMatch(r.options, options, "Model controls");
            setDirty(false);
            void refresh();
          },
        );
      }}
    >
      <fieldset disabled={op.blocked}>
        <legend>Defaults for the exact model above</legend>
        <p>
          Unsupported saved values remain visible until explicitly cleared. A
          model catalog does not establish control support.
        </p>
        {[
          {
            label: "Reasoning effort",
            value: effort,
            set: setEffort,
            choices: caps.efforts,
          },
          {
            label: "Cache mode",
            value: cache,
            set: setCache,
            choices: caps.cacheModes,
          },
          {
            label: "Cache retention",
            value: retention,
            set: setRetention,
            choices: caps.retentions,
          },
        ].map((c) => (
          <Field key={c.label} label={c.label}>
            <SelectBox
              value={c.value}
              onChange={(e) => {
                c.set(e.target.value);
                setDirty(true);
              }}
            >
              <option value="">Provider default</option>
              {c.value && !c.choices.includes(c.value) && (
                <option value={c.value}>{c.value} (saved; unavailable)</option>
              )}
              {c.choices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectBox>
          </Field>
        ))}
        <Button type="submit" disabled={!dirty}>
          Save model controls
        </Button>
      </fieldset>
      <Outcome op={op} />
    </form>
  );
}
function DefaultModel({
  data,
  refresh,
}: {
  data: AiProvidersResponse;
  refresh: () => Promise<void>;
}) {
  const op = useOperation("ai:manage"),
    [id, setId] = useState(data.settings.provider_id || ""),
    [model, setModel] = useState(data.settings.model),
    dirty =
      id !== (data.settings.provider_id || "") || model !== data.settings.model;
  useExit({ dirty });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const provider = data.providers.find((p) => p.id === id);
        if (id && (!provider || !provider.enabled)) {
          op.reject("Choose an enabled saved provider.");
          return;
        }
        const err =
          provider &&
          aiModelControlError(provider.kind, model, provider.options);
        if (err) {
          op.reject(err);
          return;
        }
        void op.run(
          () =>
            client.updateAiSettings({
              provider_id: id || null,
              model: model.trim(),
            }),
          (r) => {
            if (r.provider_id !== (id || null) || r.model !== model.trim())
              throw new Error("Default model receipt mismatch.");
            void refresh();
          },
          {
            title: "Change managed AI default?",
            body: "Changes the provider and model used for managed AI work.",
            action: "Save AI default",
          },
        );
      }}
    >
      <fieldset disabled={op.blocked}>
        <legend>Workspace AI default</legend>
        <Field label="Default provider">
          <SelectBox value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Off</option>
            {data.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.enabled}>
                {p.name}
                {!p.enabled ? " (disabled)" : ""}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Default model">
          <Input
            required={!!id}
            maxLength={200}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={!dirty}>
          Save default provider and model
        </Button>
      </fieldset>
      <Outcome op={op} />
    </form>
  );
}
function NightBudget({
  data,
  refresh,
}: {
  data: AiProvidersResponse;
  refresh: () => Promise<void>;
}) {
  const op = useOperation("ai:manage"),
    [budget, setBudget] = useState(data.settings.night_token_budget ?? 1000000),
    [dirty, setDirty] = useState(false),
    [baseRevision, setBaseRevision] = useState(data.settings.settings_revision);
  useExit({ dirty });
  useEffect(() => {
    if (!dirty && !op.unknown) {
      setBudget(data.settings.night_token_budget ?? 1000000);
      setBaseRevision(data.settings.settings_revision);
    }
  }, [data.settings, dirty, op.unknown]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const revision = baseRevision;
        if (!revision) {
          op.reject("A fresh settings revision is required.");
          return;
        }
        void op.run(
          () =>
            client.updateAiNightBudget({
              night_token_budget: budget,
              expected_revision: revision,
            }),
          (r) => {
            if (r.night_token_budget !== budget)
              throw new Error("Night allowance receipt mismatch.");
            setDirty(false);
            void refresh();
          },
        );
      }}
    >
      <fieldset disabled={op.blocked}>
        <legend>Managed overnight token allowance</legend>
        <Field
          label="Night tokens"
          hint="The workspace allowance is separate from personal provider plans."
        >
          <Input
            type="number"
            required
            min={1000}
            max={10000000}
            value={budget}
            onChange={(e) => {
              setBudget(Number(e.target.value));
              setDirty(true);
            }}
          />
        </Field>
        <Button
          type="submit"
          disabled={!dirty || !data.settings.settings_revision}
        >
          Save overnight allowance
        </Button>
      </fieldset>
      <Outcome op={op} />
    </form>
  );
}

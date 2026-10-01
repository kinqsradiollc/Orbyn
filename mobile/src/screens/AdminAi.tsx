import React, { useEffect, useState } from "react";
import { SemanticSetup } from "./SemanticSetup";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { Switch } from "../components/Switch";
import {
  AI_PROVIDER_KINDS,
  AI_PROVIDERS,
  type AiProvider,
  type AiProviderKind,
  type AiProvidersResponse,
  type AiSettings,
  type AiTestResult,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { Segmented } from "../components/Segmented";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { FadeIn, PressableScale, Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

type Act = (fn: () => Promise<void>) => Promise<void>;
type FormState = { mode: "new" } | { mode: "edit"; provider: AiProvider };

const CLOUD_KINDS = AI_PROVIDER_KINDS.filter((k) => !AI_PROVIDERS[k].local);
const LOCAL_KINDS = AI_PROVIDER_KINDS.filter((k) => AI_PROVIDERS[k].local);
/** Kinds offered in the picker, plus `current` so a saved provider still shows. */
const offered = (kinds: readonly AiProviderKind[], current: AiProviderKind) =>
  kinds.filter((k) => AI_PROVIDERS[k].pickerVisible || k === current);
const KIND_LABELS = Object.fromEntries(
  AI_PROVIDER_KINDS.map((k) => [k, AI_PROVIDERS[k].label]),
) as Record<AiProviderKind, string>;
const MAX_CHIPS = 40;

const SOURCE: Record<
  AiSettings["source"],
  { label: string; tone: "accent" | "muted" | "warning"; body: string }
> = {
  database: {
    label: "Admin console",
    tone: "accent",
    body: "The assistant uses a provider configured here.",
  },
  none: {
    label: "Not set up",
    tone: "warning",
    body: "The assistant is off. Add a provider below and choose Use for assistant.",
  },
};

/**
 * Admin console "AI" segment: which provider powers the assistant, plus the
 * list of configured providers. Keys go to the server and are never shown
 * again; only a short hint comes back.
 */
export function AdminAi({ act, busy }: { act: Act; busy: boolean }) {
  const [data, setData] = useState<AiProvidersResponse | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [failed, setFailed] = useState(false);
  const [nightBudget, setNightBudget] = useState("1000000");
  useEffect(
    () => setNightBudget(String(data?.settings.night_token_budget ?? 1000000)),
    [data?.settings.night_token_budget],
  );

  const load = async () => setData(await client.listAiProviders());
  const firstLoad = () =>
    act(async () => {
      setFailed(false);
      try {
        await load();
      } catch (e) {
        setFailed(true);
        throw e;
      }
    });
  const run = (fn: () => Promise<unknown>) =>
    act(async () => {
      await fn();
      await load();
    });
  const setSettings = (settings: AiSettings) =>
    setData((prev) => (prev ? { ...prev, settings } : prev));

  useEffect(() => {
    void firstLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data)
    return failed ? (
      <View style={[shared.card, shared.empty]}>
        <Text style={shared.sectionTitle}>Couldn't load AI providers.</Text>
        <Text style={[shared.subtitle, s.center, s.gapBelow]}>
          Check the error above, then try again.
        </Text>
        <Button
          secondary
          title="Try again"
          disabled={busy}
          style={s.flushButton}
          onPress={firstLoad}
        />
      </View>
    ) : (
      <Text style={shared.small}>Loading AI providers…</Text>
    );
  const { providers, settings } = data;

  if (form)
    return (
      <ProviderForm
        key={form.mode === "edit" ? form.provider.id : "new"}
        provider={form.mode === "edit" ? form.provider : undefined}
        busy={busy}
        act={act}
        onSaved={async (saved) => {
          setForm(null);
          setExpanded(saved.id);
          await load();
        }}
        onCancel={() => setForm(null)}
      />
    );

  const active = providers.find((p) => p.id === settings.provider_id);
  const source = SOURCE[settings.source];

  return (
    <>
      <FadeIn style={shared.card}>
        <View style={s.cardHead}>
          <Text style={[shared.sectionTitle, { flex: 1 }]}>Assistant</Text>
          <Pill label={source.label} tone={source.tone} />
        </View>
        <Text style={[shared.body, s.gapBelow]}>{source.body}</Text>
        <View style={s.kv}>
          <Text style={shared.small}>Provider</Text>
          <Text style={s.kvValue} numberOfLines={1}>
            {active ? `${active.name} · ${KIND_LABELS[active.kind]}` : "—"}
          </Text>
        </View>
        <View style={s.kv}>
          <Text style={shared.small}>Model</Text>
          <Text style={s.kvValue} numberOfLines={1}>
            {settings.model || "—"}
          </Text>
        </View>
        <Field label="Night-shift tokens per person">
          <TextInput
            accessibilityLabel="Night-shift tokens per person"
            style={shared.input}
            keyboardType="number-pad"
            value={nightBudget}
            onChangeText={setNightBudget}
          />
        </Field>
        <Text style={shared.small}>
          Shared across up to ten runs each night. Remaining work waits for
          morning.
        </Text>
        <Button
          title="Save night budget"
          disabled={
            busy ||
            !Number.isInteger(Number(nightBudget)) ||
            Number(nightBudget) < 1000 ||
            Number(nightBudget) > 10000000
          }
          onPress={() =>
            void act(async () => {
              await client.updateAiSettings({
                provider_id: settings.provider_id,
                model: settings.model,
                night_token_budget: Number(nightBudget),
              });
              await load();
            })
          }
        />
        <Button
          secondary
          title="Turn off assistant"
          style={s.flushButton}
          disabled={busy || settings.source === "none"}
          onPress={() =>
            Alert.alert(
              "Turn off the assistant?",
              "It stays off until you choose a provider again.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Turn off",
                  style: "destructive",
                  onPress: () =>
                    act(async () =>
                      setSettings(
                        await client.updateAiSettings({ provider_id: null }),
                      ),
                    ),
                },
              ],
            )
          }
        />
      </FadeIn>

      <View style={s.section}>
        <SemanticSetup
          settings={settings}
          providers={providers}
          busy={busy}
          act={act}
          onSettings={setSettings}
          onChanged={load}
        />
      </View>

      <Text style={[shared.eyebrow, s.section]}>PROVIDERS</Text>
      {providers.length ? (
        <View style={s.list}>
          {providers.map((p, n) => (
            <FadeIn key={p.id} index={n + 2} style={n > 0 && s.divider}>
              <ProviderRow
                provider={p}
                active={p.id === settings.provider_id}
                activeModel={settings.model}
                expanded={expanded === p.id}
                busy={busy}
                act={act}
                onToggle={() =>
                  setExpanded((cur) => (cur === p.id ? null : p.id))
                }
                onEnabled={(enabled) =>
                  run(() => client.updateAiProvider(p.id, { enabled }))
                }
                onUse={(model) =>
                  act(async () =>
                    setSettings(
                      await client.updateAiSettings({
                        provider_id: p.id,
                        model,
                      }),
                    ),
                  )
                }
                onEdit={() => setForm({ mode: "edit", provider: p })}
                onDelete={() =>
                  Alert.alert(
                    "Delete this provider?",
                    `${p.name} and its saved key are removed. If the assistant was using it, the assistant turns off until you choose another provider.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => run(() => client.deleteAiProvider(p.id)),
                      },
                    ],
                  )
                }
              />
            </FadeIn>
          ))}
        </View>
      ) : (
        <View style={[shared.card, shared.empty]}>
          <View style={shared.emptyIcon}>
            <Icon name="sparkles" size={26} color={colors.accent} />
          </View>
          <Text style={shared.sectionTitle}>No providers yet.</Text>
          <Text style={[shared.subtitle, s.center]}>
            Connect a cloud service or a model running on your own machine.
          </Text>
        </View>
      )}
      <Button
        title="Add provider"
        icon="plus"
        disabled={busy}
        onPress={() => setForm({ mode: "new" })}
      />
    </>
  );
}

function ProviderRow({
  provider: p,
  active,
  activeModel,
  expanded,
  busy,
  act,
  onToggle,
  onEnabled,
  onUse,
  onEdit,
  onDelete,
}: {
  provider: AiProvider;
  active: boolean;
  activeModel: string;
  expanded: boolean;
  busy: boolean;
  act: Act;
  onToggle: () => void;
  onEnabled: (enabled: boolean) => void;
  onUse: (model: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const def = AI_PROVIDERS[p.kind];
  const [model, setModel] = useState(active ? activeModel : "");
  const [models, setModels] = useState<string[] | null>(null);
  const [test, setTest] = useState<AiTestResult | null>(null);

  const list = models ?? def.suggestedModels;
  const typed = model.trim();
  const query = typed.toLowerCase();
  const shown = (
    !query || list.includes(typed)
      ? list
      : list.filter((m) => m.toLowerCase().includes(query))
  ).slice(0, MAX_CHIPS);

  return (
    <View>
      <View style={s.rowTop}>
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${p.name}, ${def.label}`}
          accessibilityHint={expanded ? "Hides actions" : "Shows actions"}
          onPress={onToggle}
          scaleTo={0.99}
          style={s.rowMain}
        >
          <View style={s.rowTitle}>
            <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>
              {p.name}
            </Text>
            {active && <Pill label="Active" tone="accent" />}
          </View>
          <Text style={shared.small} numberOfLines={1}>
            {def.label} · {p.has_key ? `Key saved (${p.key_hint})` : "No key"}
          </Text>
        </PressableScale>
        <Switch
          value={p.enabled}
          disabled={busy}
          trackColor={{ true: colors.accent }}
          accessibilityLabel={`${p.name} enabled`}
          onValueChange={onEnabled}
        />
      </View>
      {expanded && (
        <FadeIn style={s.expand}>
          <Text style={shared.label}>
            {p.kind === "azure" ? "Deployment name" : "Model"}
          </Text>
          <TextInput
            style={[shared.input, s.input]}
            value={model}
            onChangeText={setModel}
            placeholder={
              p.kind === "azure"
                ? "Your deployment name"
                : "Type or pick a model"
            }
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Model"
          />
          {models && !models.length && (
            <Text style={[shared.small, s.input]}>
              No models came back. Type one above.
            </Text>
          )}
          {shown.length > 0 && (
            <>
              {!models && (
                <Text style={[shared.small, s.chipCaption]}>
                  {def.listsModels ? "Suggested" : "Suggested models"}
                </Text>
              )}
              <View style={s.chips}>
                {shown.map((m) => {
                  const selected = m === typed;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setModel(m)}
                      style={[s.chip, selected && s.chipActive]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[s.chipText, selected && s.chipTextActive]}
                      >
                        {m}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {models && models.length > shown.length && (
                <Text style={[shared.small, s.chipCaption]}>
                  Showing {shown.length} of {models.length}. Type to filter.
                </Text>
              )}
            </>
          )}
          {test && (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                s.testText,
                { color: test.ok ? colors.accent : colors.danger },
              ]}
            >
              {test.message}
              {test.latency_ms !== null ? ` · ${test.latency_ms} ms` : ""}
            </Text>
          )}
          <View style={s.actions}>
            {def.listsModels && (
              <SmallAction
                label={models ? "Reload models" : "Load models"}
                disabled={busy}
                onPress={() =>
                  act(async () => {
                    setModels((await client.listAiModels(p.id)).models);
                  })
                }
              />
            )}
            <SmallAction
              label="Test connection"
              disabled={busy}
              onPress={() =>
                act(async () => {
                  setTest(null);
                  setTest(
                    await client.testAiProvider(p.id, typed || undefined),
                  );
                })
              }
            />
            <SmallAction
              label="Use for assistant"
              disabled={busy || !typed}
              onPress={() => onUse(typed)}
            />
            <SmallAction label="Edit" disabled={busy} onPress={onEdit} />
            <SmallAction
              destructive
              label="Delete"
              disabled={busy}
              onPress={onDelete}
            />
          </View>
          {!typed && (
            <Text style={[shared.small, s.chipCaption]}>
              Pick or type a model to use this provider for the assistant.
            </Text>
          )}
        </FadeIn>
      )}
    </View>
  );
}

function ProviderForm({
  provider,
  busy,
  act,
  onSaved,
  onCancel,
}: {
  provider?: AiProvider;
  busy: boolean;
  act: Act;
  onSaved: (saved: AiProvider) => Promise<void>;
  onCancel: () => void;
}) {
  const editing = !!provider;
  const [kind, setKind] = useState<AiProviderKind>(provider?.kind ?? "openai");
  const def = AI_PROVIDERS[kind];
  const [name, setName] = useState(provider?.name ?? def.label);
  const [baseUrl, setBaseUrl] = useState(
    provider?.base_url ?? def.defaultBaseUrl,
  );
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [apiVersion, setApiVersion] = useState(
    provider?.options.apiVersion ?? "",
  );

  const chooseKind = (next: AiProviderKind) => {
    const prev = AI_PROVIDERS[kind];
    const nextDef = AI_PROVIDERS[next];
    if (!name.trim() || name === prev.label) setName(nextDef.label);
    if (!baseUrl.trim() || baseUrl === prev.defaultBaseUrl)
      setBaseUrl(nextDef.defaultBaseUrl);
    setKind(next);
  };

  const needsUrl = !def.defaultBaseUrl;
  const needsVersion = def.options.some(
    (o) => o.key === "apiVersion" && o.required,
  );
  const missing =
    !name.trim() ||
    (needsUrl && !baseUrl.trim()) ||
    (needsVersion && !apiVersion.trim());

  const save = () =>
    act(async () => {
      const options = def.options.length
        ? { apiVersion: apiVersion.trim() }
        : undefined;
      const key = apiKey.trim();
      const saved = provider
        ? await client.updateAiProvider(provider.id, {
            name: name.trim(),
            base_url: baseUrl.trim(),
            options,
            ...(removeKey ? { api_key: "" } : key ? { api_key: key } : {}),
          })
        : await client.createAiProvider({
            kind,
            name: name.trim(),
            base_url: baseUrl.trim() || undefined,
            options,
            ...(key ? { api_key: key } : {}),
          });
      // Never keep a key around after it has been sent.
      setApiKey("");
      await onSaved(saved);
    });

  const prefixes = def.keyPrefixes ?? [];
  const keyPlaceholder =
    editing && provider.has_key
      ? "Leave blank to keep the saved key"
      : def.defaultApiKey
        ? "Optional. Blank uses the public tier"
        : def.requiresKey
          ? prefixes[0]
            ? `Paste your key (${prefixes[0]}…)`
            : "Paste your API key"
          : "Optional for most local servers";
  // BrainRouter only warns on an unfamiliar prefix; it never blocks.
  const typedKey = apiKey.trim();
  const keyWarning =
    typedKey && prefixes.length && !prefixes.some((p) => typedKey.startsWith(p))
      ? `This doesn't look like a ${def.label} key. Those start with ${prefixes.join(" or ")}.`
      : "";

  return (
    <FadeIn style={shared.card}>
      <Text style={[shared.sectionTitle, s.gapBelow]}>
        {editing ? "Edit provider" : "Add provider"}
      </Text>

      <Text style={shared.label}>Provider</Text>
      {editing ? (
        <Text style={[shared.body, s.input]}>{def.label}</Text>
      ) : (
        <>
          <Text style={[shared.small, s.group]}>Cloud</Text>
          <Segmented
            wrap
            accessibilityLabel="Cloud providers"
            options={offered(CLOUD_KINDS, kind)}
            labels={KIND_LABELS}
            value={kind}
            onChange={chooseKind}
            disabled={busy}
          />
          <Text style={[shared.small, s.group, s.groupGap]}>Local</Text>
          <Segmented
            wrap
            accessibilityLabel="Local providers"
            options={offered(LOCAL_KINDS, kind)}
            labels={KIND_LABELS}
            value={kind}
            onChange={chooseKind}
            disabled={busy}
          />
        </>
      )}
      <Text style={[shared.small, s.hint]}>{def.hint}</Text>

      <Text style={shared.label}>Name</Text>
      <TextInput
        style={[shared.input, s.input]}
        value={name}
        onChangeText={setName}
        maxLength={80}
        placeholder={def.label}
        placeholderTextColor={colors.faint}
        accessibilityLabel="Name"
      />

      <Text style={shared.label}>Base URL{needsUrl ? " (required)" : ""}</Text>
      <TextInput
        style={[shared.input, s.input]}
        value={baseUrl}
        onChangeText={setBaseUrl}
        placeholder={
          def.defaultBaseUrl ||
          (kind === "azure"
            ? "https://your-resource.openai.azure.com"
            : "https://example.com/v1")
        }
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        textContentType="URL"
        accessibilityLabel="Base URL"
      />

      {def.options.map((o) => (
        <View key={o.key}>
          <Text style={shared.label}>
            {o.label}
            {o.required ? " (required)" : ""}
          </Text>
          <TextInput
            style={[shared.input, s.input]}
            value={apiVersion}
            onChangeText={setApiVersion}
            placeholder={o.placeholder}
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={o.label}
          />
        </View>
      ))}

      <Text style={shared.label}>API key</Text>
      <TextInput
        style={[shared.input, s.input]}
        value={apiKey}
        onChangeText={(v) => {
          setApiKey(v);
          if (v) setRemoveKey(false);
        }}
        editable={!removeKey}
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        textContentType="none"
        placeholder={removeKey ? "Saved key will be removed" : keyPlaceholder}
        placeholderTextColor={colors.faint}
        accessibilityLabel="API key"
      />
      {keyWarning ? (
        <Text style={[shared.small, s.keyWarning]} accessibilityRole="alert">
          {keyWarning}
        </Text>
      ) : null}
      {editing && provider.has_key && (
        <View style={s.keyRow}>
          <Text style={[shared.small, { flex: 1 }]}>
            {removeKey
              ? "The saved key is removed when you save."
              : `Saved key: ${provider.key_hint}`}
          </Text>
          <SmallAction
            destructive={!removeKey}
            label={removeKey ? "Keep saved key" : "Remove saved key"}
            disabled={busy}
            onPress={() => {
              setApiKey("");
              setRemoveKey((v) => !v);
            }}
          />
        </View>
      )}

      <Button
        title={editing ? "Save changes" : "Add provider"}
        disabled={busy || missing}
        onPress={save}
      />
      <Button
        secondary
        title="Cancel"
        disabled={busy}
        style={{ marginBottom: 0 }}
        onPress={onCancel}
      />
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    keyWarning: { color: colors.warningStrong, marginTop: 6 },
    section: { marginTop: 8 },
    center: { textAlign: "center" },
    gapBelow: { marginBottom: 14 },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 8,
    },
    kv: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    kvValue: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    flushButton: { marginTop: 10, marginBottom: 0 },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 16,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    rowTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    rowMain: { flex: 1, gap: 2 },
    rowTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
    name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    expand: { paddingHorizontal: 16, paddingBottom: 14 },
    input: { marginBottom: 12 },
    chipCaption: { marginBottom: 8 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
    chip: {
      maxWidth: "100%",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 11,
      paddingVertical: 6,
    },
    chipActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.softBorder,
    },
    chipText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    chipTextActive: { color: colors.accent, fontFamily: fonts.semibold },
    testText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 12,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 8,
    },
    group: { marginBottom: 6 },
    groupGap: { marginTop: 10 },
    hint: { marginTop: 8, marginBottom: 14 },
    keyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: -4,
      marginBottom: 14,
    },
  }),
);

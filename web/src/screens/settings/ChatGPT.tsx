import { ChatgptRemoteStore, type ChatgptRemoteState } from "@orbyn/api-client";
import {
  CHATGPT_USAGE_URL,
  chatgptExecutorDeviceLabel,
  formatChatgptTokens,
  type ChatgptCatalogSelection,
  type ChatgptUsageSummary,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../../app/account";
import { client, getSessionVersion, getToken } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  SelectBox,
  useConfirm,
} from "../../ui/kit";
import { ProviderChoice } from "./ProviderChoice";
import { SettingsSection, useSettingsExit, useSettingsOwner } from "./shared";

const empty = (): ChatgptRemoteState => ({
  status: "idle",
  devices: [],
  selection: null,
  catalog: null,
  saving: false,
  error: null,
});
type Attempt = {
  selection: ChatgptCatalogSelection;
  model: string | null;
  version: number;
};

function Usage() {
  const owned = useSettingsOwner();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ChatgptUsageSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setOpen(true);
    setError("");
    try {
      const saved = await client.chatgptUsage();
      if (owned()) setData(saved);
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't load recorded usage."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  return (
    <div className="settings-form">
      <div className="settings-actions">
        <Button
          disabled={busy}
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : void load())}
        >
          {open ? "Hide recorded usage" : "Usage in Orbyn"}
        </Button>
        {open && (
          <Button disabled={busy} onClick={() => void load()}>
            Refresh usage
          </Button>
        )}
      </div>
      {open && (
        <>
          {busy && <p role="status">Loading recorded usage…</p>}
          {error && <ErrorNotice message={error} />}
          {data &&
            (!data.recording_enabled ? (
              <p className="muted">Usage history is off in Privacy.</p>
            ) : (
              <>
                <p>
                  {data.completed_requests} completed requests ·{" "}
                  {formatChatgptTokens(data.total_tokens)} reported tokens
                </p>
                <p className="muted small">
                  {formatChatgptTokens(data.input_tokens)} input ·{" "}
                  {formatChatgptTokens(data.output_tokens)} output ·{" "}
                  {new Date(data.since).toLocaleDateString()}–
                  {new Date(data.until).toLocaleDateString()}
                </p>
                {data.measured_requests < data.completed_requests && (
                  <p className="muted">
                    {data.completed_requests - data.measured_requests} requests
                    did not report token counts.
                  </p>
                )}
                {!!data.recent.length && (
                  <details>
                    <summary>Recent completed requests</summary>
                    {data.recent.map((row) => (
                      <p key={row.request_id} dir="auto">
                        {row.model} ·{" "}
                        {new Date(row.completed_at).toLocaleString()} ·{" "}
                        {row.usage
                          ? `${formatChatgptTokens(String(row.usage.total_tokens))} tokens`
                          : "Usage not reported"}
                      </p>
                    ))}
                  </details>
                )}
                <p className="muted small">
                  Orbyn requests only. These measurements do not show your
                  remaining ChatGPT plan allowance.
                </p>
              </>
            ))}
        </>
      )}
      <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer">
        View ChatGPT usage
      </a>
    </div>
  );
}

/** A browser manages verified metadata; the connected app keeps credentials. */
export function ChatGPTSettings({
  onConfigurationChanged,
}: {
  onConfigurationChanged?: () => void;
}) {
  const { user } = useAccount();
  const owned = useSettingsOwner();
  const confirm = useConfirm();
  const store = useRef<ChatgptRemoteStore | null>(null);
  const [state, setState] = useState(empty);
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("");
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unknown, setUnknown] = useState<Attempt | null>(null);
  const lock = useRef(false);
  const seen = useRef("");
  const edit = useRef({ model, baseline });
  edit.current = { model, baseline };
  useEffect(() => {
    if (!user?.id || !owned()) return;
    const current = new ChatgptRemoteStore({
      api: client,
      userId: user.id,
      getToken: () => (getToken() ? String(getSessionVersion()) : ""),
    });
    store.current = current;
    const update = () => {
      if (owned() && store.current === current) setState(current.snapshot());
    };
    const stop = current.subscribe(update);
    update();
    void current.refresh();
    return () => {
      stop();
      current.close();
      if (store.current === current) store.current = null;
    };
  }, [owned, user?.id]);
  const catalog = state.catalog;
  useEffect(() => {
    if (!catalog || !state.selection) return;
    const key = `${state.selection.connection_id}:${state.selection.executor_id}:${catalog.preference.version}`;
    if (seen.current === key) return;
    const sameDevice = seen.current.startsWith(
      `${state.selection.connection_id}:${state.selection.executor_id}:`,
    );
    seen.current = key;
    if (unknown) return;
    if (!sameDevice || edit.current.model === edit.current.baseline)
      setModel(catalog.preference.model ?? "");
    setBaseline(catalog.preference.model ?? "");
  }, [catalog, state.selection, unknown]);
  const dirty = model !== baseline;
  const loading = busy || state.status === "loading" || state.saving;
  const frozen = loading || !!unknown;
  useSettingsExit({
    dirty,
    pending: busy || state.saving || !!unknown,
    message: unknown
      ? "Check the saved default model before leaving."
      : undefined,
  });
  const refresh = async () => {
    if (!owned() || lock.current || unknown) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await store.current?.refresh();
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const select = async (executor: string) => {
    if (!owned() || lock.current || unknown || loading) return;
    const device = state.devices.find((one) => one.executor_id === executor);
    if (!device) return;
    lock.current = true;
    setBusy(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard model selection?",
          action: "Discard changes",
          danger: true,
        }))
      )
        return;
      if (!owned()) return;
      setError("");
      setNotice("");
      setQuery("");
      setModel("");
      setBaseline("");
      seen.current = "";
      await store.current?.select({
        connection_id: device.connection_id,
        executor_id: device.executor_id,
      });
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const save = async () => {
    const current = store.current;
    if (
      !owned() ||
      lock.current ||
      unknown ||
      !current ||
      loading ||
      !dirty ||
      catalog?.status !== "ready" ||
      !state.selection
    )
      return;
    const before = current.snapshot();
    if (
      before.status !== "ready" ||
      before.saving ||
      before.catalog?.status !== "ready" ||
      !before.selection ||
      (model && !before.catalog.models.some((one) => one.slug === model))
    ) {
      setError(
        "The model catalog changed before saving. Refresh it and review your selection.",
      );
      return;
    }
    const attempt: Attempt = {
      selection: { ...before.selection },
      model: model || null,
      version: before.catalog.preference.version,
    };
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await current.save(attempt.model);
      if (!owned() || store.current !== current) return;
      const saved = current.snapshot();
      if (
        saved.catalog?.preference.model === attempt.model &&
        saved.catalog.preference.version === attempt.version + 1
      ) {
        setNotice("Default model saved.");
        onConfigurationChanged?.();
      } else if (
        !saved.error &&
        saved.catalog?.status === "stale" &&
        saved.catalog.preference.version === attempt.version
      ) {
        // The shared store refuses an expired catalog before dispatch. This is
        // an unsent draft, rather than a missing server receipt.
        setError(
          "The model catalog expired before saving. Refresh it; your selection is kept.",
        );
      } else {
        setUnknown(attempt);
        setError(
          "The model save receipt is unavailable. Check saved state before another change.",
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const check = async () => {
    const current = store.current,
      attempt = unknown;
    if (!owned() || lock.current || !current || !attempt) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await current.refresh();
      if (!owned() || store.current !== current) return;
      const discovered = current.snapshot();
      if (
        !discovered.devices.some(
          (device) =>
            device.connection_id === attempt.selection.connection_id &&
            device.executor_id === attempt.selection.executor_id,
        )
      ) {
        setError(
          "The original device is not currently discoverable. Another change remains blocked; check again.",
        );
        return;
      }
      // A failed discovery deliberately clears the store's selection. Recover
      // only this captured device, never an arbitrary first available device.
      if (
        discovered.selection?.connection_id !==
          attempt.selection.connection_id ||
        discovered.selection.executor_id !== attempt.selection.executor_id ||
        !discovered.catalog
      ) {
        await current.select(attempt.selection);
        if (!owned() || store.current !== current) return;
      }
      const saved = current.snapshot();
      if (
        saved.selection?.connection_id !== attempt.selection.connection_id ||
        saved.selection.executor_id !== attempt.selection.executor_id ||
        !saved.catalog
      ) {
        setError(
          "This device's saved default is unavailable. Another change remains blocked.",
        );
        return;
      }
      const value = saved.catalog.preference;
      onConfigurationChanged?.();
      seen.current = `${attempt.selection.connection_id}:${attempt.selection.executor_id}:${value.version}`;
      if (
        value.version === attempt.version + 1 &&
        value.model === attempt.model
      ) {
        setUnknown(null);
        setModel(value.model ?? "");
        setBaseline(value.model ?? "");
        setNotice("The saved default confirms your change.");
      } else if (value.version > attempt.version) {
        setUnknown(null);
        setModel(attempt.model ?? "");
        setBaseline(value.model ?? "");
        setError(
          "The saved model changed. Your selection is retained; review it before saving again.",
        );
      } else
        setError(
          "The saved snapshot doesn't confirm the earlier change. Check again; the request has not been resent.",
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const models = catalog?.models ?? [];
  const filtered = models.filter((one) =>
    `${one.slug} ${one.display_name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const missing = !!model && !models.some((one) => one.slug === model);
  const eligible =
    state.status === "ready" &&
    catalog?.status === "ready" &&
    !frozen &&
    catalog.capabilities?.includes("plan_inference_v1") &&
    models.some((one) => one.slug === catalog.preference.model)
      ? state.selection
      : null;
  return (
    <SettingsSection title="AI connections & models">
      <div className="settings-form">
        <div className="settings-row">
          <strong>ChatGPT</strong>
          <Button disabled={frozen} onClick={() => void refresh()}>
            Refresh devices
          </Button>
        </div>
        <p className="muted">
          Connect or reconnect ChatGPT in the Orbyn desktop or mobile app. This
          browser manages the accounts and models those devices share.
        </p>
        {(state.status === "idle" || state.status === "loading") && (
          <p role="status">Loading connected devices…</p>
        )}
        {state.error && <ErrorNotice message={state.error} />}
        {state.status === "ready" && !state.devices.length && (
          <p>No connected ChatGPT devices.</p>
        )}
        {!!state.devices.length && (
          <Field label="Connected device">
            <SelectBox
              disabled={frozen}
              value={state.selection?.executor_id ?? ""}
              onChange={(event) => void select(event.target.value)}
            >
              <option value="" disabled>
                Choose a device
              </option>
              {state.devices.map((one, index) => (
                <option key={one.executor_id} value={one.executor_id}>
                  {one.device
                    ? chatgptExecutorDeviceLabel(one.device)
                    : `Device ${index + 1} · ${one.host_id.slice(0, 8)}`}
                </option>
              ))}
            </SelectBox>
          </Field>
        )}
        {catalog && (
          <>
            <p role="status">
              {catalog.status === "ready"
                ? `${models.length} models available.`
                : catalog.status === "offline"
                  ? "This device is offline."
                  : catalog.status === "stale"
                    ? "Refresh the model catalog on the connected device."
                    : "This device has not shared an available model catalog."}
            </p>
            <Field label="Find a model">
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
            <Field label="Default model">
              <SelectBox
                disabled={frozen || catalog.status !== "ready"}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value="">No default selected</option>
                {missing && (
                  <option value={model} disabled>
                    {model} · unavailable
                  </option>
                )}
                {!missing &&
                  model &&
                  !filtered.some((one) => one.slug === model) && (
                    <option value={model}>
                      {models.find((one) => one.slug === model)?.display_name ??
                        model}{" "}
                      · selected
                    </option>
                  )}
                {filtered.map((one) => (
                  <option key={one.slug} value={one.slug}>
                    {one.display_name} · {one.slug}
                  </option>
                ))}
              </SelectBox>
            </Field>
            {!models.length ? (
              <p className="muted">This catalog has no models.</p>
            ) : (
              !filtered.length && (
                <p className="muted">No models match your search.</p>
              )
            )}
            {catalog.published_at && (
              <p className="muted small">
                Catalog shared {new Date(catalog.published_at).toLocaleString()}
                .
              </p>
            )}
            <div className="settings-actions">
              <Button
                variant="primary"
                disabled={
                  frozen || !dirty || catalog.status !== "ready" || missing
                }
                onClick={() => void save()}
              >
                Save default model
              </Button>
              {dirty && (
                <Button disabled={frozen} onClick={() => setModel(baseline)}>
                  Discard model changes
                </Button>
              )}
            </div>
          </>
        )}
        {error && <ErrorNotice message={error} />}
        {notice && <p role="status">{notice}</p>}
        {unknown && (
          <Button disabled={loading} onClick={() => void check()}>
            Check saved default
          </Button>
        )}
        <ProviderChoice eligible={eligible} onSaved={onConfigurationChanged} />
        <Usage />
      </div>
    </SettingsSection>
  );
}

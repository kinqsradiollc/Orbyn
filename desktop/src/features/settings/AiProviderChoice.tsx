import { useEffect, useRef, useState } from "react";
import type { AiProviderChoice } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
/** Personal provider and fallback choices do not change MCP connections. */
export function AiProviderChoiceControls({
  userId,
  selection,
}: {
  userId: string;
  selection: { connection_id: string; executor_id: string } | null;
}) {
  const [ownedChoice, setOwnedChoice] = useState<{
      userId: string;
      token: string | null;
      value: AiProviderChoice;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const sessionToken = session.get();
  const lifetime = useRef<AbortController | null>(null);
  const pendingWrite = useRef<AbortController | null>(null);
  const owner = useRef({ userId, token: session.get() });
  owner.current = { userId, token: session.get() };
  const choice =
    ownedChoice?.userId === userId && ownedChoice.token === session.get()
      ? ownedChoice.value
      : null;
  const savedSelection =
    choice?.connection_id && choice.executor_id
      ? { connection_id: choice.connection_id, executor_id: choice.executor_id }
      : null;
  const inspectedIsSaved =
    !!savedSelection &&
    selection?.connection_id === savedSelection.connection_id &&
    selection?.executor_id === savedSelection.executor_id;
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController(),
      token = session.get();
    lifetime.current?.abort();
    lifetime.current = abort;
    pendingWrite.current = null;
    setOwnedChoice(null);
    setError(null);
    setBusy(false);
    if (!userId || !token) return () => abort.abort();
    void client.aiProviderChoice(abort.signal).then(
      (value) => {
        if (!abort.signal.aborted && token === session.get())
          setOwnedChoice({ userId, token, value });
      },
      (e) => {
        if (!abort.signal.aborted && token === session.get())
          setError(errorText(e));
      },
    );
    return () => abort.abort();
  }, [userId, sessionToken, reload]);
  const save = async (
    primary: "default" | "chatgpt",
    fallback: boolean,
    selected = selection,
  ) => {
    const active = lifetime.current;
    if (
      !choice ||
      owner.current.userId !== userId ||
      owner.current.token !== session.get() ||
      ownedChoice?.token !== session.get() ||
      busy ||
      pendingWrite.current !== null ||
      !active ||
      active.signal.aborted ||
      (primary === "chatgpt" && !selected)
    )
      return;
    const token = session.get();
    pendingWrite.current = active;
    setBusy(true);
    setError(null);
    let confirmed = false;
    try {
      const input =
        primary === "default"
          ? {
              primary,
              fallback_to_default: false,
              expected_version: choice.version,
            }
          : {
              primary,
              ...selected!,
              fallback_to_default: fallback,
              expected_version: choice.version,
            };
      const next = await client.saveAiProviderChoice(input, active.signal);
      if (
        next.primary !== input.primary ||
        next.fallback_to_default !== input.fallback_to_default ||
        next.version !== input.expected_version + 1 ||
        next.connection_id !==
          (input.primary === "chatgpt" ? input.connection_id : null) ||
        next.executor_id !==
          (input.primary === "chatgpt" ? input.executor_id : null)
      )
        throw new Error(
          "Provider save could not be confirmed. Reload and try again.",
        );
      confirmed = true;
      if (!active.signal.aborted && token === session.get())
        setOwnedChoice({ userId, token, value: next });
    } catch (e) {
      if (!active.signal.aborted && token === session.get()) {
        // A conflict or mismatched receipt cannot authorize another write with this version.
        setOwnedChoice(null);
        setError(errorText(e));
      }
    } finally {
      // Keep an unconfirmed revision fenced until explicit reload replaces this lifetime.
      if (confirmed && pendingWrite.current === active)
        pendingWrite.current = null;
      if (!active.signal.aborted && token === session.get()) setBusy(false);
    }
  };
  return (
    <section className="settings-subform ai-provider-routing" aria-label="AI provider routing">
      <h3>Provider</h3>
      <div className="button-row start ai-provider-options">
        <button
          type="button"
          className="secondary"
          aria-pressed={choice?.primary === "default"}
          disabled={busy || !choice}
          onClick={() => void save("default", false)}
        >
          Orbyn default
        </button>
        <button
          type="button"
          className="secondary"
          aria-pressed={choice?.primary === "chatgpt" && inspectedIsSaved}
          disabled={busy || !choice || !selection}
          onClick={() =>
            void save("chatgpt", choice?.fallback_to_default ?? false)
          }
        >
          {choice?.primary === "chatgpt" && selection && !inspectedIsSaved
            ? "Use this ChatGPT device"
            : "ChatGPT"}
        </button>
      </div>
      {!selection && (
        <small className="field-hint">
          ChatGPT needs a ready connection and default model.
        </small>
      )}
      {choice?.primary === "chatgpt" && !inspectedIsSaved && (
        <small className="field-hint">
          {savedSelection
            ? "Another ChatGPT device is your current provider."
            : "Your saved ChatGPT device is unavailable."}
        </small>
      )}
      {choice?.primary === "chatgpt" && (
        <label className="settings-checkbox ai-provider-fallback">
          <input
            type="checkbox"
            checked={choice.fallback_to_default}
            disabled={busy || !savedSelection}
            onChange={(e) =>
              void save("chatgpt", e.target.checked, savedSelection)
            }
          />
          Use Orbyn default if ChatGPT is unavailable
        </label>
      )}
      {choice?.primary === "chatgpt" && (
        <small className="field-hint">
          Fallback uses Orbyn's configured provider. Interrupted or unknown
          ChatGPT results are not retried through it.
        </small>
      )}
      {error && <p role="alert">{error}</p>}
      {error && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setReload((value) => value + 1)}
        >
          Reload provider
        </button>
      )}
    </section>
  );
}

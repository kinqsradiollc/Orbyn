import {
  aiProviderChoiceInput,
  HttpError,
  type AiProviderChoice,
  type ChatgptCatalogSelection,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { Button, ErrorNotice, Loading } from "../../ui/kit";
import { useSettingsExit, useSettingsOwner, useSettingsRead } from "./shared";

type Draft = Omit<AiProviderChoice, "version">;
type Input = ReturnType<typeof aiProviderChoiceInput.parse>;
const draftOf = ({ version: _, ...draft }: AiProviderChoice): Draft => draft;
const matches = (saved: AiProviderChoice, input: Input) =>
  saved.primary === input.primary &&
  saved.fallback_to_default === input.fallback_to_default &&
  saved.connection_id ===
    (input.primary === "chatgpt" ? input.connection_id : null) &&
  saved.executor_id ===
    (input.primary === "chatgpt" ? input.executor_id : null);

/** Selecting a provider never also grants external agents permission. */
export function ProviderChoice({
  eligible,
  onSaved,
}: {
  eligible: ChatgptCatalogSelection | null;
  onSaved?: () => void;
}) {
  const owned = useSettingsOwner();
  const read = useSettingsRead(() => client.aiProviderChoice());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unknown, setUnknown] = useState<Input | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (read.data && !draft) setDraft(draftOf(read.data));
  }, [read.data, draft]);
  const dirty =
    !!draft &&
    !!read.data &&
    JSON.stringify(draft) !== JSON.stringify(draftOf(read.data));
  useSettingsExit({
    dirty,
    pending: busy || !!unknown,
    message: unknown
      ? "Check the saved provider choice before leaving."
      : undefined,
  });
  const savedBinding =
    read.data?.primary === "chatgpt" &&
    read.data.connection_id &&
    read.data.executor_id
      ? {
          connection_id: read.data.connection_id,
          executor_id: read.data.executor_id,
        }
      : null;
  const chosenAvailable =
    draft?.primary === "chatgpt" &&
    eligible?.connection_id === draft.connection_id &&
    eligible.executor_id === draft.executor_id;
  const unchangedBinding =
    draft?.primary === "chatgpt" &&
    savedBinding?.connection_id === draft.connection_id &&
    savedBinding.executor_id === draft.executor_id;
  const save = async () => {
    if (
      !owned() ||
      lock.current ||
      unknown ||
      !read.fresh ||
      !read.data ||
      !draft ||
      !dirty ||
      (draft.primary === "chatgpt" && !chosenAvailable && !unchangedBinding)
    )
      return;
    const parsed = aiProviderChoiceInput.safeParse(
      draft.primary === "default"
        ? {
            primary: "default",
            fallback_to_default: false,
            expected_version: read.data.version,
          }
        : { ...draft, expected_version: read.data.version },
    );
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Choose an available ChatGPT device.",
      );
      return;
    }
    const input = parsed.data;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    read.invalidate();
    try {
      const saved = await client.saveAiProviderChoice(input);
      if (!owned()) return;
      if (
        !matches(saved, input) ||
        saved.version !== input.expected_version + 1
      )
        throw new Error(
          "The provider receipt doesn't match this choice. Check saved state.",
        );
      read.commit(saved);
      setDraft(draftOf(saved));
      setNotice("Provider choice saved.");
      onSaved?.();
    } catch (failure) {
      if (owned()) {
        if (
          !(failure instanceof HttpError) ||
          failure.statusCode >= 500 ||
          [408, 429].includes(failure.statusCode)
        )
          setUnknown(input);
        setError(
          messageOf(
            failure,
            "Couldn't save your provider choice. Your draft is kept.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const check = async () => {
    const input = unknown;
    if (!input || !owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await client.aiProviderChoice();
      if (!owned()) return;
      read.commit(saved);
      onSaved?.();
      if (
        matches(saved, input) &&
        saved.version === input.expected_version + 1
      ) {
        setUnknown(null);
        setDraft(draftOf(saved));
        setNotice("The saved provider choice confirms your change.");
      } else if (saved.version > input.expected_version) {
        // A CAS with this older version can no longer commit. Retain the draft
        // and require another explicit Save against the newly read version.
        setUnknown(null);
        setError(
          "The saved provider choice changed. Your draft is retained; review it before saving again.",
        );
      } else
        setError(
          "The saved snapshot doesn't confirm the earlier change. Another write remains blocked; check again.",
        );
    } catch (failure) {
      if (owned())
        setError(
          messageOf(failure, "Couldn't check your saved provider choice."),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const frozen = busy || !!unknown;
  return (
    <div className="settings-form" aria-label="Inference provider">
      <h4>Provider</h4>
      {read.error && (
        <ErrorNotice
          message={read.error}
          onRetry={frozen ? undefined : () => void read.reload()}
        />
      )}
      {!read.data && read.loading && (
        <Loading label="Loading provider choice" />
      )}
      <div className="settings-actions">
        <Button
          disabled={frozen || !read.data}
          aria-pressed={draft?.primary === "default"}
          onClick={() =>
            setDraft({
              primary: "default",
              connection_id: null,
              executor_id: null,
              fallback_to_default: false,
            })
          }
        >
          Orbyn default
        </Button>
        <Button
          disabled={frozen || !read.data || !eligible}
          aria-pressed={!!chosenAvailable}
          onClick={() => {
            if (chosenAvailable) return;
            if (eligible)
              setDraft({
                primary: "chatgpt",
                ...eligible,
                fallback_to_default: false,
              });
          }}
        >
          Use selected ChatGPT device
        </Button>
      </div>
      {draft?.primary === "chatgpt" && (
        <>
          {!chosenAvailable && (
            <p className="muted">
              The saved ChatGPT device or model is not currently available in
              this selection.
            </p>
          )}
          <label className="settings-row">
            <span>Use Orbyn as fallback</span>
            <input
              type="checkbox"
              checked={draft.fallback_to_default}
              disabled={frozen}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  fallback_to_default: event.target.checked,
                })
              }
            />
          </label>
          <p className="muted small">
            Fallback sends work through the workspace provider when ChatGPT is
            unavailable. Uncertain results are never retried.
          </p>
        </>
      )}
      {!eligible && (
        <p className="muted small">
          Choose a ready device and its default model to use ChatGPT.
        </p>
      )}
      <div className="settings-actions">
        <Button
          variant="primary"
          disabled={frozen || !read.fresh || !dirty}
          onClick={() => void save()}
        >
          Save provider
        </Button>
        <Button disabled={frozen} onClick={() => void read.reload()}>
          Reload saved provider
        </Button>
        {dirty && (
          <Button
            disabled={frozen}
            onClick={() => read.data && setDraft(draftOf(read.data))}
          >
            Discard provider changes
          </Button>
        )}
      </div>
      {error && <ErrorNotice message={error} />}
      {notice && <p role="status">{notice}</p>}
      {unknown && (
        <Button disabled={busy} onClick={() => void check()}>
          Check saved provider
        </Button>
      )}
    </div>
  );
}

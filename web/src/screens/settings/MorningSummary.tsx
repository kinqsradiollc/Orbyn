import {
  agendaPrivateEnablementMessage,
  agendaPrivateSummaryText,
  HttpError,
  type AgendaPrivatePermissionInput,
  type ChatgptCatalogRead,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { Button, ErrorNotice, Loading } from "../../ui/kit";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "./shared";

export function MorningSummary({
  configurationVersion = 0,
}: {
  configurationVersion?: number;
}) {
  const owned = useSettingsOwner();
  const currentConfiguration = useRef(configurationVersion);
  currentConfiguration.current = configurationVersion;
  const read = useSettingsRead(async () => {
    const [permission, choice, summary] = await Promise.all([
      client.agendaPrivatePermission(),
      client.aiProviderChoice(),
      client.agendaPrivateSummary().then(
        (value) => ({ value, error: "" }),
        (failure) => ({
          value: null,
          error: messageOf(failure, "Couldn't load summary status."),
        }),
      ),
    ]);
    if (!owned())
      throw new Error("These summary settings belong to an earlier session.");
    let catalog: ChatgptCatalogRead | null = null;
    let connectionError = "";
    if (
      choice.primary === "chatgpt" &&
      choice.connection_id &&
      choice.executor_id
    ) {
      try {
        catalog = await client.chatgptModels(
          {
            connection_id: choice.connection_id,
            executor_id: choice.executor_id,
          },
          undefined,
          true,
        );
      } catch (failure) {
        connectionError = messageOf(
          failure,
          "Couldn't inspect the connected model.",
        );
      }
    }
    return { permission, choice, summary, catalog, connectionError };
  }, [configurationVersion]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => setNotice(""), [configurationVersion]);
  const [unknown, setUnknown] = useState<AgendaPrivatePermissionInput | null>(
    null,
  );
  const lock = useRef(false);
  useSettingsExit({
    pending: busy || !!unknown,
    message: unknown
      ? "Check the saved morning-summary permission before leaving."
      : undefined,
  });
  const reason = agendaPrivateEnablementMessage(read.data ?? null);
  const save = async (enabled: boolean) => {
    const data = read.data;
    if (
      !owned() ||
      lock.current ||
      unknown ||
      !read.fresh ||
      !data ||
      (enabled && reason !== null)
    )
      return;
    const input: AgendaPrivatePermissionInput = {
      enabled,
      expected_version: data.permission.version,
      expected_provider_choice_version: data.choice.version,
      ...(enabled && data.catalog
        ? { expected_preference_version: data.catalog.preference.version }
        : {}),
    };
    const submittedConfiguration = currentConfiguration.current;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    read.invalidate();
    try {
      const saved = await client.setAgendaPrivatePermission(input);
      if (!owned()) return;
      const sameConfiguration =
        submittedConfiguration === currentConfiguration.current;
      if (
        saved.enabled !== enabled ||
        saved.version !== input.expected_version + 1 ||
        (enabled &&
          sameConfiguration &&
          (!saved.active || saved.model !== data.catalog?.preference.model))
      )
        throw new Error(
          "The permission receipt doesn't match the reviewed model. Check saved permission.",
        );
      if (sameConfiguration) read.commit({ ...data, permission: saved });
      setNotice(
        !sameConfiguration
          ? "The permission write was saved. Review its current model status below."
          : enabled
            ? "Morning summaries can use this reviewed ChatGPT model."
            : "Scheduled ChatGPT summary permission is off.",
      );
      await read.reload();
    } catch (failure) {
      if (owned()) {
        if (
          !(failure instanceof HttpError) ||
          failure.statusCode >= 500 ||
          [408, 429].includes(failure.statusCode)
        )
          setUnknown(input);
        setError(messageOf(failure, "Couldn't save summary permission."));
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const check = async () => {
    const attempt = unknown;
    if (!owned() || lock.current || !attempt) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await client.agendaPrivatePermission();
      if (!owned()) return;
      if (saved.version > attempt.expected_version) {
        setUnknown(null);
        if (
          saved.enabled === attempt.enabled &&
          saved.version === attempt.expected_version + 1
        )
          setNotice(
            "The saved permission confirms your change. Review its current model status below.",
          );
        else
          setError(
            "The saved permission changed. Review it before another explicit change.",
          );
        await read.reload();
      } else
        setError(
          "The saved snapshot doesn't confirm the earlier request. Another change remains blocked; check again.",
        );
    } catch (failure) {
      if (owned())
        setError(
          messageOf(failure, "Couldn't check saved summary permission."),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const frozen = busy || !!unknown;
  return (
    <SettingsSection
      title="Morning summary"
      description="Separately allow scheduled summaries to use your ChatGPT plan while its connected device is available."
    >
      {read.error && (
        <ErrorNotice
          message={read.error}
          onRetry={frozen ? undefined : () => void read.reload()}
        />
      )}
      {!read.data && read.loading && (
        <Loading label="Loading summary permission" />
      )}
      {read.data && (
        <>
          <label className="settings-row">
            <span>Use ChatGPT for morning summaries</span>
            <input
              type="checkbox"
              role="switch"
              checked={read.data.permission.enabled}
              disabled={
                frozen ||
                !read.fresh ||
                (!read.data.permission.enabled && reason !== null)
              }
              onChange={(event) => void save(event.target.checked)}
            />
          </label>
          {read.data.permission.enabled && (
            <p>
              {read.data.permission.active
                ? `On · ${read.data.permission.model ?? "Model unavailable"}`
                : "Permission needs review for the current model."}
            </p>
          )}
          {reason && <p className="muted">{reason}</p>}
          {read.data.connectionError && (
            <p className="muted">
              Device details are unavailable. Existing permission can still be
              turned off.
            </p>
          )}
          {read.data.permission.enabled && !read.data.permission.active && (
            <Button
              disabled={frozen || !read.fresh || reason !== null}
              onClick={() => void save(true)}
            >
              Use reviewed model
            </Button>
          )}
          {read.data.permission.enabled && (
            <p className="muted small">
              {read.data.choice.fallback_to_default
                ? "Workspace fallback is enabled."
                : "Workspace fallback is off."}
            </p>
          )}
          {read.data.summary.value && (
            <p role="status">
              {agendaPrivateSummaryText(read.data.summary.value)}
            </p>
          )}
          {read.data.summary.error && (
            <ErrorNotice message={read.data.summary.error} />
          )}
        </>
      )}
      {error && <ErrorNotice message={error} />}
      {notice && <p role="status">{notice}</p>}
      <div className="settings-actions">
        {unknown ? (
          <Button disabled={busy} onClick={() => void check()}>
            Check saved permission
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void read.reload()}>
            Refresh summary settings
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
